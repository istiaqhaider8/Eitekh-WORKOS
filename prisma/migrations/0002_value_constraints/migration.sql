-- Re-applies the value constraints that lived in the SQLite migration history.
--
-- 0005_user_type and 0006_announcement_targeting added these as hand-written
-- SQL, so they are not expressed in schema.prisma and did NOT survive the
-- regenerated Postgres initial migration. Without this file, PROD-1 would have
-- silently weakened validation that was explicitly verified: on SQLite a raw
-- UPDATE of User.userType to 'CONTRACTOR' failed with
--   CHECK constraint failed: userType
-- and that must remain true on Postgres.
--
-- Still CHECK constraints rather than Postgres enums, deliberately: the
-- application treats these as strings (USER_TYPES in src/lib/validation.ts,
-- TARGET_KINDS in src/lib/announcement-targeting.ts), and introducing a real
-- enum type here would put the database and the code out of step on a value
-- set that is already single-sourced. Postgres also cannot drop an enum value,
-- which makes a CHECK the easier thing to change.

-- User.userType — EMPLOYEE (internal staff) or CLIENT (external contact).
ALTER TABLE "User"
  ADD CONSTRAINT "User_userType_check"
  CHECK ("userType" IN ('EMPLOYEE', 'CLIENT'));

-- SystemAnnouncement audience mode and how its target kinds combine.
ALTER TABLE "SystemAnnouncement"
  ADD CONSTRAINT "SystemAnnouncement_audienceMode_check"
  CHECK ("audienceMode" IN ('ALL', 'FILTERED'));

ALTER TABLE "SystemAnnouncement"
  ADD CONSTRAINT "SystemAnnouncement_matchMode_check"
  CHECK ("matchMode" IN ('ANY', 'ALL'));

-- AnnouncementTarget.kind — the seven targeting dimensions.
ALTER TABLE "AnnouncementTarget"
  ADD CONSTRAINT "AnnouncementTarget_kind_check"
  CHECK ("kind" IN ('ORG', 'PROJECT', 'TEAM', 'USER', 'USER_TYPE', 'ORG_ROLE', 'PROJECT_ROLE'));
