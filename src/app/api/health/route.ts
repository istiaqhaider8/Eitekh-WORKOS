import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatency = Date.now() - dbStart;

    return NextResponse.json({
      status: dbLatency < 200 ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      db: { latencyMs: dbLatency },
    });
  } catch {
    return NextResponse.json(
      { status: "error", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
