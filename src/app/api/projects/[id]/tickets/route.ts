import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { ticketCreateSchema, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { allocateTicketKey } from "@/lib/ticket-keys";
import { syncEngine } from "@/lib/sync-engine";
import { notificationEngine } from "@/lib/notifications";
import { enqueueEmail } from "@/lib/email-outbox";
import { logAuditEvent } from "@/lib/audit-logger";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    let authContext: any;
    try {
      authContext = await assertProjectAccess(projectId);
      await assertProjectPermission(projectId, "tickets:view");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const { user } = authContext;
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const priority = searchParams.get("priority");
    const assignedManagerId = searchParams.get("assignedManagerId");
    const createdById = searchParams.get("createdById");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where: any = { projectId };

    // Tenant / Client Isolation: Clients only see tickets they submitted
    if (user.userType === "CLIENT") {
      where.createdById = user.id;
    } else if (createdById) {
      where.createdById = createdById;
    }

    if (status) where.status = status;
    if (category) where.category = category;
    if (priority) where.priority = priority;
    if (assignedManagerId) {
      if (assignedManagerId === "unassigned") {
        where.assignedManagerId = null;
      } else {
        where.assignedManagerId = assignedManagerId;
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { ticketKey: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, tickets] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take: limit,
        include: {
          createdBy: publicUserRelation,
          assignedManager: publicUserRelation,
          convertedIssue: {
            select: {
              id: true,
              issueKey: true,
              title: true,
              status: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  color: true,
                },
              },
            },
          },
          _count: {
            select: {
              comments: user.userType === "CLIENT" ? { where: { isInternal: false } } : true,
              attachments: true,
            },
          },
        },
      }),
    ]);

    return NextResponse.json({
      tickets,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    return handleApiError(error, "tickets/list");
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    let authContext: any;
    try {
      authContext = await assertProjectAccess(projectId);
      await assertProjectPermission(projectId, "tickets:create");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const { user } = authContext;
    const parsed = await parseJsonBody(req, ticketCreateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      // Concurrency-safe key allocation
      const { ticketNumber, ticketKey } = await allocateTicketKey(tx, projectId);

      // SLA target: use caller-provided dueDate, or default based on priority
      let calculatedDueDate: Date | null = null;
      if (body.dueDate) {
        calculatedDueDate = new Date(body.dueDate);
      } else {
        const priorityHours: Record<string, number> = {
          CRITICAL: 24,
          HIGH: 48,
          MEDIUM: 120, // 5 days
          LOW: 240,    // 10 days
        };
        const hours = priorityHours[body.priority] ?? 120;
        calculatedDueDate = new Date(Date.now() + hours * 3600 * 1000);
      }

      const ticket = await tx.ticket.create({
        data: {
          projectId,
          ticketNumber,
          ticketKey,
          title: body.title,
          description: body.description ?? null,
          category: body.category,
          priority: body.priority,
          status: "NEW",
          createdById: user.id,
          dueDate: calculatedDueDate,
        },
        include: {
          createdBy: publicUserRelation,
          assignedManager: publicUserRelation,
        },
      });

      // Initial status audit log
      await tx.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          actorId: user.id,
          fromStatus: "NONE",
          toStatus: "NEW",
          note: "Ticket created",
        },
      });

      return ticket;
    });

    // Enqueue client confirmation email via durable email-outbox
    if (user.email) {
      await enqueueEmail({
        to: user.email,
        customSubject: `[${result.ticketKey}] Ticket Received: ${result.title}`,
        customHtml: `<p>Hello ${user.firstName || user.email},</p><p>We have received your ticket <strong>${result.ticketKey}</strong>: <em>${result.title}</em>.</p><p>Our team has been notified and is reviewing it. You can check updates directly on your dashboard.</p>`,
        idempotencyKey: `ticket-received-${result.id}`,
      });
    }

    // Log enterprise audit event
    await logAuditEvent({
      actorId: user.id,
      actorName: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      actorEmail: user.email,
      action: "TICKET_CREATED",
      category: "PROJECT",
      projectId,
      targetResource: result.ticketKey,
      newState: { status: result.status, priority: result.priority, category: result.category },
      details: {
        ticketId: result.id,
        ticketKey: result.ticketKey,
        title: result.title,
        priority: result.priority,
        category: result.category,
        dueDate: result.dueDate,
      },
    });

    // Notify project managers & admins
    try {
      const managers = await prisma.projectMember.findMany({
        where: {
          projectId,
          role: { in: ["PROJECT_ADMIN", "PROJECT_MANAGER"] },
          userId: { not: user.id },
        },
        select: { userId: true },
      });

      const recipientUserIds = managers.map((m) => m.userId);
      if (recipientUserIds.length > 0) {
        await notificationEngine.dispatch({
          type: "INFO",
          title: `New Ticket: ${result.ticketKey}`,
          message: `${user.firstName || user.email} submitted ticket "${result.title}"`,
          linkUrl: `/projects/${projectId}?view=tickets&ticketId=${result.id}`,
          projectId,
          recipientUserIds,
          actorId: user.id,
        });
      }
    } catch (notifErr) {
      console.error("[tickets/create] Failed to send notifications:", notifErr);
    }

    // Real-time SSE event broadcast
    syncEngine.publishProjectEvent({
      projectId,
      eventType: "TICKET_CREATED",
      entityId: result.id,
      entityType: "ISSUE",
      data: result,
      actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
    });

    return NextResponse.json({ ticket: result }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "tickets/create");
  }
}
