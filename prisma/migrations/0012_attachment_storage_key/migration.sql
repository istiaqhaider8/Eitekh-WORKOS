-- B3 — move attachment bytes out of the database.
--
-- WHAT IS WRONG TODAY
--
-- `Attachment.fileUrl` holds a base64 `data:` URI. Every uploaded file is a
-- string in a Postgres column, so one upload inflates four things at once:
-- the table, every backup (and therefore the restore time, and therefore the
-- RTO), replication if there is ever a replica, and server memory — a base64
-- column is read whole, there is no streaming part of a text value.
--
-- WHY A NEW NULLABLE COLUMN RATHER THAN CHANGING fileUrl
--
-- Because the migration off base64 cannot be atomic. There are three states an
-- attachment can be in, and the application has to serve all of them:
--
--   storageKey set          -> in the object store, the destination
--   fileUrl is http(s)://   -> already external, redirect as before
--   fileUrl is data:        -> legacy base64, still readable, not yet moved
--
-- Rewriting `fileUrl` in place would mean a deployment where bytes exist in
-- neither the old place nor the new one for whatever rows the script had not
-- reached. A nullable column beside it means the data move is a background
-- job that can be run, paused, resumed and re-run, while every row remains
-- servable throughout.
--
-- `fileUrl` is NOT dropped here. It stays until the backfill is verified
-- complete, and dropping it is its own migration — the one that is trivial to
-- write and impossible to undo.

ALTER TABLE "Attachment" ADD COLUMN "storageKey" TEXT;

-- Partial, because the rows worth finding fast are the ones NOT yet migrated,
-- and the backfill script's query is exactly `WHERE "storageKey" IS NULL`.
CREATE INDEX "Attachment_storageKey_pending_idx"
  ON "Attachment" ("createdAt")
  WHERE "storageKey" IS NULL;
