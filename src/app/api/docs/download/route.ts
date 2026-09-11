import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'md';
    const doc = url.searchParams.get('doc') || 'master';

    const isCalendar = doc.toLowerCase() === 'calendar';
    const baseName = isCalendar
      ? 'Zenith_WorkOS_Calendar_Schedule_Documentation'
      : 'Zenith_WorkOS_Master_Documentation';
    const filePath = isCalendar
      ? path.resolve(process.cwd(), 'CALENDAR_DOCUMENTATION.md')
      : path.resolve(process.cwd(), 'DOCUMENTATION.md');
    const htmlPath = `C:/Users/ASUS/Downloads/${baseName}.html`;

    if (format === 'html') {
      if (fs.existsSync(htmlPath)) {
        const content = fs.readFileSync(htmlPath, 'utf8');
        return new NextResponse(content, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': `attachment; filename="${baseName}.html"`,
          },
        });
      }
    }

    const content = fs.readFileSync(filePath, 'utf8');
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
