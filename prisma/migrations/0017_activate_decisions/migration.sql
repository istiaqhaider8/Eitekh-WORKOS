-- SAP Activate increments 9 and 10: modules, scope items, decisions, deltas.
--
-- Five new tables, one nullable column on "ActivateDeliverableLink", and a
-- vocabulary widening on an existing column of that same table -- all of them
-- created by this branch in 0013/0015. Nothing that existed before Activate is
-- touched.
--
-- THE VOCABULARY WIDENING
--
-- fitGapStatus shipped in 0015 with three values: FIT, GAP, ACCEPTED_GAP. The
-- decision model needs six, because GAP collapses three outcomes that produce
-- completely different downstream work: tailoring the standard, building
-- something custom, and connecting another system. One vocabulary is used by
-- both ActivateDecision.decision and fitGapStatus so the product has one set
-- of words rather than two.
--
-- The mapping is stated here because it involves judgement and should not have
-- to be reconstructed later from behaviour:
--
--   FIT          -> ADOPT          the standard covers it, unchanged
--   GAP          -> CONFIGURE      the least-committal of the three change
--                                  outcomes. CONFIGURE can be revised upward
--                                  to EXTEND or INTEGRATE after someone looks,
--                                  whereas guessing EXTEND would assert custom
--                                  work that nobody agreed to build
--   ACCEPTED_GAP -> OUT_OF_SCOPE   the difference is acknowledged and will not
--                                  be closed. NOT deferred, which means later
--
-- Done now rather than later on purpose: the column holds a handful of rows in
-- development and none anywhere else, so the mapping costs nothing today. Once
-- a real backlog has been classified against three values it becomes a
-- migration with arguments in it.

UPDATE "ActivateDeliverableLink" SET "fitGapStatus" = 'ADOPT'        WHERE "fitGapStatus" = 'FIT';
UPDATE "ActivateDeliverableLink" SET "fitGapStatus" = 'CONFIGURE'    WHERE "fitGapStatus" = 'GAP';
UPDATE "ActivateDeliverableLink" SET "fitGapStatus" = 'OUT_OF_SCOPE' WHERE "fitGapStatus" = 'ACCEPTED_GAP';

-- Idempotent generation. A generated deliverable carries the key of whatever
-- produced it, so re-running generation converges instead of creating a second
-- copy of every item. Globally unique because the key embeds a decision id.
--
-- Deliberately NOT positional. The reference build this design was compared
-- against numbered its backlog BL-001, BL-002 by iteration order, so recording
-- one more decision renumbered everything after it, which breaks the moment
-- anyone cites an item in a meeting or diffs two exports.
ALTER TABLE "ActivateDeliverableLink" ADD COLUMN "originKey" TEXT;
CREATE UNIQUE INDEX "ActivateDeliverableLink_originKey_key" ON "ActivateDeliverableLink"("originKey");

CREATE TABLE "TemplateModule" (
  "id"          TEXT NOT NULL,
  "templateId"  TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TemplateModule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateScopeItem" (
  "id"            TEXT NOT NULL,
  "moduleId"      TEXT NOT NULL,
  "code"          TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "workstreamKey" TEXT NOT NULL,
  "tags"          TEXT,
  "position"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TemplateScopeItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivateProjectModule" (
  "id"         TEXT NOT NULL,
  "projectId"  TEXT NOT NULL,
  "moduleId"   TEXT NOT NULL,
  "inScope"    BOOLEAN NOT NULL DEFAULT true,
  "waveNumber" INTEGER,
  "ownerId"    TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActivateProjectModule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivateDecision" (
  "id"              TEXT NOT NULL,
  "projectId"       TEXT NOT NULL,
  "scopeItemId"     TEXT NOT NULL,
  "decision"        TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'DRAFT',
  "rationale"       TEXT,
  "openQuestion"    TEXT,
  "questionOwnerId" TEXT,
  "decidedById"     TEXT,
  "decidedAt"       TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "version"         INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ActivateDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivateDelta" (
  "id"             TEXT NOT NULL,
  "decisionId"     TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "buildType"      TEXT NOT NULL DEFAULT 'CONFIGURATION',
  "priority"       TEXT NOT NULL DEFAULT 'SHOULD',
  "size"           TEXT NOT NULL DEFAULT 'M',
  "ownerId"        TEXT,
  "targetPhaseKey" TEXT,
  "note"           TEXT,
  "position"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActivateDelta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TemplateModule_templateId_key_key" ON "TemplateModule"("templateId", "key");
CREATE INDEX "TemplateModule_templateId_idx" ON "TemplateModule"("templateId");

CREATE UNIQUE INDEX "TemplateScopeItem_moduleId_code_key" ON "TemplateScopeItem"("moduleId", "code");
CREATE INDEX "TemplateScopeItem_moduleId_idx" ON "TemplateScopeItem"("moduleId");

CREATE UNIQUE INDEX "ActivateProjectModule_projectId_moduleId_key" ON "ActivateProjectModule"("projectId", "moduleId");
CREATE INDEX "ActivateProjectModule_projectId_idx" ON "ActivateProjectModule"("projectId");

CREATE UNIQUE INDEX "ActivateDecision_projectId_scopeItemId_key" ON "ActivateDecision"("projectId", "scopeItemId");
CREATE INDEX "ActivateDecision_projectId_idx" ON "ActivateDecision"("projectId");
CREATE INDEX "ActivateDecision_projectId_decision_idx" ON "ActivateDecision"("projectId", "decision");

CREATE INDEX "ActivateDelta_decisionId_idx" ON "ActivateDelta"("decisionId");

ALTER TABLE "TemplateModule" ADD CONSTRAINT "TemplateModule_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "MethodTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateScopeItem" ADD CONSTRAINT "TemplateScopeItem_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "TemplateModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivateProjectModule" ADD CONSTRAINT "ActivateProjectModule_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivateProjectModule" ADD CONSTRAINT "ActivateProjectModule_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivateDecision" ADD CONSTRAINT "ActivateDecision_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivateDecision" ADD CONSTRAINT "ActivateDecision_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivateDecision" ADD CONSTRAINT "ActivateDecision_questionOwnerId_fkey"
  FOREIGN KEY ("questionOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivateDelta" ADD CONSTRAINT "ActivateDelta_decisionId_fkey"
  FOREIGN KEY ("decisionId") REFERENCES "ActivateDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivateDelta" ADD CONSTRAINT "ActivateDelta_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
