import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import type { Pack, PackMember, Run, User } from "../types/database";

export interface PackMemberWithUser extends PackMember {
  user: User;
}

export interface PackWithDetails {
  pack: Pack;
  members: PackMemberWithUser[];
  activeRun: Run | null;
  memberCount: number;
}

export function usePack(packId: string | null) {
  const [data, setData] = useState<PackWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPack = useCallback(async () => {
    if (!packId) return;
    setIsLoading(true);
    setError(null);

    const [packResult, membersResult, runResult] = await Promise.all([
      supabase.from("packs").select("*").eq("id", packId).single(),
      supabase
        .from("pack_members")
        .select("*, users(*)")
        .eq("pack_id", packId)
        .eq("is_active", true),
      supabase
        .from("runs")
        .select("*")
        .eq("pack_id", packId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (packResult.error) {
      setError(packResult.error.message);
      setIsLoading(false);
      return;
    }

    setData({
      pack: packResult.data,
      members: (membersResult.data ?? []) as PackMemberWithUser[],
      activeRun: runResult.data ?? null,
      memberCount: membersResult.data?.length ?? 0,
    });
    setIsLoading(false);
  }, [packId]);

  useEffect(() => {
    fetchPack();
  }, [fetchPack]);

  return { data, isLoading, error, refetch: fetchPack };
}

export function useUserPacks(userId: string | null) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPacks = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("pack_members")
      .select("pack_id, packs(*)")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (fetchError) {
      setError(fetchError.message);
    } else {
      const packList = (data ?? [])
        .map((row) => row.packs as Pack | null)
        .filter((p): p is Pack => p !== null && p.is_active);
      setPacks(packList);
    }
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchPacks();
  }, [fetchPacks]);

  return { packs, isLoading, error, refetch: fetchPacks };
}
