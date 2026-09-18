-- Audience targeting for announcements.
--
-- Before this, SystemAnnouncement.targetAudience was a free-text label that
-- nothing read: /api/announcements returned every active announcement to every
-- signed-in user, and "broadcast" notified every active account. Targeting was
-- therefore decorative. These columns plus AnnouncementTarget make it real, and
-- the resolver in src/lib/announcement-targeting.ts is the only thing that
-- decides who matches.
--
-- CHECK constraints rather than Prisma enums: this schema declares none and
-- SQLite has no enum type, so without them the columns would take any string.
-- Note `prisma db push` rebuilds tables from schema.prisma and cannot express a
-- CHECK, so it would silently drop these -- use `prisma migrate deploy`.

ALTER TABLE "SystemAnnouncement" ADD COLUMN "audienceMode" TEXT NOT NULL DEFAULT 'ALL'
  CHECK ("audienceMode" IN ('ALL', 'FILTERED'));

ALTER TABLE "SystemAnnouncement" ADD COLUMN "matchMode" TEXT NOT NULL DEFAULT 'ANY'
  CHECK ("matchMode" IN ('ANY', 'ALL'));

ALTER TABLE "SystemAnnouncement" ADD COLUMN "createdById" TEXT;

CREATE INDEX "SystemAnnouncement_isActive_startsAt_idx"
  ON "SystemAnnouncement"("isActive", "startsAt");

CREATE TABLE "AnnouncementTarget" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "announcementId" TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "value"          TEXT NOT NULL,
  CONSTRAINT "AnnouncementTarget_announcementId_fkey"
    FOREIGN KEY ("announcementId") REFERENCES "SystemAnnouncement" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AnnouncementTarget_kind_check"
    CHECK ("kind" IN ('ORG', 'PROJECT', 'TEAM', 'USER', 'USER_TYPE', 'ORG_ROLE', 'PROJECT_ROLE'))
);

-- One rule per (announcement, kind, value): re-selecting the same audience must
-- not silently create duplicate rows.
CREATE UNIQUE INDEX "AnnouncementTarget_announcementId_kind_value_key"
  ON "AnnouncementTarget"("announcementId", "kind", "value");
CREATE INDEX "AnnouncementTarget_announcementId_idx" ON "AnnouncementTarget"("announcementId");
CREATE INDEX "AnnouncementTarget_kind_value_idx" ON "AnnouncementTarget"("kind", "value");
