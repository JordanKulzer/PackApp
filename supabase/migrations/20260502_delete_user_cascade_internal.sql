-- Pass 10a-fix — Path D: internal/external split for cascade RPCs.
--
-- Background: delete_user_cascade (Pass 10a) calls delete_pack_cascade and
-- transfer_pack_ownership via PERFORM. Both inner functions guard on
-- auth.uid() = packs.created_by — correct for user-initiated calls, but
-- fails when invoked from delete_user_cascade because the latter runs as
-- SECURITY DEFINER from a service_role connection (no JWT → auth.uid() = NULL).
--
-- Fix shape: keep the public-facing delete_pack_cascade and
-- transfer_pack_ownership UNTOUCHED (they continue to enforce the auth check
-- for user-initiated flows). Add private *_internal variants that omit ONLY
-- the auth.uid() guard, preserving every other validation. Restrict EXECUTE
-- on the internal variants to service_role so a malicious client cannot
-- bypass auth by calling them directly.
--
-- delete_user_cascade is rewritten in this migration to redirect its two
-- PERFORM calls to the internal variants. Body otherwise identical.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. _delete_pack_cascade_internal
--
-- Same body as public.delete_pack_cascade with ONLY the auth-guard stripped.
-- The 5 DELETE statements stay in identical order — child tables before
-- parents — for FK integrity:
--   activity_feed → daily_scores → runs → pack_members → packs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._delete_pack_cascade_internal(
  pack_id_to_delete uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM activity_feed   WHERE pack_id = pack_id_to_delete;
  DELETE FROM daily_scores    WHERE run_id IN (SELECT id FROM runs WHERE pack_id = pack_id_to_delete);
  DELETE FROM runs            WHERE pack_id = pack_id_to_delete;
  DELETE FROM pack_members    WHERE pack_id = pack_id_to_delete;
  DELETE FROM packs           WHERE id = pack_id_to_delete;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._delete_pack_cascade_internal(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._delete_pack_cascade_internal(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._delete_pack_cascade_internal(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._delete_pack_cascade_internal(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. _transfer_pack_ownership_internal
--
-- Same body as public.transfer_pack_ownership with ONLY the
-- `current_creator_id != auth.uid()` guard stripped. All other validation
-- preserved: pack-must-be-active, cannot-transfer-to-self,
-- must-be-active-member. Same atomic role-swap + packs.created_by update.
--
-- The "wasted" UPDATE on the deleting user's pack_members row (which
-- delete_user_cascade will DELETE shortly after this returns) is harmless
-- and keeps the internal variant minimally diverged from the public one,
-- which makes the security audit trail cleaner.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._transfer_pack_ownership_internal(
  pack_id_to_transfer uuid,
  new_owner_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_creator_id uuid;
BEGIN
  -- Validate: pack must exist and be active
  SELECT created_by INTO current_creator_id
  FROM packs
  WHERE id = pack_id_to_transfer
    AND is_active = true;

  IF current_creator_id IS NULL THEN
    RAISE EXCEPTION 'Pack not found or inactive';
  END IF;

  -- Validate: cannot transfer to yourself
  IF new_owner_user_id = current_creator_id THEN
    RAISE EXCEPTION 'Cannot transfer ownership to yourself';
  END IF;

  -- Validate: new owner must be an active member
  IF NOT EXISTS (
    SELECT 1 FROM pack_members
    WHERE pack_id = pack_id_to_transfer
      AND user_id = new_owner_user_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Target user is not an active member of this pack';
  END IF;

  -- Atomic role swap + packs.created_by update
  UPDATE pack_members
  SET role = 'member'
  WHERE pack_id = pack_id_to_transfer
    AND user_id = current_creator_id;

  UPDATE pack_members
  SET role = 'admin'
  WHERE pack_id = pack_id_to_transfer
    AND user_id = new_owner_user_id;

  UPDATE packs
  SET created_by = new_owner_user_id
  WHERE id = pack_id_to_transfer;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._transfer_pack_ownership_internal(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._transfer_pack_ownership_internal(uuid, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._transfer_pack_ownership_internal(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._transfer_pack_ownership_internal(uuid, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. delete_user_cascade — redirect PERFORM calls to *_internal variants
--
-- Body otherwise identical to the Pass 10a definition in
-- 20260501_delete_user.sql. Only the two PERFORM lines change.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_user_cascade(
  target_user_id uuid,
  reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  pack_record RECORD;
  next_owner_id uuid;
BEGIN
  -- Step 1: Audit log. Inserted first so partial failure leaves a record
  -- that deletion was attempted — support can manually verify completion.
  INSERT INTO account_deletion_log (user_id, deletion_reason)
  VALUES (target_user_id, reason);

  -- Step 2: Owned-pack handling.
  -- For each pack created by this user, find the oldest active member
  -- (excluding the deleting user). If found, transfer ownership.
  -- If not found (sole-member pack), delete the pack entirely.
  --
  -- Calls the *_internal variants — these have no auth.uid() guard, so
  -- they work from this SECURITY DEFINER + service_role context where
  -- auth.uid() is NULL. Public delete_pack_cascade and
  -- transfer_pack_ownership remain unchanged for user-initiated flows.
  FOR pack_record IN
    SELECT id FROM packs WHERE created_by = target_user_id
  LOOP
    SELECT user_id INTO next_owner_id
    FROM pack_members
    WHERE pack_id = pack_record.id
      AND user_id != target_user_id
      AND is_active = true
    ORDER BY joined_at ASC, user_id ASC
    LIMIT 1;

    IF next_owner_id IS NOT NULL THEN
      PERFORM _transfer_pack_ownership_internal(pack_record.id, next_owner_id);
    ELSE
      PERFORM _delete_pack_cascade_internal(pack_record.id);
    END IF;
  END LOOP;

  -- Step 3: Explicit deletes (belt-and-suspenders).
  -- Idempotent — no-ops if ON DELETE CASCADE already covers the row.
  -- Order: dependent tables first, then less-dependent.
  DELETE FROM chat_message_reactions WHERE user_id = target_user_id;
  DELETE FROM chat_messages WHERE user_id = target_user_id;
  DELETE FROM activity_reactions WHERE user_id = target_user_id;
  DELETE FROM feed_comments WHERE user_id = target_user_id;
  DELETE FROM activity_feed WHERE user_id = target_user_id;
  DELETE FROM daily_scores WHERE user_id = target_user_id;
  DELETE FROM activity_logs WHERE user_id = target_user_id;
  DELETE FROM water_logs WHERE user_id = target_user_id;
  DELETE FROM user_achievements WHERE user_id = target_user_id;
  DELETE FROM user_push_tokens WHERE user_id = target_user_id;
  DELETE FROM user_notification_prefs WHERE user_id = target_user_id;
  DELETE FROM photo_reports WHERE reporter_id = target_user_id;
  DELETE FROM pack_members WHERE user_id = target_user_id;

  -- Step 4: Delete the public.users row.
  -- auth.users is deleted by the Edge Function caller via
  -- auth.admin.deleteUser AFTER this transaction commits.
  DELETE FROM users WHERE id = target_user_id;
END;
$$;

-- EXECUTE permissions on delete_user_cascade are unchanged from
-- 20260501_delete_user.sql (service_role only). CREATE OR REPLACE
-- preserves the existing GRANT/REVOKE state from that migration.
