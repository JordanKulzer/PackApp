BEGIN;

-- =========================================================================
-- Pass 20a — Pack Edit feature: schema migration.
-- Adds pending shadow columns on packs for queued goal-target changes that
-- apply at the next run rollover (D5). Extends activity_feed activity_type
-- enum + dedup index to support the upcoming 'goals_updated' system message
-- (Pass 20d).
--
-- Workout target editing deferred (D2) — no pending_workout_target column.
-- No CHECK constraints on pending_* — mirrors live columns which also have
-- no CHECKs (per pre-flight pg_constraint audit). Application-level
-- validation in Pass 20c's RPC enforces bounds.
-- =========================================================================

-- Step 1: Add pending columns to packs.
-- Nullable: NULL = no pending change. pending_changes_at is the single
-- timestamp covering the entire pending state as a unit (D3 — overwrite on
-- re-edit; the latest save's timestamp covers all pending values).
ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS pending_step_target integer,
  ADD COLUMN IF NOT EXISTS pending_calorie_target integer,
  ADD COLUMN IF NOT EXISTS pending_water_target_oz integer,
  ADD COLUMN IF NOT EXISTS pending_changes_at timestamptz;

-- Step 2: Extend activity_feed activity_type CHECK constraint.
-- Follows the precedent set by 20260429_expand_activity_type_check.sql.
-- Adds 'goals_updated' to the allowed enum.
ALTER TABLE public.activity_feed
  DROP CONSTRAINT IF EXISTS activity_feed_activity_type_check;

ALTER TABLE public.activity_feed
  ADD CONSTRAINT activity_feed_activity_type_check
  CHECK (activity_type = ANY (ARRAY[
    'steps'::text,
    'workout'::text,
    'calories'::text,
    'water'::text,
    'daily_winner'::text,
    'took_lead'::text,
    'all_goals'::text,
    'goals_updated'::text
  ]));

-- Step 3: Extend dedup partial unique index.
-- Same per-day-uniqueness rule as took_lead/all_goals: an owner editing
-- goals twice in one day produces one feed row, not two. Insert path uses
-- upsert + ignoreDuplicates (per the LogSheet.tsx took_lead pattern).
DROP INDEX IF EXISTS public.idx_activity_feed_no_dup_goals;

CREATE UNIQUE INDEX idx_activity_feed_no_dup_goals
  ON public.activity_feed (user_id, pack_id, activity_type, score_date)
  WHERE activity_type IN (
    'steps', 'calories', 'water',
    'took_lead', 'all_goals',
    'goals_updated'
  );

COMMIT;
