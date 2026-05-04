-- Pass 10a — Account deletion infrastructure.
--
-- Adds:
--   1. account_deletion_log — audit table for compliance. Survives the
--      user being deleted (no FK to users; user_id is intentionally orphaned).
--   2. delete_user_cascade(target_user_id, reason) — RPC that wraps the
--      entire deletion in a transaction. Called by the delete-user Edge
--      Function with service-role privileges.
--
-- Auth.users deletion happens from the Edge Function via
-- supabaseAdmin.auth.admin.deleteUser AFTER this RPC commits — RPCs cannot
-- delete from auth schema directly.
--
-- Deletion order (inside the transaction):
--   1. Insert audit log row
--   2. For each pack the user owns: auto-transfer to oldest non-deleting
--      member, OR delete the pack if user is sole member
--   3. Explicit deletes from every table with user_id (belt-and-suspenders,
--      idempotent — covers tables whose ON DELETE CASCADE behavior isn't
--      version-controlled in this repo)
--   4. Delete the public.users row
--
-- Storage objects (avatars, activity_photos) are deleted from the Edge
-- Function AFTER this RPC commits — different system, partial failure
-- there is recoverable manually.

-- ── 1. Audit log table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.account_deletion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deletion_reason text
);

-- Index on user_id for support lookups ("did we delete user X?").
CREATE INDEX IF NOT EXISTS idx_account_deletion_log_user_id
  ON public.account_deletion_log (user_id);

-- RLS: service-role only. Default-deny — no client policies. The Edge
-- Function uses the service role key which bypasses RLS.
ALTER TABLE public.account_deletion_log ENABLE ROW LEVEL SECURITY;

-- ── 2. delete_user_cascade RPC ─────────────────────────────────────────────

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
      PERFORM transfer_pack_ownership(pack_record.id, next_owner_id);
    ELSE
      PERFORM delete_pack_cascade(pack_record.id);
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

-- The function executes with the privileges of its owner (typically postgres
-- in Supabase), so the Edge Function's service-role JWT is sufficient to
-- invoke it. No GRANT to authenticated needed — invocation is service-role
-- only via supabaseAdmin.rpc().
REVOKE EXECUTE ON FUNCTION public.delete_user_cascade(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_user_cascade(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_user_cascade(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_user_cascade(uuid, text) TO service_role;
