-- M4 — extend optimistic locking beyond Issue.
--
-- WHAT B1 LEFT UNFINISHED
--
-- 0006 put a `version` column on "Issue" because two people editing the same
-- issue is the normal case on a busy team and the second write simply won:
-- no error, no warning, no trace. That reasoning does not stop at issues.
-- Every table below is edited through a multi-field form by more than one
-- person, and had exactly the same silent last-write-wins behaviour.
--
-- WHY THESE SIX
--
--   Project        settings and configuration, edited by several admins
--   Sprint         name, goal and dates, edited live during planning
--   Epic           the same, one level up
--   Comment        long-form prose; a lost edit loses somebody's writing
--   Subtask        title, assignee and status, edited from two views at once
--   AutomationRule rules with consequences; a lost edit re-enables behaviour
--
-- DELIBERATELY NOT INCLUDED
--
--   Component      one short name; there is no concurrent-edit story to tell,
--                  and a gauge that cannot move is noise.
--   PbacRole       its writes go through pbacEngine, which already has a
--                  `version` of its own on PbacOrgState for cache
--                  invalidation. Adding a second, unrelated version concept to
--                  the same subsystem would confuse "the model changed, drop
--                  your caches" with "you edited a stale copy".
--
-- DEFAULT 0 matches Issue, so existing rows start where a fresh one would and
-- no backfill is needed. The column is additive and the guard is opt-in — a
-- client that sends no `version` behaves exactly as it does today — so this
-- migration cannot break a running deployment.

ALTER TABLE "Project"        ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Sprint"         ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Epic"           ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Comment"        ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subtask"        ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutomationRule" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
