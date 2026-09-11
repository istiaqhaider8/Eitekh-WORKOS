import { NextRequest, NextResponse } from 'next/server';
export async function GET() {
  return NextResponse.json({ success: true, items: [] });
}
export async function POST() {
  return NextResponse.json({ success: true });
}
