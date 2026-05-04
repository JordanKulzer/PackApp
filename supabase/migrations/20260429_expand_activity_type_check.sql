-- Phase C polish — expand activity_type CHECK to allow took_lead and all_goals
--
-- Background: Phase C.4 added a SystemMessageRow component that renders
-- activity events of type took_lead and all_goals as centered system
-- messages. The emit code in LogSheet.tsx (took_lead) and healthkit.ts
-- (all_goals) tries to insert these rows, but the existing CHECK
-- constraint silently rejects them, so the SystemMessageRow has been
-- rendering nothing.
--
-- Prereq: app code emit paths for took_lead and all_goals must already
-- be idempotent upserts (LogSheet.tsx and healthkit.ts updated as part
-- of this same polish pass). Without that, lifting the CHECK constraint
-- would unblock duplicate-row floodgates of the same kind we fixed in
-- Phase C.5.
--
-- After this migration: existing emit paths succeed, SystemMessageRow
-- renders correctly, and the partial unique index extends to cover
-- the new types.

-- ── 1. Expand the CHECK constraint ──────────────────────────────────────────

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
    'all_goals'::text
  ]));

-- ── 2. Extend the partial unique index from 20260428b ───────────────────────
-- Once-per-(user, pack, day) uniqueness for took_lead and all_goals,
-- matching the rule applied to steps/calories/water in C.5.
-- took_lead in particular CAN fire conceptually multiple times per day
-- (user takes lead, loses lead, takes lead again) but emits should still
-- coalesce to one feed row per day per user — re-takes shouldn't spam
-- chat. Per-day uniqueness handles this naturally.

DROP INDEX IF EXISTS public.idx_activity_feed_no_dup_goals;

CREATE UNIQUE INDEX idx_activity_feed_no_dup_goals
  ON public.activity_feed (user_id, pack_id, activity_type, score_date)
  WHERE activity_type IN ('steps', 'calories', 'water', 'took_lead', 'all_goals');
