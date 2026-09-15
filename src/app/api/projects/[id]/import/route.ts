import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { csvImportSchema, parseBody } from "@/lib/validation";

function parseCSVLine(line: string) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    await assertProjectPermission(id, "export:import_data");

    const parsed = parseBody(csvImportSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { csvData } = parsed.data;

    const lines = csvData.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    if (lines.length < 2) {
      return NextResponse.json({ error: "CSV must contain headers and at least one row" }, { status: 400 });
    }

    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
    const titleIndex = headers.findIndex(h => h === 'title');
    
    if (titleIndex === -1) {
      return NextResponse.json({ error: "CSV must contain a 'Title' column" }, { status: 400 });
    }

    const defaultStatus = await prisma.workflowStatus.findFirst({
      where: { workflow: { projectId: id } },
      orderBy: { position: 'asc' }
    });

    if (!defaultStatus) {
      return NextResponse.json({ error: "Project has no workflow statuses defined" }, { status: 400 });
    }

    let importedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      const title = row[titleIndex];
      
      if (!title) {
        skippedCount++;
        errors.push(`Row ${i + 1}: Missing title`);
        continue;
      }

      const descIndex = headers.findIndex(h => h === 'description');
      const description = descIndex !== -1 ? row[descIndex] : null;

      const project = await prisma.project.update({
        where: { id },
        data: { issueCounter: { increment: 1 } }
      });

      const issueKey = `${project.key}-${project.issueCounter}`;

      await prisma.issue.create({
        data: {
          projectId: id,
          keyNumber: project.issueCounter,
          issueKey,
          title,
          description: description || null,
          reporterId: user.id,
          statusId: defaultStatus.id
        }
      });
      importedCount++;
    }

    return NextResponse.json({ 
      imported: importedCount, 
      skipped: skippedCount, 
      errors 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: error.message?.includes("Unauthorized") ? 401 : 500 });
  }
}
