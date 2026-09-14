import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getCurrentUser } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const format = (url.searchParams.get('format') || 'md').toLowerCase();
    const doc = (url.searchParams.get('doc') || 'master').toLowerCase();

    const isCalendar = doc === 'calendar';
    const baseName = isCalendar
      ? 'Eitekh_WorkOS_Calendar_Schedule_Documentation'
      : 'Eitekh_WorkOS_Master_Documentation';
    const fileName = isCalendar ? 'CALENDAR_DOCUMENTATION.md' : 'DOCUMENTATION.md';
    const filePath = path.resolve(process.cwd(), fileName);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Documentation file not found' }, { status: 404 });
    }

    const content = fs.readFileSync(filePath, 'utf8');

    if (format === 'html') {
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${baseName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 900px; margin: 0 auto; padding: 40px 20px; color: #1e293b; }
    pre { background: #f1f5f9; padding: 16px; border-radius: 8px; overflow-x: auto; }
    code { font-family: monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    h1, h2, h3 { color: #0f172a; }
  </style>
</head>
<body>
  <pre>${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>`;
      return new NextResponse(htmlContent, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}.html"`,
        },
      });
    }

    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseName}.md"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to download documentation' }, { status: 500 });
  }
}

