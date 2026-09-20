-- SAP Activate increment 8: methodology templates and variants.
--
-- Five new tables, plus two nullable columns on "ActivateProfile" — a table
-- this branch created in 0013. Nothing that existed before Activate is
-- altered, nothing is dropped, and no column changes type.
--
-- WHY templateId IS NULLABLE AND NOT BACKFILLED
--
-- A project seeded before templates existed was not stamped with one. Writing
-- a stamp onto it now would put a claim in the database that nobody made, and
-- the whole value of the stamp is that it records a decision. Null reads as
-- "the built-in methodology as it stood before templates", which is the truth.
--
-- WHY THERE IS NO FOREIGN KEY FROM ActivateProfile TO MethodTemplate
--
-- Deliberate. A running project's plan must outlive the template it came from:
-- if a customer retires or deletes a template, their in-flight projects keep
-- working. A foreign key would make deletion either impossible or destructive,
-- and both are worse than an id that no longer resolves.
--
-- WHY orgId ON MethodTemplate IS NULLABLE
--
-- Null = built-in, shipped with the product, the same for every tenant, and
-- read-only. Set = an organization's own. One table serves both rather than
-- forcing a choice between shipping templates and letting customers author
-- them; both need to be true.

ALTER TABLE "ActivateProfile" ADD COLUMN "templateId" TEXT;
ALTER TABLE "ActivateProfile" ADD COLUMN "templateVersion" INTEGER;
CREATE INDEX "ActivateProfile_templateId_idx" ON "ActivateProfile"("templateId");

CREATE TABLE "MethodTemplate" (
  "id"          TEXT NOT NULL,
  "orgId"       TEXT,
  "key"         TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "variant"     TEXT,
  "version"     INTEGER NOT NULL DEFAULT 1,
  "status"      TEXT NOT NULL DEFAULT 'PUBLISHED',
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MethodTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplatePhase" (
  "id"         TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "position"   INTEGER NOT NULL DEFAULT 0,
  "purpose"    TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TemplatePhase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateWorkstream" (
  "id"         TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "position"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TemplateWorkstream_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateGate" (
  "id"          TEXT NOT NULL,
  "phaseId"     TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "isMandatory" BOOLEAN NOT NULL DEFAULT true,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TemplateGate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateGateCriterion" (
  "id"        TEXT NOT NULL,
  "gateId"    TEXT NOT NULL,
  "criterion" TEXT NOT NULL,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TemplateGateCriterion_pkey" PRIMARY KEY ("id")
);

-- A template is identified by (owner, key, version).
--
-- NULLS NOT DISTINCT IS LOad-BEARING, NOT DECORATION.
--
-- Postgres treats NULLs as DISTINCT in a unique index by default, so a plain
-- unique on (orgId, key, version) would place no constraint at all on the
-- built-in templates — every one of which has orgId NULL. Two rows of
-- (NULL, 'SAP_ACTIVATE', 1) would both be accepted, and the idempotent seed
-- this index exists to guarantee would silently start creating a second
-- built-in methodology on a concurrent call.
--
-- Requires Postgres 15 or later; this deployment runs 18.
CREATE UNIQUE INDEX "MethodTemplate_orgId_key_version_key"
  ON "MethodTemplate"("orgId", "key", "version") NULLS NOT DISTINCT;
CREATE INDEX "MethodTemplate_orgId_idx"  ON "MethodTemplate"("orgId");
CREATE INDEX "MethodTemplate_status_idx" ON "MethodTemplate"("status");

CREATE UNIQUE INDEX "TemplatePhase_templateId_key_key" ON "TemplatePhase"("templateId", "key");
CREATE INDEX "TemplatePhase_templateId_idx" ON "TemplatePhase"("templateId");

CREATE UNIQUE INDEX "TemplateWorkstream_templateId_key_key" ON "TemplateWorkstream"("templateId", "key");
CREATE INDEX "TemplateWorkstream_templateId_idx" ON "TemplateWorkstream"("templateId");

CREATE INDEX "TemplateGate_phaseId_idx" ON "TemplateGate"("phaseId");
CREATE INDEX "TemplateGateCriterion_gateId_idx" ON "TemplateGateCriterion"("gateId");

ALTER TABLE "MethodTemplate" ADD CONSTRAINT "MethodTemplate_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplatePhase" ADD CONSTRAINT "TemplatePhase_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "MethodTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateWorkstream" ADD CONSTRAINT "TemplateWorkstream_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "MethodTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateGate" ADD CONSTRAINT "TemplateGate_phaseId_fkey"
  FOREIGN KEY ("phaseId") REFERENCES "TemplatePhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateGateCriterion" ADD CONSTRAINT "TemplateGateCriterion_gateId_fkey"
  FOREIGN KEY ("gateId") REFERENCES "TemplateGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
