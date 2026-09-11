import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertProjectAccess } from '@/lib/tenant';
import { syncEngine, SyncClient } from '@/lib/sync-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Please sign in' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return new Response(JSON.stringify({ error: 'Missing projectId parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // STRICT PROJECT-BASED ACCESS CONTROL (PBAC):
    // Authenticated user MUST be assigned to this project or be a Superadmin.
    // Cross-project subscriptions are strictly rejected with 403.
    try {
      await assertProjectAccess(projectId);
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || 'Forbidden: Access denied to project real-time stream' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
    const userAgent = req.headers.get('user-agent') || 'Unknown';

    const encoder = new TextEncoder();
    let isRegistered = false;

    const stream = new ReadableStream({
      start(controller) {
        const client: SyncClient = {
          id: clientId,
          userId: user.id,
          userEmail: user.email,
          userName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
          projectId,
          isSuperAdmin: !!user.isSuperAdmin,
          controller,
          connectedAt: new Date(),
          lastPingAt: new Date(),
          ipAddress,
          userAgent,
        };

        syncEngine.registerClient(client);
        isRegistered = true;

        // Send Initial Connection Confirmation
        const initPayload = {
          eventId: `evt_init_${clientId}`,
          eventType: 'CONNECTED',
          projectId,
          timestamp: new Date().toISOString(),
          data: {
            clientId,
            userId: user.id,
            userEmail: user.email,
            status: 'ONLINE',
            serverTime: new Date().toISOString(),
          },
        };

        const initMessage = `event: message\ndata: ${JSON.stringify(initPayload)}\n\n`;
        controller.enqueue(encoder.encode(initMessage));
      },
      cancel() {
        if (isRegistered) {
          syncEngine.unregisterClient(clientId);
        }
      },
    });

    req.signal.addEventListener('abort', () => {
      if (isRegistered) {
        syncEngine.unregisterClient(clientId);
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
