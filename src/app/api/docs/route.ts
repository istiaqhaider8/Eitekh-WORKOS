import { NextResponse } from "next/server";
import spec from "../../../../public/openapi.json";

/** Serve the OpenAPI 3.0 spec. Public — no auth required. */
export async function GET() {
  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
