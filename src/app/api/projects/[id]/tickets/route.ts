import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";
import { ticketCreateSchema, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { allocateTicketKey } from "@/lib/ticket-keys";
import { syncEngine } from "@/lib/sync-engine";
import { notificationEngine } from "@/lib/notifications";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    let authContext: any;
    try {
      authContext = await assertProjectAccess(projectId);
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
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
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
