-- supabase/migrations/20260514_restore_hk_idempotence.sql

-- Restores idempotence for HK-sourced activity_feed inserts.
--
-- Background: migration 20260513b narrowed idx_activity_feed_no_dup_goals
-- to once-per-day events only (took_lead, all_goals) to enable additive
-- manual logs. Unintentionally, this also dropped uniqueness enforcement
-- for HK-sourced steps/calories/water rows, which need to remain idempotent
-- (one row per user per pack per type per day). HK sync was producing
-- duplicate rows on every cold launch / HK observer wake / pack screen mount.
--
-- This migration adds a parallel partial index scoped to entry_method='healthkit'
-- only, preserving the manual-additive intent while restoring HK idempotence.
-- The existing 23505 catch in syncHealthDataToSupabase keeps working.

-- Cleanup existing duplicates (keep oldest row per partition).
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, pack_id, activity_type, score_date
      ORDER BY created_at ASC
    ) AS rn
  FROM public.activity_feed
  WHERE entry_method = 'healthkit'
    AND activity_type IN ('steps', 'calories', 'water')
)
DELETE FROM public.activity_feed
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Restore idempotence for HK-sourced rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_feed_no_dup_hk_goals
  ON public.activity_feed (user_id, pack_id, activity_type, score_date)
  WHERE entry_method = 'healthkit'
    AND activity_type IN ('steps','calories','water');