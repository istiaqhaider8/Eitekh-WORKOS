import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { securityEngine } from '@/lib/security-engine';

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: 'Forbidden: Super Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'ALL';

    // Run scan first and await completion
    const scannedThreats = await securityEngine.runContinuousSecurityScan();
    const scoreCard = await securityEngine.calculateSecurityScore();
    const allThreats = securityEngine.getActiveThreats(status);
    const finalThreats = allThreats.length > 0 ? allThreats : scannedThreats;
    const threats = status === 'ALL' ? finalThreats : finalThreats.filter((t) => t.status === status);
    const isolationViolations = securityEngine.getIsolationViolations();

    return NextResponse.json({
      scoreCard,
      threats,
      isolationViolations,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: 'Forbidden: Super Admin access required' }, { status: 403 });
    }

    const { threatId, status, note } = await request.json();
    if (!threatId || !status) {
      return NextResponse.json({ error: 'Missing threatId or status' }, { status: 400 });
    }

    const updated = securityEngine.updateThreatStatus(threatId, status, note, user.email);
    if (!updated) {
      return NextResponse.json({ error: 'Threat not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `Threat ${threatId} updated to ${status}`,
      threat: updated,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}