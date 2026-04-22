import { useState, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { supabase } from "../lib/supabase";
import {
  getTodaySteps,
  getTodayActiveCalories,
  isHealthKitAvailable,
} from "../lib/healthkit";

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
  has_manual_steps: boolean;
  has_manual_calories: boolean;
}

export interface LogActivitySheetData {
  entries: LogEntry[];
  workoutLogs: WorkoutLogEntry[];
  totalOz: number;
  waterTarget: number;
  stepTarget: number;
  calorieTarget: number;
  hkAuthorized: boolean;
  stepsToday: number | null;
  caloriesToday: number | null;
  packRun: { runId: string; packId: string } | null;
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
      const n = new Date();
      const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
      const hkAvailable = Platform.OS === "ios" && isHealthKitAvailable();

      // Round 1: all independent sources in parallel, including HealthKit reads
      const [logsResult, memberResult, userResult, hkValues] = await Promise.all([
        supabase
          .from("water_logs")
          .select("amount_oz, logged_at")
          .eq("user_id", userId!)
          .eq("log_date", today)
          .order("logged_at", { ascending: false }),
        supabase
          .from("pack_members")
          .select(
            "pack_id, packs(water_target_oz, water_enabled, step_target, steps_enabled, calorie_target, calories_enabled)",
          )
          .eq("user_id", userId!)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("users")
          .select("healthkit_authorized")
          .eq("id", userId!)
          .maybeSingle(),
        hkAvailable
          ? (Promise.all([getTodaySteps(), getTodayActiveCalories()]) as Promise<[number, number]>)
          : (Promise.resolve([0, 0]) as Promise<[number, number]>),
      ]);

      const entries = (logsResult.data ?? []) as LogEntry[];
      const totalOz = entries.reduce((sum, e) => sum + e.amount_oz, 0);

      const member = memberResult.data as unknown as {
        pack_id: string;
        packs: {
          water_target_oz: number;
          water_enabled: boolean;
          step_target: number;
          steps_enabled: boolean;
          calorie_target: number;
          calories_enabled: boolean;
        } | null;
      } | null;

      const p = member?.packs;
      const waterTarget =
        p?.water_enabled && (p.water_target_oz ?? 0) > 0 ? p.water_target_oz : 64;
      const stepTarget = (p?.step_target ?? 0) > 0 ? p!.step_target : 10000;
      const calorieTarget = (p?.calorie_target ?? 0) > 0 ? p!.calorie_target : 500;

      const hkAuthorized = userResult.data?.healthkit_authorized ?? false;
      const [stepsRaw, calsRaw] = hkValues;
      const stepsToday = hkAvailable && hkAuthorized ? stepsRaw : null;
      const caloriesToday = hkAvailable && hkAuthorized ? calsRaw : null;

      const packId = member?.pack_id ?? null;
      if (!packId) {
        return {
          entries, workoutLogs: [], totalOz, waterTarget, stepTarget, calorieTarget,
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
          entries, workoutLogs: [], totalOz, waterTarget, stepTarget, calorieTarget,
          hkAuthorized, stepsToday, caloriesToday,
          packRun: null, localScore: null, localWeeklyPoints: 0,
        };
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Round 3: daily score rows + today's workout feed entries in parallel
      const [scoreResult, weeklyResult, workoutFeedResult] = await Promise.all([
        supabase
          .from("daily_scores")
          .select(
            "total_points, steps_achieved, workout_achieved, calories_achieved, water_achieved, water_oz_count, steps_count, calories_count, workout_count, streak_days, streak_multiplier, has_manual_steps, has_manual_calories",
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
        entries, workoutLogs, totalOz, waterTarget, stepTarget, calorieTarget,
        hkAuthorized, stepsToday, caloriesToday,
        packRun: { runId: run.id, packId },
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
