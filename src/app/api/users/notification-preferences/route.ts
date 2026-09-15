import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { z } from "zod";

// Notification types that users can opt-out of
const NOTIFICATION_TYPES = [
  "MENTION",
  "ASSIGNMENT",
  "TEAM_ASSIGNMENT",
  "COMMENT",
  "STATUS_CHANGE",
  "DUE_DATE",
  "SPRINT",
  "SYSTEM",
  "INFO",
  "ROLE",
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
  TEAM_ASSIGNMENT: { inApp: true, email: false },
  COMMENT: { inApp: true, email: false },
  STATUS_CHANGE: { inApp: true, email: false },
  DUE_DATE: { inApp: true, email: true },
  SPRINT: { inApp: true, email: false },
  SYSTEM: { inApp: true, email: false },
  INFO: { inApp: true, email: false },
  ROLE: { inApp: true, email: true },
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
