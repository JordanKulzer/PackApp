-- supabase/migrations/20260519_categories_pivot_stage1.sql
--
-- Categories Pivot — Stage 1: schema groundwork only.
--
-- Pack is moving from points-based scoring to per-category daily winners.
-- This migration is schema-only — no application code reads the new shape
-- yet, and FEATURE_FLAGS.dailyWinner stays false through Stage 1.
--
-- What this migration does:
--   1.  Backfills the daily_winners table definition into migration history.
--       The table currently exists in production but was created out-of-band
--       (no migration file ever defined it). CREATE TABLE IF NOT EXISTS makes
--       this a no-op against production while still provisioning clean dev
--       environments. NOTE: because of IF NOT EXISTS, the FK ON DELETE CASCADE
--       clauses below only take effect on environments where the table does
--       NOT already exist — production keeps whatever delete behavior its
--       existing FKs were created with.
--   2-9. Transforms daily_winners from one-winner-per-day to one-winner-per-
--       day-per-category.
--   10. Adds run_category_winners for end-of-run aggregation.
--   11. Rewrites compute_daily_winners_for_pack to compute per-category
--       winners and to stop writing activity_feed 'daily_winner' rows.
--
-- Explicitly NOT done here (deferred to a Phase B cleanup migration):
--   - runs.winner_id is left untouched.
--   - daily_scores.total_points / streak_multiplier are left untouched.
--   - activity_feed.points_earned and the daily_winner row type are left
--     untouched (the RPC simply stops writing new daily_winner rows).
--   - daily_scores and activity_feed tables are not modified at all.
--
-- Re-runnable: every step is guarded (IF NOT EXISTS / IF EXISTS / drop-then-
-- add / existence-checked rename), so applying twice is safe.

BEGIN;

-- ── 1. Backfill daily_winners definition ───────────────────────────────
-- Matches the existing production structure: PK on id, UNIQUE on
-- (pack_id, score_date). The UNIQUE constraint is created here so step 2
-- has a named constraint to drop on clean dev environments; in production
-- the table already exists and this whole statement is skipped.
CREATE TABLE IF NOT EXISTS public.daily_winners (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES public.packs(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  score_date date NOT NULL,
  winner_user_ids uuid[] NOT NULL,
  winning_points integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_winners_pkey PRIMARY KEY (id),
  CONSTRAINT daily_winners_pack_id_score_date_key UNIQUE (pack_id, score_date)
);

-- ── 2. Drop the old single-winner-per-day unique constraint ────────────
-- (pack_id, score_date) blocks more than one winner row per pack per day,
-- which is incompatible with per-category winners.
ALTER TABLE public.daily_winners
  DROP CONSTRAINT IF EXISTS daily_winners_pack_id_score_date_key;

-- ── 3. Add the category column (nullable first, for a safe backfill) ────
ALTER TABLE public.daily_winners
  ADD COLUMN IF NOT EXISTS category text;

-- ── 4. Backfill any pre-existing rows ──────────────────────────────────
-- The table should be empty (the daily-winner feature is flagged off), but
-- this is defensive: any stray row gets tagged 'legacy' so step 5 can set
-- NOT NULL and the step-6 CHECK constraint accepts it.
UPDATE public.daily_winners
  SET category = 'legacy'
  WHERE category IS NULL;

-- ── 5. Make category NOT NULL ──────────────────────────────────────────
ALTER TABLE public.daily_winners
  ALTER COLUMN category SET NOT NULL;

-- ── 6. Constrain category to the known values ──────────────────────────
-- Drop-then-add (ADD CONSTRAINT has no IF NOT EXISTS) — re-runnable, and
-- matches the activity_feed CHECK-constraint pattern used elsewhere in
-- these migrations. 'legacy' is included as an escape valve for any rows
-- backfilled in step 4.
ALTER TABLE public.daily_winners
  DROP CONSTRAINT IF EXISTS daily_winners_category_check;
ALTER TABLE public.daily_winners
  ADD CONSTRAINT daily_winners_category_check
  CHECK (category IN ('steps', 'workouts', 'calories', 'water', 'legacy'));

-- ── 7. Rename winning_points → winning_metric_value ────────────────────
-- More honest name: under per-category winners this holds the actual
-- metric count (steps, workout count, calories, oz of water) — not points.
-- Guarded so a re-run (column already renamed) is a no-op; RENAME COLUMN
-- has no IF EXISTS clause of its own.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'daily_winners'
      AND column_name = 'winning_points'
  ) THEN
    ALTER TABLE public.daily_winners
      RENAME COLUMN winning_points TO winning_metric_value;
  END IF;
