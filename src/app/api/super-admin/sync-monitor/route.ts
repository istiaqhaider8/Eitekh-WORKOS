import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { syncEngine } from '@/lib/sync-engine';
import { prisma } from '@/lib/prisma';
import { superAdminSyncMonitorActionSchema, parseBody } from '@/lib/validation';
import { handleApiError } from "@/lib/api-error";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: 'Forbidden: Super Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId') || undefined;
    const eventType = searchParams.get('eventType') || undefined;
    const moduleFilter = searchParams.get('module') || undefined;
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;

    const metrics = syncEngine.getSyncMetrics();
    const activeClients = syncEngine.getActiveClientsList();
    const eventLogs = syncEngine.getSyncEventLogs({
      projectId,
      eventType,
      module: moduleFilter,
      status,
      search,
      limit: 100,
    });

    // Check DB latency
    const startDb = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - startDb;

    return NextResponse.json({
      metrics: {
        ...metrics,
        dbLatencyMs,
      },
      activeClients,
      eventLogs,
    });
  } catch (error: any) {
    return handleApiError(error, "super-admin/sync-monitor");
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden: Superadmin privileges required' }, { status: 403 });
    }

    const parsed = parseBody(superAdminSyncMonitorActionSchema, await req.json().catch(() => ({})));
    if (!parsed.success) return parsed.error;
    const targetProjectId = parsed.data.projectId || 'GLOBAL_SYSTEM';

    const event = syncEngine.publishProjectEvent({
      projectId: targetProjectId,
      eventType: 'SYSTEM_SYNC_PING',
      entityId: `ping_${Date.now()}`,
      entityType: 'SYSTEM',
      data: {
        message: parsed.data.message || 'Manual system sync test ping triggered by Superadmin',
        triggeredBy: user.email,
      },
      actor: {
        id: user.id,
        email: user.email,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      },
      sourceModule: 'System Sync Monitor',
      targetModules: [
        'Projects',
        'Kanban',
        'List',
        'Scrum',
        'Backlog',
        'Sprint',
        'Calendar',
        'Gantt',
        'Workload',
        'Analytics',
        'Reports',
        'Notifications',
      ],
    });

    return NextResponse.json({ success: true, event });
  } catch (error: any) {
    return handleApiError(error, "super-admin/sync-monitor");
  }
}
