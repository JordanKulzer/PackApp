-- ─────────────────────────────────────────────────────────────────────────────
-- rollover_expired_runs: honor competition_window (weekly vs monthly).
--
-- BEFORE this migration: rollover_expired_runs unconditionally computed a
-- Mon→Sun week for every pack, ignoring pack.competition_window. A pack
-- created as monthly (via create_pack_with_run, which DOES use calendar-
-- month math: date_trunc('month', today) → last day of month) would
-- correctly start on the 1st, but on rollover the NEXT run was inserted
-- as a Mon-Sun week — silently converting the pack from monthly to weekly
-- after the first run.
--
-- AFTER this migration: the rollover branches on competition_window and
-- mirrors create_pack_with_run's math, so create and rollover agree on
-- calendar-month boundaries with no drift:
--
--   monthly: v_window_start := date_trunc('month', v_today)::date
--            v_window_end   := (date_trunc('month', v_today) + interval '1 month - 1 day')::date
--   weekly:  v_window_start := v_today - ((EXTRACT(ISODOW FROM v_today)::INT - 1))
--            v_window_end   := v_window_start + 6
--
-- Late rollover safety: date_trunc('month', v_today) yields the current
-- calendar month at the moment the function executes. A monthly run that
-- expired on the 31st and isn't rolled over until the 3rd of the next
-- month will produce a new run for the 1st-of-current-month → last-of-
-- current-month — the correct current monthly window. No drift, no
-- off-by-month bugs.
--
-- Weekly behavior: unchanged. The ELSE branch carries the exact same
-- ISODOW Mon-Sun math the function had before. A weekly pack rolling
-- over behaves byte-identically.
--
-- Idempotency: re-running the function when no run has expired hits the
-- existing CONTINUE path (line 115 of the prior body, unchanged here).
-- A monthly pack whose new monthly run already exists (e.g. another
-- caller raced and inserted it) takes the reactivated_existing branch
-- via the start_date/end_date match — the branch now uses the same
-- branched window boundaries, so a monthly pack matches its monthly
-- row (it would NOT match if the existing-run match still used a Mon-
-- Sun week).
--
-- Variable rename: v_week_start/v_week_end → v_window_start/v_window_end
-- throughout, since the boundaries are no longer necessarily weekly.
-- The rename is the only naming change; the math, the existing-run
-- match SELECT, and the INSERT VALUES are otherwise identical.
--
-- EVERYTHING ELSE PRESERVED BYTE-FOR-BYTE from the prior body defined in
-- 20260520_categories_pivot_stage3a.sql:34-170:
--   • auth.uid() / caller_user_id check
--   • per-pack FOR loop (now also selecting p.competition_window)
--   • active-run lookup + end_date < v_today expiry guard + CONTINUE
--   • UPDATE runs SET status = 'completed' close
--   • PERFORM compute_daily_winners_for_pack(...)
--   • run_category_winners aggregation CTE + INSERT ON CONFLICT DO NOTHING
--   • Pass 20b pending-pack-edit UPDATE block (step/calorie/water targets)
--   • existing-run-match → reactivated_existing branch
--   • INSERT new run → created_new/rolled_over branch + RETURN NEXT
--
-- CROSS-CHECK BEFORE APPLY: if Studio has been used to patch the live
-- function since 20260520 was applied, the live body may diverge from
-- the version this migration replaces. Verify with:
--   SELECT pg_get_functiondef('public.rollover_expired_runs'::regproc);
-- and diff against the prior body before applying this migration.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.rollover_expired_runs(caller_user_id uuid)
 RETURNS TABLE(out_pack_id uuid, out_old_run_id uuid, out_new_run_id uuid, out_action text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pack_record RECORD;
  v_active_run RECORD;
  v_pack_tz TEXT;
  v_today DATE;
  v_window_start DATE;
  v_window_end DATE;
  v_existing_run_id UUID;
  v_new_run_id UUID;
  v_closed_run_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != caller_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller_user_id must match authenticated user';
  END IF;

  FOR v_pack_record IN
    SELECT p.id AS pack_id, p.timezone, p.competition_window
    FROM packs p
    JOIN pack_members pm ON pm.pack_id = p.id
    WHERE pm.user_id = caller_user_id
      AND pm.is_active = true
  LOOP
    v_pack_tz := COALESCE(v_pack_record.timezone, 'UTC');
    v_today := (now() AT TIME ZONE v_pack_tz)::date;

    -- ── Window math — honors competition_window ────────────────────────
    -- Mirrors create_pack_with_run (20260524_pack_rpcs_drop_goal_targets
    -- .sql:101-107) exactly: monthly = first-of-month → last-of-month;
    -- weekly = ISO Mon → Sun. Create and rollover now agree.
    IF v_pack_record.competition_window = 'monthly' THEN
      v_window_start := date_trunc('month', v_today)::date;
      v_window_end := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
    ELSE
      v_window_start := v_today - ((EXTRACT(ISODOW FROM v_today)::INT - 1));
      v_window_end := v_window_start + 6;
    END IF;
    -- ───────────────────────────────────────────────────────────────────

    SELECT r.id, r.end_date INTO v_active_run
    FROM runs r
    WHERE r.pack_id = v_pack_record.pack_id
      AND r.status = 'active'
    ORDER BY r.created_at DESC
    LIMIT 1;

    v_closed_run_id := NULL;

    IF v_active_run.id IS NOT NULL THEN
      IF v_active_run.end_date < v_today THEN
        UPDATE runs SET status = 'completed' WHERE id = v_active_run.id;
        v_closed_run_id := v_active_run.id;

        -- ── Categories Pivot Stage 3a: aggregate run_category_winners ──
        -- The closing run becomes a settled record. Compute the latest
        -- daily_winners first (to capture the final day, which might not
        -- have been computed yet), then aggregate per-category wins counts.
        PERFORM public.compute_daily_winners_for_pack(v_pack_record.pack_id);

        WITH user_category_counts AS (
          SELECT
            UNNEST(winner_user_ids) AS user_id,
            category,
            COUNT(*) AS days_won
          FROM public.daily_winners
          WHERE run_id = v_closed_run_id
            AND category != 'legacy'
          GROUP BY UNNEST(winner_user_ids), category
        ),
        category_max AS (
          SELECT category, MAX(days_won) AS max_days
          FROM user_category_counts
          GROUP BY category
        )
        INSERT INTO public.run_category_winners
          (run_id, category, winner_user_ids, total_days_won)
        SELECT
          v_closed_run_id,
          ucc.category,
          ARRAY_AGG(ucc.user_id ORDER BY ucc.user_id),
          cm.max_days
        FROM user_category_counts ucc
        JOIN category_max cm ON cm.category = ucc.category
          AND ucc.days_won = cm.max_days
        GROUP BY ucc.category, cm.max_days
        ON CONFLICT (run_id, category) DO NOTHING;
      ELSE
        CONTINUE;
      END IF;
    END IF;

    -- ── Pass 20b: apply pending pack-edit changes ──────────────────────────
    -- Reaching this point means rollover is happening for this pack —
    -- either a new run will be inserted (created_new / rolled_over) or an
    -- existing current-week row will be reactivated (reactivated_existing).
    -- All three are run-becoming-active moments, so apply pending in all
    -- three. The WHERE clause filters out packs with no pending state, so
    -- zero-pending packs see no row mutation (no realtime/audit noise).
    UPDATE packs
    SET
      step_target             = COALESCE(pending_step_target, step_target),
      calorie_target          = COALESCE(pending_calorie_target, calorie_target),
      water_target_oz         = COALESCE(pending_water_target_oz, water_target_oz),
      pending_step_target     = NULL,
      pending_calorie_target  = NULL,
      pending_water_target_oz = NULL,
      pending_changes_at      = NULL
    WHERE id = v_pack_record.pack_id
      AND (pending_step_target IS NOT NULL
        OR pending_calorie_target IS NOT NULL
        OR pending_water_target_oz IS NOT NULL);

    SELECT r.id INTO v_existing_run_id
    FROM runs r
    WHERE r.pack_id = v_pack_record.pack_id
      AND r.start_date = v_window_start
      AND r.end_date = v_window_end;

    IF v_existing_run_id IS NOT NULL THEN
      UPDATE runs SET status = 'active'
      WHERE id = v_existing_run_id AND status != 'active';

      out_pack_id := v_pack_record.pack_id;
      out_old_run_id := v_closed_run_id;
      out_new_run_id := v_existing_run_id;
      out_action := 'reactivated_existing';
      RETURN NEXT;
    ELSE
      INSERT INTO runs (pack_id, start_date, end_date, status)
      VALUES (v_pack_record.pack_id, v_window_start, v_window_end, 'active')
      RETURNING id INTO v_new_run_id;

      out_pack_id := v_pack_record.pack_id;
      out_old_run_id := v_closed_run_id;
      out_new_run_id := v_new_run_id;
      out_action := CASE WHEN v_closed_run_id IS NULL THEN 'created_new' ELSE 'rolled_over' END;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$function$;

COMMIT;
