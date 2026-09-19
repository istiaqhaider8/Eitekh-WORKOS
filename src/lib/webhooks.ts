import { prisma } from "./prisma";
import { logger } from "./logger";

/**
 * Webhook delivery.
 *
 * `targetUrl` is supplied by a tenant, so dispatching to it is a server-side
 * request to an attacker-chosen address (SSRF). Before delivery was wired up
 * this was latent; now that events actually fire, the destination must be
 * validated. Blocked: non-HTTP(S) schemes, credentials in the URL, loopback,
 * link-local (including the cloud metadata address 169.254.169.254), and
 * private/internal ranges.
 *
 * Note this is a hostname/IP-literal check. It does NOT defeat a DNS name that
 * resolves to a private address, nor a redirect to one — closing those
 * properly needs resolve-then-pin-the-socket, or an egress proxy/allowlist at
 * the network layer. That is the correct production answer and is recorded as
 * follow-up in PRE-PRODUCTION-VERIFICATION.md.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
]);

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true; // malformed → refuse
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

export function isWebhookTargetAllowed(rawUrl: string): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }

  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: `scheme ${u.protocol} is not allowed` };
  }
  // Plain HTTP would send the shared secret in clear text.
  if (u.protocol === "http:" && process.env.NODE_ENV === "production") {
    return { ok: false, reason: "http:// is not allowed in production (the secret would be sent in clear text)" };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "credentials in the URL are not allowed" };
  }

  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: `host ${host} is not a permitted destination` };
  }
  if (isPrivateIpv4(host)) {
    return { ok: false, reason: `host ${host} is a private or link-local address` };
  }
  // IPv6 literals: refuse loopback and unique-local (fc00::/7) outright.
  if (host.includes(":")) {
    const h = host.replace(/^\[|\]$/g, "");
    if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
      return { ok: false, reason: `host ${host} is a private or loopback IPv6 address` };
    }
  }
  if (host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: `host ${host} resolves to an internal namespace` };
  }

  return { ok: true };
}

/**
 * Dispatch an event to every subscribed endpoint.
 *
 * C1 — THIS NO LONGER DELIVERS DIRECTLY.
 *
 * It used to be one un-awaited `fetch` per webhook. Nothing recorded the
 * attempt, a receiver's transient 500 lost the event permanently, and on a
 * short-lived process the socket could be torn down before it opened. It also
 * sent the shared secret in a header on every request, which exposed it to
 * every intermediary and proved nothing about the payload.
 *
 * Now it writes a durable row per endpoint and returns; src/lib/webhook-delivery.ts
 * signs, attempts, retries with backoff and dead-letters. The property worth
 * keeping from the old design is preserved: the caller's request is still never
 * blocked on a receiver.
 */
export async function dispatchWebhook(eventType: string, payload: any, projectId?: string, orgId?: string) {
  try {
    // Imported lazily to keep the SSRF guard above importable on its own —
    // webhook-delivery.ts imports THIS module for isWebhookTargetAllowed, and
    // a static import both ways is a cycle.
    const { enqueueWebhookDeliveries, startWebhookWorker } = await import("./webhook-delivery");
    startWebhookWorker();
    await enqueueWebhookDeliveries(eventType, payload, projectId, orgId);
  } catch (error: any) {
    logger.error("WEBHOOK_DISPATCH_ERROR", "Failed to process webhooks", error);
  }
}

/**
 * Convenience wrapper for issue lifecycle events.
 *
 * Resolves the owning organisation from the project so that org-scoped
 * webhooks (projectId = null) also receive the event, and never throws into
 * the caller's request path — a webhook problem must not fail the user's
 * action that triggered it.
 */
export async function deliverIssueWebhook(
  eventType: "issue.created" | "issue.updated" | "issue.deleted",
  projectId: string,
  payload: any,
): Promise<void> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { workspace: { select: { orgId: true } } },
    });
    await dispatchWebhook(eventType, payload, projectId, project?.workspace?.orgId);
  } catch (err: any) {
    logger.error("WEBHOOK_DISPATCH_ERROR", `Failed to dispatch ${eventType} for project ${projectId}`, err, {
      projectId,
      eventType,
    });
  }
}
