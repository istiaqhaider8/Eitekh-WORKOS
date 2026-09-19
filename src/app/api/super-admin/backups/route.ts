import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createBackup, listBackups } from "@/lib/backup";
import { handleApiError } from "@/lib/api-error";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const backups = listBackups();
    return NextResponse.json({ backups });
  } catch (error: any) {
    return handleApiError(error, "super-admin/backups");
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    let label: string | undefined;
    try {
      const body = await req.json();
      if (typeof body.label === "string") label = body.label;
    } catch {}

    const result = createBackup(label);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, backup: result.path });
  } catch (error: any) {
    return handleApiError(error, "super-admin/backups");
  }
}
