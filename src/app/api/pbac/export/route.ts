import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine } from '@/lib/pbac-engine';
import { handleApiError } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
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
    return handleApiError(e, "pbac/export");
  }
}
