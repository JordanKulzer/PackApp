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
import { useScoreStore } from "../stores/scoreStore";

export interface LogEntry {
  amount_oz: number;
  logged_at: string;
}

export interface WorkoutLogEntry {
  logged_at: string;
  entry_method: string | null;
}

// An individual manual steps/calories log — one activity_feed row per
// "Add" tap. value = the per-action amount; created_at = its timestamp.
export interface ManualLogEntry {
  value: number;
  created_at: string;
}

// Prompt 1 (streak read-site migration): streak_days dropped from this
// snapshot. The LogSheet streak headline reads users.current_streak via
// the currentStreak field on LogActivitySheetData, not from this per-pack
// daily_scores row. streak_multiplier stays (out of scope).
// Goal-removal Part 3b: *_achieved fields dropped — sync paths no longer
// write them and LogSheet never read them off this snapshot.
export interface DailyScoreSnapshot {
  total_points: number;
  water_oz_count: number;
  steps_count: number;
  calories_count: number;
  workout_count: number;
  streak_multiplier: number;
  // F.2: M badge derives from manual_*_count > 0 (replaced the prior
  // has_manual_* booleans dropped in migration 20260513b).
  manual_steps_count: number;
  manual_calories_count: number;
}

export interface LogActivitySheetData {
  entries: LogEntry[];
  workoutLogs: WorkoutLogEntry[];
  // Today's individual manual steps/calories entries, single-pack-scoped
  // (activity_feed is pack-scoped — see the fetch in load()).
  stepsEntries: ManualLogEntry[];
  caloriesEntries: ManualLogEntry[];
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
  // Stage 3: streak surfaces. manuallyLoggedToday / checkedInToday drive
  // the check-in box's satisfied state; currentStreak is the per-user
  // GLOBAL streak (users.current_streak — Stage 2 cache). All three are
  // user-global, populated even when there's no active packRun.
  //
  // manuallyLoggedToday is CROSS-PACK (no pack_id filter) so it matches
  // computeUserStreak's semantics exactly — the box must agree with the
  // streak compute on whether "today is satisfied via a manual log."
  manuallyLoggedToday: boolean;
  checkedInToday: boolean;
  currentStreak: number;
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

  // Issue-1 fix: subscribe to scoreStore.logVersion so every successful
  // log inside the open sheet re-runs this effect. Without this, the
  // streak module + manual/check-in flags showed stale values until the
  // sheet was closed and reopened — the effect deps were [visible, userId]
  // only, so bumpLogVersion() didn't reach this hook (the bump signals
  // the Compete tab + per-pack fetchWeekly, neither of which is this).
  const logVersion = useScoreStore((s) => s.logVersion);
  // Track the previous logVersion across effect runs. When the current
  // logVersion differs from the ref, the run is the result of a log →
  // we MUST go to network even if the 30s module cache is still warm.
  // This makes bumpLogVersion the authoritative cache-bust signal;
  // invalidateLogActivitySheetCache stays as an explicit bust but is
  // no longer the only thing keeping the sheet fresh after a log.
  const prevLogVersionRef = useRef(logVersion);

