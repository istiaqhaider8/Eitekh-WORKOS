import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/validation";
import { capture, counters } from "@/lib/telemetry";
import { handleApiError } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth";

/**
 * PROD-7 — intake for browser errors.
 *
 * `src/app/error.tsx` carried the comment "Log the error to an error reporting
 * service" above a bare `console.error`. The browser console is not a
 * reporting service: nobody is reading it, and a crash that only a customer's
 * devtools ever saw is a crash you do not know about.
 *
 * THIS ENDPOINT IS DELIBERATELY UNAUTHENTICATED. The errors most worth seeing
 * happen on the login, registration and password-reset pages, where there is
 * no session yet — requiring auth would filter out exactly the failures that
 * lock people out. When a session does exist the user id is attached, so the
 * report is still attributable.
 *
 * Being unauthenticated makes it an abuse surface, so it is bounded on every
 * axis: a strict schema, short length caps, no echo of the payload, and the
 * middleware's mutation rate limit (30/min per subject, backstopped per IP).
 * Everything is scrubbed by `capture()` before it leaves the process — the
 * browser is an untrusted source and may well send a token in a URL.
 */

const MAX_MESSAGE = 1_000;
const MAX_STACK = 8_000;
const MAX_URL = 500;

const clientErrorSchema = z.object({
  message: z.string().min(1).max(MAX_MESSAGE),
  stack: z.string().max(MAX_STACK).optional(),
  // Where it happened. Useful for grouping; scrubbed like everything else,
  // because query strings carry tokens more often than anyone expects.
  url: z.string().max(MAX_URL).optional(),
  // "boundary" = caught by a React error boundary, "window" = window.onerror,
  // "unhandledrejection" = a promise nobody caught.
  source: z.enum(["boundary", "window", "unhandledrejection"]).default("boundary"),
  /** React's error digest, which ties a client error to its server render. */
  digest: z.string().max(200).optional(),
  userAgent: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, clientErrorSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    // Best effort: an unauthenticated report is still worth having.
    let userId: string | undefined;
    try {
      const user = await getCurrentUser();
      userId = user?.id;
    } catch {
      /* no session; the report stands on its own */
    }

    counters.increment("client.errors");

    capture({
      severity: "error",
      action: "CLIENT_ERROR",
      message: body.message,
      meta: {
        source: body.source,
        url: body.url,
        digest: body.digest,
        userAgent: body.userAgent ?? req.headers.get("user-agent") ?? undefined,
        userId,
      },
      error: { name: "ClientError", message: body.message, stack: body.stack },
    });

    // 204: the browser has nothing to do with the answer, and returning a body
    // would give an abuser feedback to tune against.
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error, "telemetry/client", 400);
  }
}
