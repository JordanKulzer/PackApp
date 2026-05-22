import { useState, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { supabase } from "../lib/supabase";
import {
  getTodaySteps,
  getTodayActiveCalories,
  getHealthKitAuthStatus,
  isHealthKitAvailable,
} from "../lib/healthkit";
import { packToday, packTodayStartUTC, deviceLocalToday } from "../lib/packDates";

export interface LogEntry {
  amount_oz: number;
  logged_at: string;
}

export interface WorkoutLogEntry {
  logged_at: string;
  entry_method: string | null;
}

export interface DailyScoreSnapshot {
  total_points: number;
  steps_achieved: boolean;
  workout_achieved: boolean;
  calories_achieved: boolean;
  water_achieved: boolean;
  water_oz_count: number;
  steps_count: number;
  calories_count: number;
  workout_count: number;
  streak_days: number;
  streak_multiplier: number;
  // F.2: M badge derives from manual_*_count > 0 (replaced the prior
  // has_manual_* booleans dropped in migration 20260513b).
  manual_steps_count: number;
  manual_calories_count: number;
}

export interface LogActivitySheetData {
  entries: LogEntry[];
  workoutLogs: WorkoutLogEntry[];
  totalOz: number;
  hkAuthorized: boolean;
  stepsToday: number | null;
  caloriesToday: number | null;
  // Pass 25-followup-B: targets and per-pack enabled flags removed. LogSheet
  // is now a personal activity logger, not a goal tracker — display is
  // decoupled from any pack's targets. Per-pack scoring (logActivity.ts +
  // healthkit.ts iterating over all memberships) still evaluates achievement
  // against each pack's own targets server-side; LogSheet just doesn't
  // render a target denominator. packRun.packId is still the arbitrary
  // first-pack pick from `pack_members.limit(1)` — kept because manual log
  // optimistic patching attaches to a single run and feed entries land in
  // one pack. The arbitrary-pack-bias on optimistic UI is a separate
  // architectural issue (backlog).
  packRun: { runId: string; packId: string; packTimezone: string } | null;
  localScore: DailyScoreSnapshot | null;
  localWeeklyPoints: number;
}

type CacheEntry = { userId: string; data: LogActivitySheetData; ts: number };
let _cache: CacheEntry | null = null;
const CACHE_TTL_MS = 30_000;

export function invalidateLogActivitySheetCache(): void {
  _cache = null;
}

export function useLogActivitySheetData(
  userId: string | undefined,
  visible: boolean,
): { data: LogActivitySheetData | null; isLoading: boolean; error: string | null } {
  const [data, setData] = useState<LogActivitySheetData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    if (!visible || !userId) return; // don't wipe data on close — stale-while-revalidate

    const now = Date.now();
    if (_cache && _cache.userId === userId && now - _cache.ts < CACHE_TTL_MS) {
      // Cache hit: serve immediately without touching loading state
      setData(_cache.data);
      setIsLoading(false);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    // Only show skeleton on genuine first load (data is null); stale data stays visible
    if (!_cache || _cache.userId !== userId) {
      setData(null);
      setIsLoading(true);
    }
    setError(null);

    async function load(): Promise<LogActivitySheetData> {
      const hkAvailable = Platform.OS === "ios" && isHealthKitAvailable();
      // Device-local today for water_logs display (water is logged with device-local date)
      const deviceToday = deviceLocalToday();

      // Part C: real iOS authorization-request status is the source of
      // truth — the users.healthkit_authorized DB column went stale across
      // rebuilds. Gating the HealthKit reads on this mirrors
      // syncHealthDataForUser's Gate 0: never query HealthKit blind, which
      // spams "Code=5" when the prompt has not been answered.
      const hkAuthorized = hkAvailable ? await getHealthKitAuthStatus() : false;

      // Round 1: all independent sources in parallel. The HealthKit reads
      // run only when iOS reports the prompt has been answered.
      const [logsResult, memberResult, hkValues] = await Promise.all([
        supabase
          .from("water_logs")
          .select("amount_oz, logged_at")
          .eq("user_id", userId!)
          .eq("log_date", deviceToday)
          .order("logged_at", { ascending: false }),
        supabase
          .from("pack_members")
          .select("pack_id, packs(timezone)")
          .eq("user_id", userId!)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle(),
        hkAvailable && hkAuthorized
          ? (Promise.all([getTodaySteps(), getTodayActiveCalories()]) as Promise<[number, number]>)
          : (Promise.resolve([0, 0]) as Promise<[number, number]>),
      ]);

      const entries = (logsResult.data ?? []) as LogEntry[];
      const totalOz = entries.reduce((sum, e) => sum + e.amount_oz, 0);

      const member = memberResult.data as unknown as {
        pack_id: string;
        packs: { timezone: string } | null;
      } | null;

      const [stepsRaw, calsRaw] = hkValues;
      const stepsToday = hkAvailable && hkAuthorized ? stepsRaw : null;
      const caloriesToday = hkAvailable && hkAuthorized ? calsRaw : null;

      const packId = member?.pack_id ?? null;
      const packTimezone: string = member?.packs?.timezone ?? "UTC";
      // Compute "today" in the pack's timezone for score_date queries
      const today = packToday(packTimezone);

      if (!packId) {
        return {
          entries, workoutLogs: [], totalOz,
          hkAuthorized, stepsToday, caloriesToday,
          packRun: null, localScore: null, localWeeklyPoints: 0,
        };
      }

      // Round 2: active run (depends on packId from round 1)
      const { data: run } = await supabase
        .from("runs")
        .select("id")
        .eq("pack_id", packId)
        .eq("status", "active")
        .maybeSingle();

      if (!run) {
        return {
          entries, workoutLogs: [], totalOz,
          hkAuthorized, stepsToday, caloriesToday,
          packRun: null, localScore: null, localWeeklyPoints: 0,
        };
      }

      const todayStart = packTodayStartUTC(packTimezone);

      // Round 3: daily score rows + today's workout feed entries in parallel
      const [scoreResult, weeklyResult, workoutFeedResult] = await Promise.all([
        supabase
          .from("daily_scores")
          .select(
            "total_points, steps_achieved, workout_achieved, calories_achieved, water_achieved, water_oz_count, steps_count, calories_count, workout_count, streak_days, streak_multiplier, manual_steps_count, manual_calories_count",
          )
          .eq("run_id", run.id)
          .eq("user_id", userId!)
          .eq("score_date", today)
          .maybeSingle(),
        supabase
          .from("daily_scores")
          .select("total_points")
          .eq("run_id", run.id)
          .eq("user_id", userId!),
        supabase
          .from("activity_feed")
          .select("created_at, entry_method")
          .eq("pack_id", packId)
          .eq("user_id", userId!)
          .eq("activity_type", "workout")
          .gte("created_at", todayStart.toISOString())
          .order("created_at", { ascending: true }),
      ]);

      const localScore = (scoreResult.data as DailyScoreSnapshot | null) ?? null;
      const localWeeklyPoints = (weeklyResult.data ?? []).reduce(
        (sum: number, r: { total_points: number }) => sum + r.total_points,
        0,
      );
      const workoutLogs: WorkoutLogEntry[] = (workoutFeedResult.data ?? []).map(
        (r) => ({ logged_at: r.created_at, entry_method: r.entry_method }),
      );

      return {
        entries, workoutLogs, totalOz,
        hkAuthorized, stepsToday, caloriesToday,
        packRun: { runId: run.id, packId, packTimezone },
        localScore,
        localWeeklyPoints,
      };
    }

    load()
      .then((result) => {
        if (fetchIdRef.current !== fetchId) return;
        _cache = { userId: userId!, data: result, ts: Date.now() };
        setData(result);
        setIsLoading(false);
      })
      .catch((err) => {
        if (fetchIdRef.current !== fetchId) return;
        console.error("[useLogActivitySheetData]", err);
        setError("Failed to load activity data");
        setIsLoading(false);
      });
  }, [visible, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, isLoading, error };
}
