import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine } from '@/lib/pbac-engine';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId') || 'default-org';
    const format = (searchParams.get('format') || 'csv') as 'csv' | 'excel' | 'pdf';
    const search = searchParams.get('search') || '';
    const roleId = searchParams.get('roleId') || 'all';

    // Strict Tenant Isolation & PBAC Governance Export Check
    await assertOrgAccess(orgId, ['OWNER', 'ADMIN']);

    const result = await pbacEngine.exportData(orgId, format, { search, roleId });

    return new NextResponse(result.content, {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  } catch (e: any) {
    const status = e.message?.includes('Forbidden') ? 403 : e.message?.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: e.message || 'Export failed' }, { status });
  }
}
