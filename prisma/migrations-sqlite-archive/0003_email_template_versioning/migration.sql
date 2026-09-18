-- AlterTable: add version counter to EmailTemplate
ALTER TABLE "EmailTemplate" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable: snapshot store for historical email template versions
CREATE TABLE "EmailTemplateVersion" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "templateKey" TEXT NOT NULL,
  "version"     INTEGER NOT NULL,
  "subject"     TEXT NOT NULL,
  "bodyHtml"    TEXT NOT NULL,
  "savedBy"     TEXT,
  "savedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "EmailTemplateVersion_templateKey_idx" ON "EmailTemplateVersion"("templateKey");
CREATE UNIQUE INDEX "EmailTemplateVersion_templateKey_version_key" ON "EmailTemplateVersion"("templateKey", "version");
