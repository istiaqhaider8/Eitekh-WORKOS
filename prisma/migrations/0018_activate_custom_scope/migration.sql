-- SAP Activate: scope items a project adds for itself.
--
-- One new table. Nothing existing is altered, dropped or retyped.
--
-- WHY A SEPARATE TABLE RATHER THAN ROWS IN TemplateScopeItem
--
-- The built-in methodology and every content pack are SHARED: one row, read
-- by every tenant that seeds from that template. Writing a customer's own
-- scope item into that catalogue would put it in front of all of them. So a
-- custom item is scoped by projectId with a real foreign key and a cascade,
-- and the catalogue a project sees is assembled at read time from the
-- template's items plus its own. The two are never merged in the database.
--
-- WHY moduleId HAS NO FOREIGN KEY
--
-- Same reason the profile's template stamp has none: a running project has to
-- outlive the template it was seeded from. If a customer retires a template,
-- their in-flight projects keep working and a custom item filed under one of
-- its modules simply falls back to the project's own grouping.
--
-- The code is unique per project because a decision log cites it. Two people
-- adding an item in the same workshop must not be able to produce two items
-- answering to the same code.

CREATE TABLE "ActivateCustomScopeItem" (
  "id"            TEXT NOT NULL,
  "projectId"     TEXT NOT NULL,
  "moduleId"      TEXT,
  "code"          TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "workstreamKey" TEXT NOT NULL,
  "tags"          TEXT,
  "position"      INTEGER NOT NULL DEFAULT 0,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActivateCustomScopeItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActivateCustomScopeItem_projectId_code_key"
  ON "ActivateCustomScopeItem"("projectId", "code");
CREATE INDEX "ActivateCustomScopeItem_projectId_idx"
  ON "ActivateCustomScopeItem"("projectId");

ALTER TABLE "ActivateCustomScopeItem" ADD CONSTRAINT "ActivateCustomScopeItem_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivateCustomScopeItem" ADD CONSTRAINT "ActivateCustomScopeItem_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
