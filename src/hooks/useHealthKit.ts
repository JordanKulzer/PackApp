import { useState, useEffect, useCallback, useRef } from "react";
import { Platform } from "react-native";
import AppleHealthKit from "react-native-health";
import { supabase } from "../lib/supabase";
import {
  requestHealthKitPermissions,
  syncHealthDataToSupabase,
  syncWorkoutsToSupabase,
  logWaterToHealthKit,
} from "../lib/healthkit";
import type { Pack } from "../types/database";

function nativeAvailable(): boolean {
  return (
    Platform.OS === "ios" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (AppleHealthKit as any)?.initHealthKit === "function"
  );
}

export function useHealthKit(userId: string | null) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoSyncFired = useRef(false);

  // ── Check authorization on mount ────────────────────────────────────────

  useEffect(() => {
    if (!userId || !nativeAvailable()) return;

    supabase
      .from("users")
      .select("healthkit_authorized")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        if (data?.healthkit_authorized) {
          setIsAuthorized(true);
        }
      });
  }, [userId]);

  // ── Auto-sync all packs once when authorized ────────────────────────────

  const syncAllPacks = useCallback(async (uid: string) => {
    if (!nativeAvailable()) return;
    setIsSyncing(true);
    setError(null);

    try {
      // Fetch all active pack memberships
      const { data: memberships } = await supabase
        .from("pack_members")
        .select("pack_id")
        .eq("user_id", uid)
        .eq("is_active", true);

      if (!memberships || memberships.length === 0) return;

      const packIds = memberships.map((m) => m.pack_id);

      // Fetch pack details
      const { data: packs } = await supabase
        .from("packs")
        .select("*")
        .in("id", packIds)
        .eq("is_active", true);

      if (!packs || packs.length === 0) return;

      // For each pack, get active run and sync
      await Promise.all([
        ...((packs as Pack[]).map(async (pack) => {
          const { data: run } = await supabase
            .from("runs")
            .select("id")
            .eq("pack_id", pack.id)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!run) return;

          await syncHealthDataToSupabase(uid, pack.id, run.id, pack);
        })),
        syncWorkoutsToSupabase(uid),
      ]);

      setLastSyncedAt(new Date());
    } catch (err) {
      console.error("[useHealthKit] syncAllPacks error:", err);
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!userId || !isAuthorized || autoSyncFired.current) return;
    autoSyncFired.current = true;
    syncAllPacks(userId);
  }, [userId, isAuthorized, syncAllPacks]);

  // ── requestPermissions ─────────────────────────────────────────────────

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (!nativeAvailable()) return false;
    setError(null);

    try {
      const granted = await requestHealthKitPermissions();
      if (!granted) return false;

      setIsAuthorized(true);

      // Persist authorized flag
      if (userId) {
        await supabase
          .from("users")
          .update({ healthkit_authorized: true })
          .eq("id", userId);

        // Sync all packs immediately after connecting
        await syncAllPacks(userId);
      }

      return true;
    } catch (err) {
      console.error("[useHealthKit] requestPermissions error:", err);
      setError(err instanceof Error ? err.message : "HealthKit unavailable");
      return false;
    }
  }, [userId, syncAllPacks]);

  // ── syncNow — for a specific pack (called from pack screen) ────────────

  const syncNow = useCallback(
    async (packId: string, runId: string, pack: Pack): Promise<void> => {
      if (!userId || !nativeAvailable() || !isAuthorized) return;
      setIsSyncing(true);
      setError(null);

      try {
        await syncHealthDataToSupabase(userId, packId, runId, pack);
        setLastSyncedAt(new Date());
      } catch (err) {
        console.error("[useHealthKit] syncNow error:", err);
        setError(err instanceof Error ? err.message : "Sync failed");
      } finally {
        setIsSyncing(false);
      }
    },
    [userId, isAuthorized],
  );

  // ── logWater — writes to HealthKit + water_logs table ─────────────────

  const logWater = useCallback(
    async (amountOz: number): Promise<void> => {
      if (nativeAvailable() && isAuthorized) {
        await logWaterToHealthKit(amountOz).catch((err) => {
          console.error("[useHealthKit] logWaterToHealthKit error:", err);
        });
      }
      if (!userId) return;
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const { error: insertError } = await supabase
        .from("water_logs")
        .insert({ user_id: userId, amount_oz: amountOz, log_date: today });
      if (insertError) {
        console.error("[useHealthKit] water_logs insert error:", insertError);
        throw insertError;
      }
    },
    [isAuthorized, userId],
  );

  return {
    isAuthorized,
    isSyncing,
    lastSyncedAt,
    error,
    requestPermissions,
    syncNow,
    logWater,
  };
}
