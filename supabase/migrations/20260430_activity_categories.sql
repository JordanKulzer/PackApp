-- Adds per-row activity category for workout sub-types and a per-user
-- pinned-categories list driving the LogSheet "Quick Select" UI.
--
-- Additive only: no CHECK constraint on activity_feed.category yet — we'll
-- add one after the rollout stabilizes and we've confirmed no edge categories
-- slip through. NULL is allowed; non-workout activity_feed rows leave it NULL.
--
-- quick_select_categories is a text[] (not text) so users can pin up to 6
-- categories with order preserved (first pinned is leftmost in the grid).
-- DEFAULT '{}'::text[] avoids null-handling at every call site.

ALTER TABLE activity_feed
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS quick_select_categories text[]
    NOT NULL DEFAULT ARRAY[]::text[];

-- No backfill: test data is disposable; pre-existing workout rows stay
-- category=NULL, which the UI treats as "Other" (legacy row).
