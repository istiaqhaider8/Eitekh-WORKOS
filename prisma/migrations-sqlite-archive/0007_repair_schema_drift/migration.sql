-- PROD-0: repair the drift between the migration history and schema.prisma.
--
-- The history did not reproduce the schema. `prisma migrate deploy` against a
-- clean database produced one with NO OtpCode and NO Invitation table, while
-- reporting "All migrations have been successfully applied" -- so OTP/MFA login
-- (src/lib/otp.ts) and the whole invitation flow (api/auth/invite,
-- api/auth/invitation) failed on first use anywhere the schema had not been
-- built with `db push`. `prisma migrate status` does not detect this; it only
-- checks whether the local database has the recorded migrations applied, not
-- whether those migrations describe the schema. Use `migrate diff` for that.
--
-- Generated with:
--   prisma migrate diff --from-migrations prisma/migrations \
--     --to-schema-datamodel prisma/schema.prisma --script
--
-- Reviewed before committing. Nothing here is destructive:
--   * OtpCode and Invitation are new tables.
--   * SystemEmailConfig is rebuilt only because its senderName default changed
--     from 'Zenith WorkOS' to 'Eitekh WorkOS' (the rebrand). A default applies
--     to new rows only, and the INSERT...SELECT below copies every existing
--     column, so no stored value changes. This is Prisma's standard SQLite
--     table-rebuild; SQLite cannot ALTER a column default in place.

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "usedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SystemEmailConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "senderEmail" TEXT NOT NULL DEFAULT 'cocofbd@gmail.com',
    "senderName" TEXT NOT NULL DEFAULT 'Eitekh WorkOS',
    "smtpHost" TEXT DEFAULT 'smtp.gmail.com',
    "smtpPort" INTEGER DEFAULT 587,
    "smtpUser" TEXT DEFAULT 'cocofbd@gmail.com',
    "smtpPass" TEXT,
    "isSecure" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SystemEmailConfig" ("id", "isEnabled", "isSecure", "senderEmail", "senderName", "smtpHost", "smtpPass", "smtpPort", "smtpUser", "updatedAt") SELECT "id", "isEnabled", "isSecure", "senderEmail", "senderName", "smtpHost", "smtpPass", "smtpPort", "smtpUser", "updatedAt" FROM "SystemEmailConfig";
DROP TABLE "SystemEmailConfig";
ALTER TABLE "new_SystemEmailConfig" RENAME TO "SystemEmailConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OtpCode_email_purpose_idx" ON "OtpCode"("email", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

