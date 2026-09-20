-- SAP Activate increment 4: separation of duties on gate sign-off.
--
-- Two nullable columns and one foreign key on "ActivateGate", a table THIS
-- BRANCH created in 0013. Nothing that existed before Activate is touched:
-- no pre-existing table is altered, no column is dropped, no type is changed.
--
-- The columns are nullable because a gate starts unraised, so every existing
-- row is valid as-is and the migration needs no backfill.
--
-- WHY A COLUMN RATHER THAN THE AUDIT LOG
--
-- "The person who raises a gate cannot approve it" needs a stored answer to
-- "who raised it". Deriving that from the audit log would make an
-- authorization control depend on log retention: once the log rotated, the
-- rule would quietly start permitting self-approval. A control that weakens
-- when logs age is not a control.

ALTER TABLE "ActivateGate" ADD COLUMN "raisedById" TEXT;
ALTER TABLE "ActivateGate" ADD COLUMN "raisedAt" TIMESTAMP(3);

CREATE INDEX "ActivateGate_raisedById_idx" ON "ActivateGate"("raisedById");

ALTER TABLE "ActivateGate"
  ADD CONSTRAINT "ActivateGate_raisedById_fkey"
  FOREIGN KEY ("raisedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
