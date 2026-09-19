import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { z } from "zod";

/**
 * The notification types a user can turn off.
 *
 * C3 — EVERY ENTRY HERE MUST BE A TYPE THE SERVER ACTUALLY SENDS.
 *
 * This list used to offer ten toggles. Four of them corresponded to a
 * notification that was really dispatched; the other six did not, so turning
 * them on or off changed nothing at all. That is worse than not offering them:
 * the user believes they have configured something, the notification never
 * arrives, and the conclusion is that the product is broken rather than that
 * the switch was decorative.
 *
 * Two of the six were worth building rather than deleting — COMMENT and
 * STATUS are the notifications anyone expects from an issue tracker — and are
 * now dispatched from the comments and issue-update routes.
 *
 * The remaining four were REMOVED rather than implemented, because each needs
 * a product decision this list is the wrong place to make:
 *
 *   TEAM_ASSIGNMENT  assigning an issue to a team of 30 — does everyone hear?
 *   DUE_DATE         on change, or as a reminder? how long before?
 *   SPRINT           on every scope change, or only start and complete?
 *   ROLE             the grantee only, or the project admins too?
 *
 * They are not lost: each is a feature request with an obvious home, and when
 * one is built its toggle comes back here at the same time. What must not
 * happen again is a control shipping ahead of the thing it controls.
 *
 * NOTE the key is STATUS, not STATUS_CHANGE. It was STATUS_CHANGE while the
 * dispatch type was STATUS, so the preference lookup — `prefs[type]` — could
 * never have found it. That toggle would have stayed inert even after the
 * notification was implemented, which is the kind of bug that gets diagnosed
 * as "notifications are flaky".
 */
const NOTIFICATION_TYPES = [
  "MENTION",
  "ASSIGNMENT",
  "COMMENT",
  "STATUS",
  "SYSTEM",
  "INFO",
] as const;

type NotifType = (typeof NOTIFICATION_TYPES)[number];

interface PrefEntry {
  inApp: boolean;
  email: boolean;
}

type NotifPrefs = Partial<Record<NotifType, PrefEntry>>;

const DEFAULT_PREFS: Record<NotifType, PrefEntry> = {
  MENTION: { inApp: true, email: true },
  ASSIGNMENT: { inApp: true, email: true },
  // In-app on, email off. A busy issue produces a lot of these, and the
  // fastest way to make a notification system worthless is to make its email
  // volume high enough that people filter it to a folder they never open.
  COMMENT: { inApp: true, email: false },
  STATUS: { inApp: true, email: false },
  SYSTEM: { inApp: true, email: false },
  INFO: { inApp: true, email: false },
};

function parsePrefs(raw: string | null): Record<NotifType, PrefEntry> {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const parsed = JSON.parse(raw) as NotifPrefs;
    return Object.fromEntries(
      NOTIFICATION_TYPES.map((t) => [
        t,
        {
          inApp: parsed[t]?.inApp ?? DEFAULT_PREFS[t].inApp,
          email: parsed[t]?.email ?? DEFAULT_PREFS[t].email,
        },
      ])
    ) as Record<NotifType, PrefEntry>;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

const updateSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(["inApp", "email"]),
  enabled: z.boolean(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { notificationPrefs: true },
  });

  const prefs = parsePrefs(record?.notificationPrefs ?? null);
  return NextResponse.json({ prefs, types: NOTIFICATION_TYPES });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const { type, channel, enabled } = parsed.data;

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { notificationPrefs: true },
  });

  const prefs = parsePrefs(record?.notificationPrefs ?? null);
  prefs[type][channel] = enabled;

  await prisma.user.update({
    where: { id: user.id },
    data: { notificationPrefs: JSON.stringify(prefs) },
  });

  return NextResponse.json({ success: true, prefs });
}
