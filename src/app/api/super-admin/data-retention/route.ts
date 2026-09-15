import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRetentionPolicies, runDataRetention } from "@/lib/data-retention";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const policies = getRetentionPolicies();
    return NextResponse.json({ policies });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const results = await runDataRetention();
    const totalDeleted = results.reduce((s, r) => s + r.deletedCount, 0);
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      success: errors.length === 0,
      runAt: new Date().toISOString(),
      totalDeleted,
      results,
      ...(errors.length > 0 ? { partialErrors: errors.map((r) => `${r.entity}: ${r.error}`) } : {}),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
