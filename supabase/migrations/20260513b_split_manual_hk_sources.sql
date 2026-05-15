-- F.2 schema split: manual vs HK sources for steps/calories.
--
-- BEFORE this migration, daily_scores.steps_count (and .calories_count)
-- was a single mashed column that BOTH manual logs AND HK syncs wrote
-- to additively. That caused double-counts: if HK reported 3,820 steps
-- and the user manually logged 10,000, the next HK sync added the
-- delta on top of the manual entry → 23,820 in steps_count. Truth
-- was unrecoverable.
--
-- AFTER this migration:
--   manual_steps_count    — owned by logActivity.ts (manual log path)
--   hk_steps_count        — owned by healthkit.ts (HK sync path) [unchanged]
--   steps_count           — GENERATED ALWAYS AS (manual + hk) STORED
--                           DB enforces the additive invariant; reads
--                           against steps_count see a real value.
-- Symmetric for calories.
--
-- has_manual_steps / has_manual_calories booleans dropped — the M badge
-- derives from manual_*_count > 0 going forward.
--
-- Also: narrow idx_activity_feed_no_dup_goals to once-per-day events
-- only (took_lead, all_goals). Manual steps/calories/water logs are
-- now additive — every user action creates its own audit-trail feed
-- row, no longer 23505'd by the partial unique index.
--
-- ROLLBACK (manual, pre-launch only — wipe + re-seed after):
--   ALTER TABLE daily_scores DROP COLUMN steps_count, DROP COLUMN calories_count;
--   ALTER TABLE daily_scores ADD COLUMN steps_count INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE daily_scores ADD COLUMN calories_count INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE daily_scores ADD COLUMN has_manual_steps BOOLEAN NOT NULL DEFAULT false;
--   ALTER TABLE daily_scores ADD COLUMN has_manual_calories BOOLEAN NOT NULL DEFAULT false;
--   ALTER TABLE daily_scores DROP COLUMN manual_steps_count, DROP COLUMN manual_calories_count;
--   DROP INDEX IF EXISTS idx_activity_feed_no_dup_goals;
--   CREATE UNIQUE INDEX idx_activity_feed_no_dup_goals
--     ON activity_feed (user_id, pack_id, activity_type, score_date)
--     WHERE activity_type IN ('steps','calories','water','took_lead','all_goals','goals_updated','pack_renamed');

BEGIN;

-- ── 1. Add the new manual_*_count columns ──────────────────────────────
ALTER TABLE public.daily_scores
  ADD COLUMN IF NOT EXISTS manual_steps_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_calories_count INTEGER NOT NULL DEFAULT 0;

-- ── 2. Drop the obsolete has_manual_* booleans ─────────────────────────
-- M badge derives from manual_*_count > 0 in client code (T8).
ALTER TABLE public.daily_scores
  DROP COLUMN IF EXISTS has_manual_steps,
  DROP COLUMN IF EXISTS has_manual_calories;

-- ── 3. Drop + recreate steps_count / calories_count as GENERATED ───────
-- Same transaction as columns 1+2 so reads never see an inconsistent
-- intermediate state (the previous mashed column is gone before the
-- generated column comes online; both within BEGIN/COMMIT).
ALTER TABLE public.daily_scores
  DROP COLUMN IF EXISTS steps_count,
  DROP COLUMN IF EXISTS calories_count;

ALTER TABLE public.daily_scores
  ADD COLUMN steps_count INTEGER GENERATED ALWAYS AS (manual_steps_count + hk_steps_count) STORED,
  ADD COLUMN calories_count INTEGER GENERATED ALWAYS AS (manual_calories_count + hk_calories_count) STORED;

-- ── 4. Narrow idx_activity_feed_no_dup_goals to once-per-day events ────
-- Manual steps/calories/water logs no longer 23505 silently; every
-- action produces a feed row. (took_lead and all_goals remain
-- legitimately once-per-pack-per-day per the migration 20260429 intent.)
DROP INDEX IF EXISTS public.idx_activity_feed_no_dup_goals;

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_feed_no_dup_goals
  ON public.activity_feed (user_id, pack_id, activity_type, score_date)
  WHERE activity_type IN ('took_lead', 'all_goals');

COMMIT;
