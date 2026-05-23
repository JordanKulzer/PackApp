-- ============================================================
-- Migration: user-global streak data layer (Stage 1)
-- ============================================================
-- Builds the data layer for the new PER-USER-GLOBAL streak. Replaces
-- the prior per-pack-run streak_days model (still on daily_scores —
-- left in place for the historical recap / past-runs surfaces).
--
-- The new streak advances on a day where the user EITHER:
--   1. manually logged any activity (already recorded as
--      activity_feed rows with entry_method='manual'), or
--   2. tapped a "Did you perform an activity today?" check-in box.
--
-- This migration ships ONLY the schema: the table for #2 and a small
-- denormalized cache on users for fast reads. The compute function
-- and app wiring land in later stages.
--
-- WHAT THIS MIGRATION DOES:
--   1. Creates public.daily_checkins — one row per user per day they
--      tap the check-in box. PRIMARY KEY (user_id, score_date) makes
--      a re-tap on the same day idempotent.
--   2. Adds three cache columns to public.users so every consumer
--      that displays the streak (Compete row, Home, Profile,
--      get_user_public_profile RPC) can read it in one column lookup
--      instead of recomputing the chain on every render.
--   3. Enables RLS on daily_checkins with own-rows-only policies
--      (private — can loosen to packmate-visible later if a "pack
--      streak board" surface is built).
--
-- EXPLICITLY NOT DONE (deferred to later stages):
--   - No streak compute function / RPC / trigger.
--   - No backfill — freeze-and-restart. New table ships empty;
--     current_streak / best_streak default 0; last_streak_date NULL.
--   - No writes to daily_scores.streak_days from any new path; old
--     per-run values stay intact for the recap surfaces that read
--     them.
--   - No users.timezone column — "today" is derived from device-tz
--     in app code (deviceLocalToday) in the later compute stage.
--   - No `source` column on daily_checkins (audit-recommended but
--     explicitly deferred — keep the table lean for Stage 1).
--   - No packmate-visibility SELECT policy — private for now; can
--     add a packmate join policy later if needed.
--
-- RE-RUNNABILITY:
--   Every DDL is guarded (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
--   DROP POLICY IF EXISTS before each CREATE POLICY). Safe to apply
--   twice.
-- ============================================================

BEGIN;

-- ── 1. daily_checkins table ────────────────────────────────────────
-- One row per user per day the box is tapped. PK on (user_id,
-- score_date) handles re-tap idempotence — repeated taps on the same
-- day collide on the PK and are no-ops via INSERT ... ON CONFLICT in
-- the app layer (or harmlessly UPDATE checked_in_at via the UPDATE
-- policy below).
--
-- score_date is a plain date (no time component). The app derives it
-- from the device's local timezone at write time (deviceLocalToday)
-- — no users.timezone column needed for Stage 1.
--
-- ON DELETE CASCADE on user_id: when a user is deleted, their
-- check-ins go with them. Matches the user_achievements precedent.
--
-- No additional index — the PK is a composite btree on
-- (user_id, score_date) which serves both the per-day-EXISTS check
-- and the streak walk's ordered scan (user_id = ?, score_date >= ?).
CREATE TABLE IF NOT EXISTS public.daily_checkins (
  user_id       uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  score_date    date        NOT NULL,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, score_date)
);

-- ── 2. Cache columns on users ──────────────────────────────────────
-- Denormalized fast-read fields refreshed by the streak compute
-- function (later stage). Every existing streak read site (Compete
-- row, Home, Profile, get_user_public_profile RPC) can switch to
-- reading these columns instead of recomputing the chain.
--
-- Defaults: 0 / NULL — pre-existing users start with no streak
-- history (matches freeze-and-restart). Existing
-- daily_scores.streak_days values remain on their original rows for
-- the recap / past-runs surfaces; the new columns are independent.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS current_streak   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_streak      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_streak_date date;

-- ── 3. Row Level Security on daily_checkins ────────────────────────
-- Private — own rows only. A user can read, insert, and update their
-- own check-ins. No DELETE policy (no app surface deletes check-ins).
-- No packmate-visibility SELECT policy (kept private for Stage 1;
-- loosen later if a "pack streak board" needs cross-user reads).
--
-- UPDATE policy exists for re-tap idempotence — an UPSERT on the PK
-- conflict path may UPDATE the existing row (touching checked_in_at)
-- rather than failing. WITH CHECK mirrors USING so a user cannot
-- repoint a row's user_id to someone else via UPDATE.
ALTER TABLE public.daily_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own check-ins"
  ON public.daily_checkins;
CREATE POLICY "Users can read their own check-ins"
  ON public.daily_checkins
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own check-ins"
  ON public.daily_checkins;
CREATE POLICY "Users can insert their own check-ins"
  ON public.daily_checkins
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own check-ins"
  ON public.daily_checkins;
CREATE POLICY "Users can update their own check-ins"
  ON public.daily_checkins
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;
