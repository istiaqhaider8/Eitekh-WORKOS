import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const [
      totalUsers,
      mfaUsersCount,
      suspendedUsers,
      activeSessions,
      recentAuditLogs,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { mfaEnabled: true } }),
      prisma.user.findMany({
        where: { status: "SUSPENDED" },
        select: { id: true, email: true, firstName: true, lastName: true, createdAt: true, updatedAt: true },
      }),
      prisma.session.findMany({
        where: { expiresAt: { gt: new Date() } },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true, isSuperAdmin: true } } },
        orderBy: { lastActiveAt: "desc" },
        take: 20,
      }),
      prisma.platformAuditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    // Build real security alerts from actual state
    const securityAlerts = [];

    if (suspendedUsers.length > 0) {
      securityAlerts.push({
        id: "alert-susp-users",
        severity: "HIGH",
        title: `${suspendedUsers.length} Suspended User Accounts`,
        description: `Accounts [${suspendedUsers.map(u => u.email).slice(0, 3).join(", ")}${suspendedUsers.length > 3 ? "..." : ""}] are locked out from authentication.`,
        timestamp: suspendedUsers[0].updatedAt,
        type: "ACCOUNT_LOCKOUT",
      });
    }

    const mfaAdoptionPct = totalUsers > 0 ? Math.round((mfaUsersCount / totalUsers) * 100) : 0;
    if (mfaAdoptionPct < 50) {
      securityAlerts.push({
        id: "alert-mfa-low",
        severity: "MEDIUM",
        title: `Low Multi-Factor Authentication Adoption (${mfaAdoptionPct}%)`,
        description: `Only ${mfaUsersCount} of ${totalUsers} registered users have TOTP MFA enabled.`,
        timestamp: new Date().toISOString(),
        type: "MFA_POLICY",
      });
    }

    // Look for suspicious actions in audit logs
    const suspiciousLogs = recentAuditLogs.filter(
      (l) => l.action.includes("SUSPENDED") || l.action.includes("ROLE") || l.action.includes("UNAUTHORIZED") || l.action.includes("SECURITY")
    );

    suspiciousLogs.forEach((log) => {
      securityAlerts.push({
        id: `alert-${log.id}`,
        severity: log.action.includes("UNAUTHORIZED") ? "CRITICAL" : "MEDIUM",
        title: `Audit Event: ${log.action.replace(/_/g, " ")}`,
        description: `Target: ${log.targetResource} | Details: ${log.details || "N/A"}`,
        timestamp: log.createdAt,
        type: "AUDIT_TRIGGER",
      });
    });

    const securityMetrics = {
      mfaAdoptionPct,
      mfaUsersCount,
      totalUsers,
      activeSessionsCount: activeSessions.length,
      suspendedUsersCount: suspendedUsers.length,
      crossProjectViolations: 0,
      failedAuthAttemptsLast24h: 0,
    };

    return NextResponse.json({
      securityMetrics,
      securityAlerts,
      suspendedUsers,
      activeSessions: activeSessions.map((s) => ({
        id: s.id,
        userEmail: s.user.email,
        userName: `${s.user.firstName} ${s.user.lastName}`,
        isSuperAdmin: s.user.isSuperAdmin,
        ipAddress: s.ipAddress || "127.0.0.1",
        browser: s.browser || "Unknown",
        os: s.os || "Unknown",
        location: s.location || "Localhost",
        lastActiveAt: s.lastActiveAt,
        expiresAt: s.expiresAt,
      })),
      recentAuditLogs,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { action, targetUserId, sessionId } = await request.json();

    if (action === "SUSPEND_USER" && targetUserId) {
      const updated = await prisma.user.update({
        where: { id: targetUserId },
        data: { status: "SUSPENDED" },
      });
      // Revoke all sessions for suspended user
      await prisma.session.deleteMany({ where: { userId: targetUserId } });

      await prisma.platformAuditLog.create({
        data: {
          actorId: user.id,
          action: "USER_SUSPENDED",
          targetResource: `User:${targetUserId}`,
          details: JSON.stringify({ email: updated.email, reason: "Administrative security suspension" }),
        },
      });

      return NextResponse.json({ success: true, message: `User ${updated.email} suspended and sessions revoked` });
    }

    if (action === "ACTIVATE_USER" && targetUserId) {
      const updated = await prisma.user.update({
        where: { id: targetUserId },
        data: { status: "ACTIVE" },
      });

      await prisma.platformAuditLog.create({
        data: {
          actorId: user.id,
          action: "USER_ACTIVATED",
          targetResource: `User:${targetUserId}`,
          details: JSON.stringify({ email: updated.email }),
        },
      });

      return NextResponse.json({ success: true, message: `User ${updated.email} restored to ACTIVE` });
    }

    if (action === "REVOKE_SESSION" && sessionId) {
      await prisma.session.delete({ where: { id: sessionId } });
      return NextResponse.json({ success: true, message: "Session revoked successfully" });
    }

    if (action === "REVOKE_ALL_SESSIONS" && targetUserId) {
      await prisma.session.deleteMany({ where: { userId: targetUserId } });
      return NextResponse.json({ success: true, message: "All sessions revoked for user" });
    }

    return NextResponse.json({ error: "Invalid action parameters" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}