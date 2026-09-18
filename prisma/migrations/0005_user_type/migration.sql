-- Adds User.userType: EMPLOYEE for internal staff, CLIENT for an external
-- customer contact. Existing rows become EMPLOYEE, which is what every account
-- created before this column was one.
--
-- The CHECK constraint is the database-level half of the validation: SQLite has
-- no enum type and this schema declares no Prisma enums, so without it the
-- column would accept any string. Verified to be enforced -- an insert of an
-- out-of-range value fails with
--   CHECK constraint failed: userType IN ('EMPLOYEE','CLIENT')
--
-- Note: `prisma db push` recreates tables from schema.prisma, which cannot
-- express a CHECK, so pushing would silently drop this constraint. Apply
-- schema changes to this table with `prisma migrate deploy`.
ALTER TABLE "User" ADD COLUMN "userType" TEXT NOT NULL DEFAULT 'EMPLOYEE'
  CHECK ("userType" IN ('EMPLOYEE', 'CLIENT'));

-- Supports filtering the platform user directory by type.
CREATE INDEX "User_userType_idx" ON "User"("userType");
