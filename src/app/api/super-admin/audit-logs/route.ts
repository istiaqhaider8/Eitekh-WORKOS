import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const action = searchParams.get("action") || "";
    const category = searchParams.get("category") || "";
    const severity = searchParams.get("severity") || "";
    const actorId = searchParams.get("actorId") || "";
    const orgId = searchParams.get("orgId") || "";
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const exportFormat = searchParams.get("export");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const page = parseInt(searchParams.get("page") || "1", 10);

    const whereClause: any = {};

    if (orgId && orgId !== "ALL") {
      whereClause.orgId = orgId;
    }

    if (action && action !== "ALL") {
      whereClause.action = action;
    }

    if (actorId && actorId !== "ALL") {
      whereClause.actorId = actorId;
    }

    if (dateFrom || dateTo) {
      whereClause.createdAt = {};
      if (dateFrom) whereClause.createdAt.gte = new Date(dateFrom);
      if (dateTo) whereClause.createdAt.lte = new Date(dateTo);
    }

    const andConditions: any[] = [];

    if (search.trim()) {
      andConditions.push({
        OR: [
          { action: { contains: search.trim(), mode: "insensitive" } },
          { targetResource: { contains: search.trim(), mode: "insensitive" } },
          { details: { contains: search.trim(), mode: "insensitive" } },
          { actorId: { contains: search.trim(), mode: "insensitive" } },
        ],
      });
    }

    if (category && category !== "ALL") {
      andConditions.push({
        details: { contains: '"category":"' + category + '"' },
      });
    }

    if (severity && severity !== "ALL") {
      andConditions.push({
        details: { contains: '"severity":"' + severity + '"' },
      });
    }

    if (andConditions.length > 0) {
      whereClause.AND = andConditions;
    }

    if (exportFormat === "csv" || exportFormat === "json") {
      const logs = await prisma.platformAuditLog.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: 2000,
      });

      const enrichedLogs = logs.map((l) => {
        let detailsObj: any = {};
        try {
          detailsObj = l.details ? JSON.parse(l.details) : {};
        } catch {
          detailsObj = { raw: l.details };
        }
        return {
          id: l.id,
          timestamp: l.createdAt.toISOString(),
          action: l.action,
          targetResource: l.targetResource,
          actorId: l.actorId,
          actorName: detailsObj.actorName || "System / User",
          actorEmail: detailsObj.actorEmail || "",
          category: detailsObj.category || "SYSTEM",
          severity: detailsObj.severity || "INFO",
          status: detailsObj.status || "SUCCESS",
          ipAddress: l.ipAddress || "127.0.0.1",
          orgId: l.orgId || "",
          details: detailsObj,
        };
      });

      if (exportFormat === "json") {
        return new NextResponse(JSON.stringify(enrichedLogs, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": 'attachment; filename="eitekh_audit_ledger_' + Date.now() + '.json"',
          },
        });
      }

      const csvRows = [
        ["Record ID", "Timestamp", "Category", "Severity", "Action", "Actor Name", "Actor Email", "Actor ID", "Target Resource", "IP Address", "Status", "Details"].join(","),
        ...enrichedLogs.map((l) =>
          [
            '"' + l.id + '"',
            '"' + l.timestamp + '"',
            '"' + l.category + '"',
            '"' + l.severity + '"',
            '"' + l.action + '"',
            '"' + (l.actorName || '').replace(/"/g, '""') + '"',
            '"' + (l.actorEmail || '').replace(/"/g, '""') + '"',
            '"' + l.actorId + '"',
            '"' + l.targetResource.replace(/"/g, '""') + '"',
            '"' + l.ipAddress + '"',
            '"' + l.status + '"',
            '"' + JSON.stringify(l.details).replace(/"/g, '""') + '"',
          ].join(",")
        ),
      ];

      return new NextResponse(csvRows.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="eitekh_audit_ledger_' + Date.now() + '.csv"',
        },
      });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalCount, rawLogs, actionTypes, todayCount, criticalCount] = await Promise.all([
      prisma.platformAuditLog.count({ where: whereClause }),
      prisma.platformAuditLog.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.platformAuditLog.groupBy({
        by: ["action"],
        where: whereClause,
        _count: { action: true },
      }),
      prisma.platformAuditLog.count({
        where: {
          ...whereClause,
          createdAt: { gte: todayStart },
        },
      }),
      prisma.platformAuditLog.count({
        where: {
          ...whereClause,
          details: { contains: '"severity":"CRITICAL"' },
        },
      }),
    ]);

    const missingActorIds = Array.from(new Set(rawLogs.map((l) => l.actorId))).filter(
      (id) => id && id !== "system"
    );
    const usersMap = new Map<string, { name: string; email: string; avatarUrl?: string | null }>();

    if (missingActorIds.length > 0) {
      const dbUsers = await prisma.user.findMany({
        where: { id: { in: missingActorIds } },
        select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
      });
      for (const u of dbUsers) {
        usersMap.set(u.id, {
          name: (u.firstName + ' ' + u.lastName).trim() || u.email,
          email: u.email,
          avatarUrl: u.avatarUrl,
        });
      }
    }

    const logs = rawLogs.map((l) => {
      let detailsObj: any = {};
      try {
        detailsObj = l.details ? JSON.parse(l.details) : {};
      } catch {
        detailsObj = { message: l.details };
      }

      const dbUser = usersMap.get(l.actorId);
      const actorName = detailsObj.actorName || dbUser?.name || (l.actorId === "system" ? "System Service" : "Admin User");
      const actorEmail = detailsObj.actorEmail || dbUser?.email || "";
      const avatarUrl = dbUser?.avatarUrl || null;

      const changes = detailsObj.changes || detailsObj.diff || null;
      const previousState = detailsObj.previousState || null;
      const newState = detailsObj.newState || null;

      return {
        id: l.id,
        action: l.action,
        targetResource: l.targetResource,
        actorId: l.actorId,
        actorName,
        actorEmail,
        avatarUrl,
        orgId: l.orgId,
        ipAddress: l.ipAddress || "127.0.0.1",
        createdAt: l.createdAt,
        category: detailsObj.category || "SYSTEM",
        severity: detailsObj.severity || "INFO",
        status: detailsObj.status || "SUCCESS",
        changes,
        previousState,
        newState,
        details: detailsObj,
      };
    });

    return NextResponse.json({
      success: true,
      logs,
      totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit),
      stats: {
        totalEvents: totalCount,
        todayEvents: todayCount,
        criticalEvents: criticalCount,
      },
      actionTypes: actionTypes.map((a) => ({ action: a.action, count: a._count.action })),
    });
  } catch (error: any) {
    console.error("Audit log query error:", error);
    return handleApiError(error, "super-admin/audit-logs");
  }
}
