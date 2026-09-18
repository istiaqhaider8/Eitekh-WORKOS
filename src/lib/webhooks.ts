import { prisma } from "./prisma";
import { decryptField } from "./encryption";
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

const DELIVERY_TIMEOUT_MS = 10_000;

export async function dispatchWebhook(eventType: string, payload: any, projectId?: string, orgId?: string) {
  try {
    const where: any = {
      isActive: true,
      OR: [],
    };

    if (projectId) {
      where.OR.push({ projectId });
    }
    if (orgId) {
      where.OR.push({ orgId, projectId: null });
    }

    if (where.OR.length === 0) return;

    const webhooks = await prisma.webhook.findMany({ where });
    if (webhooks.length === 0) return;

    for (const webhook of webhooks) {
      try {
        let events: string[] = [];
        try {
          events = JSON.parse(webhook.events);
        } catch {
          events = webhook.events.split(",").map((e: string) => e.trim());
        }

        if (!events.includes(eventType)) continue;

        const allowed = isWebhookTargetAllowed(webhook.targetUrl);
        if (!allowed.ok) {
          logger.security(
            "WEBHOOK_TARGET_BLOCKED",
            `Refused to deliver ${eventType} to webhook ${webhook.id}: ${allowed.reason}`,
            { webhookId: webhook.id, targetUrl: webhook.targetUrl, reason: allowed.reason }
          );
          continue;
        }

        // Deliberately not awaited: a slow or hostile endpoint must not delay
        // the user's request. A timeout bounds the socket, and redirects are
        // not followed so a 302 cannot be used to reach a blocked host.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

        fetch(webhook.targetUrl, {
          method: "POST",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Event": eventType,
            "X-Webhook-Secret": decryptField(webhook.secret),
          },
          body: JSON.stringify({
            event: eventType,
            timestamp: new Date().toISOString(),
            data: payload,
          }),
        })
          .then((res) => {
            if (!res.ok) {
              logger.warn(
                "WEBHOOK_DELIVERY_NON_2XX",
                `Webhook ${webhook.id} responded ${res.status} to ${eventType}`,
                { webhookId: webhook.id, status: res.status, eventType }
              );
            }
          })
          .catch((err) => {
            logger.error("WEBHOOK_DELIVERY_FAILED", `Failed to deliver ${eventType} to webhook ${webhook.id}`, err, {
              webhookId: webhook.id,
              eventType,
            });
          })
          .finally(() => clearTimeout(timer));
      } catch (err: any) {
        logger.error("WEBHOOK_PROCESSING_ERROR", `Error processing webhook ${webhook.id}`, err, {
          webhookId: webhook.id,
        });
      }
    }
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