  useEffect(() => {
    if (!visible || !userId) return; // don't wipe data on close — stale-while-revalidate

    const logVersionChanged = prevLogVersionRef.current !== logVersion;
    prevLogVersionRef.current = logVersion;

    const now = Date.now();
    // Cache-hit branch is skipped when logVersion has bumped — a fresh
    // log just landed and the module cache may be stale (the caller
    // invalidates before bumping today, but we don't rely on that
    // pairing anymore; logVersion alone is enough).
    if (
      !logVersionChanged &&
      _cache &&
      _cache.userId === userId &&
      now - _cache.ts < CACHE_TTL_MS
    ) {
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
      // run only when iOS reports the prompt has been answered. The three
      // streak-surface queries (Stage 3) ride this round too — they're
      // user-global (no pack/run dependency) and the EXISTS-style queries
      // are cheap (head: true returns count only, no row data).
      const [
        logsResult,
        memberResult,
        hkValues,
        manualFeedExistsResult,
        checkinExistsResult,
        userStreakResult,
      ] = await Promise.all([
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
        // Stage 3: did the user manually log anything today? Cross-pack
        // (no pack_id filter) so the result matches Stage 2's
        // computeUserStreak exactly. score_date is in pack-tz; the flagged
        // far-shifted-pack midnight-boundary edge case applies here too,
        // and the check-in box is the user's safety net for it.
        supabase
          .from("activity_feed")
          .select("score_date", { count: "exact", head: true })
          .eq("user_id", userId!)
          .eq("entry_method", "manual")
          .eq("score_date", deviceToday),
        // Stage 3: did the user already check in today?
        supabase
          .from("daily_checkins")
          .select("score_date", { count: "exact", head: true })
          .eq("user_id", userId!)
          .eq("score_date", deviceToday),
        // Stage 3: the user's GLOBAL streak count (Stage 2 cache on users).
        supabase
          .from("users")
          .select("current_streak")
          .eq("id", userId!)
          .maybeSingle(),
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

      // Stage 3: derive the three streak-surface fields. User-global, so
      // included in every return path below (early returns + happy path).
      const manuallyLoggedToday = (manualFeedExistsResult.count ?? 0) > 0;
      const checkedInToday = (checkinExistsResult.count ?? 0) > 0;
      const currentStreak =
        (userStreakResult.data as { current_streak?: number } | null)
          ?.current_streak ?? 0;

      const packId = member?.pack_id ?? null;
      const packTimezone: string = member?.packs?.timezone ?? "UTC";
      // Compute "today" in the pack's timezone for score_date queries
      const today = packToday(packTimezone);

      if (!packId) {
        return {
          entries, workoutLogs: [], totalOz,
          stepsEntries: [], caloriesEntries: [],
          hkAuthorized, stepsToday, caloriesToday,
          packRun: null, localScore: null, localWeeklyPoints: 0,
          manuallyLoggedToday, checkedInToday, currentStreak,
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
          stepsEntries: [], caloriesEntries: [],
          hkAuthorized, stepsToday, caloriesToday,
          packRun: null, localScore: null, localWeeklyPoints: 0,
          manuallyLoggedToday, checkedInToday, currentStreak,
        };
      }

      const todayStart = packTodayStartUTC(packTimezone);

      // Round 3: daily score rows + workout feed + manual steps/calories feed
      const [scoreResult, weeklyResult, workoutFeedResult, manualFeedResult] = await Promise.all([
        supabase
          .from("daily_scores")
          .select(
            "total_points, water_oz_count, steps_count, calories_count, workout_count, streak_multiplier, manual_steps_count, manual_calories_count",
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
        // Change 1: today's individual manual steps/calories entries.
        // Single-pack-scoped via .eq("pack_id", packId) — the same
        // first-pack pick the workout fetch above uses — so a user in N
        // packs sees each Add once, not N times.
        supabase
          .from("activity_feed")
          .select("value, created_at, activity_type")
          .eq("pack_id", packId)
          .eq("user_id", userId!)
          .eq("entry_method", "manual")
          .in("activity_type", ["steps", "calories"])
          .eq("score_date", today)
          .order("created_at", { ascending: false }),
      ]);

      const localScore = (scoreResult.data as DailyScoreSnapshot | null) ?? null;
      const localWeeklyPoints = (weeklyResult.data ?? []).reduce(
        (sum: number, r: { total_points: number }) => sum + r.total_points,
        0,
      );
      const workoutLogs: WorkoutLogEntry[] = (workoutFeedResult.data ?? []).map(
        (r) => ({ logged_at: r.created_at, entry_method: r.entry_method }),
      );

      // Split the manual feed rows into per-category lists.
      const manualRows = (manualFeedResult.data ?? []) as Array<{
        value: number;
        created_at: string;
        activity_type: string;
      }>;
      const stepsEntries: ManualLogEntry[] = manualRows
        .filter((r) => r.activity_type === "steps")
        .map((r) => ({ value: r.value, created_at: r.created_at }));
      const caloriesEntries: ManualLogEntry[] = manualRows
        .filter((r) => r.activity_type === "calories")
        .map((r) => ({ value: r.value, created_at: r.created_at }));

      return {
        entries, workoutLogs, totalOz,
        stepsEntries, caloriesEntries,
        hkAuthorized, stepsToday, caloriesToday,
        packRun: { runId: run.id, packId, packTimezone },
        localScore,
        localWeeklyPoints,
        manuallyLoggedToday, checkedInToday, currentStreak,
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
  }, [visible, userId, logVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, isLoading, error };
}