END $$;

-- ── 8. New unique constraint including category ────────────────────────
-- One winner row per pack per day per category. Drop-then-add for
-- re-runnability. The RPC's ON CONFLICT (pack_id, score_date, category)
-- infers this constraint from its column list.
ALTER TABLE public.daily_winners
  DROP CONSTRAINT IF EXISTS daily_winners_pack_id_score_date_category_key;
ALTER TABLE public.daily_winners
  ADD CONSTRAINT daily_winners_pack_id_score_date_category_key
  UNIQUE (pack_id, score_date, category);

-- ── 9. Recent-winners index, now category-aware ────────────────────────
DROP INDEX IF EXISTS public.idx_daily_winners_pack_date;
CREATE INDEX IF NOT EXISTS idx_daily_winners_pack_date_category
  ON public.daily_winners (pack_id, score_date DESC, category);

-- ── 10. run_category_winners — end-of-run aggregation ──────────────────
-- One row per run per category, recording who won that category the most
-- days over the run. No 'legacy' value here — this table is new and never
-- holds pre-pivot rows.
CREATE TABLE IF NOT EXISTS public.run_category_winners (
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  category text NOT NULL
    CHECK (category IN ('steps', 'workouts', 'calories', 'water')),
  winner_user_ids uuid[] NOT NULL,
  total_days_won integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_category_winners_pkey PRIMARY KEY (run_id, category)
);

