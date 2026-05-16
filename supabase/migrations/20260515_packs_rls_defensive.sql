-- supabase/migrations/20260515_packs_rls_defensive.sql
-- 
-- Defensive RLS on packs table.
-- Today, all auth gating is in RPCs (update_pack_settings,
-- transfer_pack_ownership, delete_pack_cascade — all SECURITY DEFINER).
-- This adds row-level enforcement so future direct .update()/.delete()
-- calls from client code are blocked unless the user is the pack creator.
-- SECURITY DEFINER RPCs bypass these policies and continue to work
-- exactly as before.

ALTER TABLE public.packs ENABLE ROW LEVEL SECURITY;

-- Pack members can SELECT packs they're a member of
DROP POLICY IF EXISTS "Pack members can read packs" ON public.packs;
CREATE POLICY "Pack members can read packs"
  ON public.packs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pack_members
      WHERE pack_members.pack_id = packs.id
        AND pack_members.user_id = auth.uid()
        AND pack_members.is_active = true
    )
  );

-- Only creators can UPDATE packs via direct client calls
-- (SECURITY DEFINER RPCs bypass this and continue to enforce their own auth)
DROP POLICY IF EXISTS "Creators can update packs" ON public.packs;
CREATE POLICY "Creators can update packs"
  ON public.packs
  FOR UPDATE
  USING (auth.uid() = created_by);

-- Only creators can DELETE packs via direct client calls
DROP POLICY IF EXISTS "Creators can delete packs" ON public.packs;
CREATE POLICY "Creators can delete packs"
  ON public.packs
  FOR DELETE
  USING (auth.uid() = created_by);

-- INSERT is gated by create_pack_with_initial_run RPC (SECURITY DEFINER)
-- which sets created_by = auth.uid(). No client INSERT policy needed.