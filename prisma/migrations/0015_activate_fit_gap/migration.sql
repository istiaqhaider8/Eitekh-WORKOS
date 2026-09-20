-- SAP Activate increment 5: the outcome of a fit-to-standard workshop.
--
-- One nullable column on "ActivateDeliverableLink", a table this branch
-- created in 0013. Nothing that existed before Activate is touched: no
-- pre-existing table is altered, no column is dropped, no type is changed.
--
-- Nullable and NOT defaulted to 'FIT' on purpose. "We ran the workshop and the
-- standard fits" is a decision a person made and is worth reading as one; "no
-- workshop has happened yet" is the normal state for most of Explore. A
-- default would make those two indistinguishable the moment the column
-- existed, and every existing row would silently claim a decision nobody took.
--
-- Deliberately a TEXT column rather than a Postgres enum. The values are
-- SAP's vocabulary, and the same reasoning as the workstream names applies:
-- if SAP renames a classification, a customer's data should not require a
-- schema migration. The allowed set is enforced by the Zod schema at the API
-- edge, which is where a bad value would otherwise get in.

ALTER TABLE "ActivateDeliverableLink" ADD COLUMN "fitGapStatus" TEXT;

-- Explore's main question is "what is still unclassified", so the index is on
-- the phase plus the classification rather than the classification alone.
CREATE INDEX "ActivateDeliverableLink_phaseId_fitGapStatus_idx"
  ON "ActivateDeliverableLink"("phaseId", "fitGapStatus");
