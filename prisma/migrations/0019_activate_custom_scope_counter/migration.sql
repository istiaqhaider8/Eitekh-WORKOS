-- SAP Activate: a monotonic allocator for custom scope-item codes.
--
-- One nullable-free column with a default. Nothing is altered, dropped or
-- retyped, and every existing profile starts at 0.
--
-- WHY A COUNTER RATHER THAN max(code)
--
-- The first implementation derived the next code from the highest one that
-- existed. That is correct until somebody removes an item: with the last
-- custom item gone the maximum falls back to zero and the next item is handed
-- CUS-01 again. A fit-to-standard workshop cites scope items by code in its
-- minutes, in a gate pack and in the decision log, so a reused code makes an
-- earlier record point at a different item, silently.
--
-- Starting every existing profile at 0 is safe because the allocator
-- reconciles against the highest code actually present before it hands one
-- out — exactly what Project.issueCounter does for issue keys, and for the
-- same reason: a counter that has fallen behind reality must jump past it
-- rather than collide with it.

ALTER TABLE "ActivateProfile"
  ADD COLUMN "customScopeCounter" INTEGER NOT NULL DEFAULT 0;
