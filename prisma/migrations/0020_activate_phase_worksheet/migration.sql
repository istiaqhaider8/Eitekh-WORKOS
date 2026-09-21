-- SAP Activate: the per-phase deliverable worksheet.
--
-- Two columns and one unique index. Nothing is altered, dropped or retyped,
-- and every existing row keeps working: the counter starts at 0 and the code
-- starts NULL.
--
-- WHY A COUNTER AND NOT max(code) + 1
--
-- Derived from the highest code present, a phase whose D-03 was removed would
-- hand the next deliverable D-03 again, and a status report or a meeting note
-- citing D-03 would come to mean a different piece of work. The counter only
-- goes up. It is reconciled against the highest code that exists before being
-- used, so a phase whose counter has fallen behind reality — an import, a
-- restored row — jumps past it instead of colliding with it. Same rule as
-- Project.issueCounter for issue keys.
--
-- WHY phaseCode IS NULLABLE, AND WHY THE UNIQUE INDEX IS PLAIN
--
-- Most deliverables never get a code. An issue linked to a phase from the
-- board, or generated from a fit-to-standard decision, is a deliverable
-- without being a numbered line on a worksheet, and backfilling codes for
-- those would invent an ordering nobody agreed.
--
-- PostgreSQL treats NULLs as DISTINCT in a unique index, so any number of
-- uncoded deliverables coexist while two D-01s in one phase are refused.
-- That is the behaviour wanted here, and it is the OPPOSITE of what migration
-- 0016 needed, which is why that one says NULLS NOT DISTINCT and this one
-- deliberately does not.

ALTER TABLE "ActivatePhase"
  ADD COLUMN "deliverableCounter" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ActivateDeliverableLink"
  ADD COLUMN "phaseCode" TEXT;

CREATE UNIQUE INDEX "ActivateDeliverableLink_phaseId_phaseCode_key"
  ON "ActivateDeliverableLink"("phaseId", "phaseCode");
