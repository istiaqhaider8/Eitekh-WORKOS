-- D1 — full-text search.
--
-- WHAT WAS WRONG
--
-- /api/search matched with Prisma `contains` + `mode: "insensitive"`, which is
-- ILIKE '%term%'. A leading wildcard cannot use a B-tree index, so every search
-- was a sequential scan. Measured on the volume dataset (20,000 issues):
--
--   Seq Scan on "Issue"  ...  Rows Removed by Filter: 18017
--   Execution Time: 83.671 ms
--
-- 84 ms at 20,000 rows, growing linearly, for the feature people use most and
-- judge fastest. There was also no ranking at all: issues came back ordered by
-- createdAt, so the best match was wherever it happened to fall, and comments
-- and projects came back in no order whatsoever.
--
-- WHY GENERATED COLUMNS RATHER THAN TRIGGERS
--
-- A generated column is maintained by Postgres as part of the write, so it
-- cannot drift from the columns it summarises. A trigger does the same job and
-- is one more thing to remember on the next schema change — and a search index
-- that silently stops being updated is worse than no search index, because the
-- results look plausible.
--
-- `to_tsvector('english', ...)` is IMMUTABLE only when the configuration is
-- named explicitly. Passing a bare column (relying on default_text_search_config)
-- is STABLE, not IMMUTABLE, and Postgres rejects it in a generated column.
--
-- WEIGHTS
--
-- setweight marks which field a lexeme came from, and ts_rank uses it:
--
--   A  the key (VP1-7) and the title — what people actually search for
--   B  the description
--
-- A title match therefore outranks a body match for the same term, which is
-- the behaviour anyone expects and what the old ORDER BY createdAt could not
-- express.

-- ---------------------------------------------------------------- Issue
ALTER TABLE "Issue"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("issueKey", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX "Issue_searchVector_idx" ON "Issue" USING GIN ("searchVector");

-- ---------------------------------------------------------------- Comment
ALTER TABLE "Comment"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(content, ''))
  ) STORED;

CREATE INDEX "Comment_searchVector_idx" ON "Comment" USING GIN ("searchVector");

-- ---------------------------------------------------------------- Project
ALTER TABLE "Project"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(key, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX "Project_searchVector_idx" ON "Project" USING GIN ("searchVector");

-- ----------------------------------------------------------------
-- A NOTE ON BACKFILL: there is none, and none is needed. A generated column is
-- computed for every existing row as part of the ALTER TABLE, which is why this
-- migration rewrites the table. On a large Issue table that is a lock worth
-- planning for — see DEPLOYMENT.md — but it means there is no window in which
-- the index exists and is empty, which a trigger-based approach would have.