-- ── 11. Rewrite compute_daily_winners_for_pack ─────────────────────────
-- Outer structure preserved verbatim from the original: pack lookup +
-- NOT FOUND return, timezone resolution, yesterday-in-pack-tz, solo-pack
-- skip, last-computed lookup, run iteration, and the per-day WHILE loop
-- with its GREATEST/LEAST bounds and +1 increment.
--
-- Inner winner-determination replaced: instead of a single winner by
-- MAX(total_points), each enabled category produces its own winner by
-- MAX of that category's metric column in daily_scores. A value of 0 or
-- NULL (no one logged that category that day) is skipped.
--
-- The original per-day `EXISTS (... score_date = v_current_date)` guard is
-- intentionally removed — idempotency is now handled per category by
-- ON CONFLICT (pack_id, score_date, category) DO NOTHING. Days are still
-- computed all-categories-at-once within this single-transaction function,
-- so MAX(score_date) remains an accurate "last fully computed day" marker.
--
-- The original FOREACH-winner activity_feed INSERT block is removed
-- entirely: the new UI reads daily_winners directly, so the system
-- 'daily_winner' feed row is no longer produced.
CREATE OR REPLACE FUNCTION public.compute_daily_winners_for_pack(p_pack_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_pack record;
  v_timezone text;
  v_yesterday date;
  v_active_member_count integer;
  v_last_computed date;
  v_current_date date;
  v_run record;
  v_winning_value integer;
  v_winner_ids uuid[];
BEGIN
  -- Load pack
  SELECT * INTO v_pack FROM public.packs WHERE id = p_pack_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_timezone := COALESCE(v_pack.timezone, 'UTC');

  -- Yesterday in pack timezone
  v_yesterday := (now() AT TIME ZONE v_timezone)::date - 1;

  -- Skip solo packs
  SELECT COUNT(*) INTO v_active_member_count
    FROM public.pack_members
    WHERE pack_id = p_pack_id AND is_active = true;
  IF v_active_member_count <= 1 THEN RETURN; END IF;

  -- Find last computed winner date for this pack
  SELECT MAX(score_date) INTO v_last_computed
    FROM public.daily_winners WHERE pack_id = p_pack_id;

  -- Iterate over each active or completed run whose date range overlaps
  -- with (v_last_computed, v_yesterday]
  FOR v_run IN
    SELECT * FROM public.runs
    WHERE pack_id = p_pack_id
      AND status IN ('active', 'completed')
      AND start_date <= v_yesterday
    ORDER BY start_date
  LOOP
    -- For each day in this run's range, up to yesterday, not yet computed
    v_current_date := GREATEST(v_run.start_date, COALESCE(v_last_computed + 1, v_run.start_date));
    WHILE v_current_date <= LEAST(v_run.end_date, v_yesterday) LOOP

      -- ── Steps category ──────────────────────────────────────────────
      IF v_pack.steps_enabled THEN
        SELECT MAX(steps_count) INTO v_winning_value
          FROM public.daily_scores
          WHERE run_id = v_run.id
            AND score_date = v_current_date
            AND steps_count > 0;
        IF v_winning_value IS NOT NULL AND v_winning_value > 0 THEN
          SELECT ARRAY_AGG(user_id) INTO v_winner_ids
            FROM public.daily_scores
            WHERE run_id = v_run.id
              AND score_date = v_current_date
              AND steps_count = v_winning_value;
          INSERT INTO public.daily_winners
            (pack_id, run_id, score_date, category, winner_user_ids, winning_metric_value)
            VALUES (p_pack_id, v_run.id, v_current_date, 'steps', v_winner_ids, v_winning_value)
            ON CONFLICT (pack_id, score_date, category) DO NOTHING;
        END IF;
      END IF;

      -- ── Workouts category ───────────────────────────────────────────
      IF v_pack.workouts_enabled THEN
        SELECT MAX(workout_count) INTO v_winning_value
          FROM public.daily_scores
          WHERE run_id = v_run.id
            AND score_date = v_current_date
            AND workout_count > 0;
        IF v_winning_value IS NOT NULL AND v_winning_value > 0 THEN
          SELECT ARRAY_AGG(user_id) INTO v_winner_ids
            FROM public.daily_scores
            WHERE run_id = v_run.id
              AND score_date = v_current_date
              AND workout_count = v_winning_value;
          INSERT INTO public.daily_winners
            (pack_id, run_id, score_date, category, winner_user_ids, winning_metric_value)
            VALUES (p_pack_id, v_run.id, v_current_date, 'workouts', v_winner_ids, v_winning_value)
            ON CONFLICT (pack_id, score_date, category) DO NOTHING;
        END IF;
      END IF;

      -- ── Calories category ───────────────────────────────────────────
      IF v_pack.calories_enabled THEN
        SELECT MAX(calories_count) INTO v_winning_value
          FROM public.daily_scores
          WHERE run_id = v_run.id
            AND score_date = v_current_date
            AND calories_count > 0;
        IF v_winning_value IS NOT NULL AND v_winning_value > 0 THEN
          SELECT ARRAY_AGG(user_id) INTO v_winner_ids
            FROM public.daily_scores
            WHERE run_id = v_run.id
              AND score_date = v_current_date
              AND calories_count = v_winning_value;
          INSERT INTO public.daily_winners
            (pack_id, run_id, score_date, category, winner_user_ids, winning_metric_value)
            VALUES (p_pack_id, v_run.id, v_current_date, 'calories', v_winner_ids, v_winning_value)
            ON CONFLICT (pack_id, score_date, category) DO NOTHING;
        END IF;
      END IF;

      -- ── Water category ──────────────────────────────────────────────
      IF v_pack.water_enabled THEN
        SELECT MAX(water_oz_count) INTO v_winning_value
          FROM public.daily_scores
          WHERE run_id = v_run.id
            AND score_date = v_current_date
            AND water_oz_count > 0;
        IF v_winning_value IS NOT NULL AND v_winning_value > 0 THEN
          SELECT ARRAY_AGG(user_id) INTO v_winner_ids
            FROM public.daily_scores
            WHERE run_id = v_run.id
              AND score_date = v_current_date
              AND water_oz_count = v_winning_value;
          INSERT INTO public.daily_winners
            (pack_id, run_id, score_date, category, winner_user_ids, winning_metric_value)
            VALUES (p_pack_id, v_run.id, v_current_date, 'water', v_winner_ids, v_winning_value)
            ON CONFLICT (pack_id, score_date, category) DO NOTHING;
        END IF;
      END IF;

      v_current_date := v_current_date + 1;
    END LOOP;
  END LOOP;
END;
$function$;

COMMIT;
