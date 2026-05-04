import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  isHealthKitAvailable,
  requestHealthKitPermissions,
  getHealthKitAuthStatus,
  syncHealthDataToSupabase,
  syncHealthDataForUser,
  logWaterToHealthKit,
} from "../lib/healthkit";
import { syncWaterToDailyScores } from "../lib/syncWater";
import type { Pack } from "../types/database";

const nativeAvailable = isHealthKitAvailable;

export function useHealthKit(userId: string | null) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoSyncFired = useRef(false);

  // ── Check authorization on mount ────────────────────────────────────────
  // Asks iOS for the actual authorization-request status (every cold launch).
  // Stateless — replaces the older `users.healthkit_authorized` shadow flag,
  // which could go stale and produce a false "Connected" state when iOS had
  // never actually been prompted.

  useEffect(() => {
    if (!userId || !nativeAvailable()) return;
    getHealthKitAuthStatus().then(setIsAuthorized);
  }, [userId]);

  // ── Auto-sync all packs once when authorized ────────────────────────────

  // Foreground entry point — delegates to the shared orchestrator in
  // healthkit.ts so the same throttled sync path serves both this hook and
  // the background-observer subscription in app/_layout.tsx.
  const syncAllPacks = useCallback(async (uid: string) => {
    if (!nativeAvailable()) return;
    setIsSyncing(true);
    setError(null);
    try {
      await syncHealthDataForUser(uid);
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
      try {
        await syncWaterToDailyScores(userId);
      } catch (err) {
        console.error("[useHealthKit] syncWaterToDailyScores error:", err);
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
