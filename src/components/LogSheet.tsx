import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Vibration,
  StyleSheet,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useAuthStore } from "../stores/authStore";
import { useScoreStore } from "../stores/scoreStore";
import { supabase } from "../lib/supabase";
import { POINTS, getStreakMultiplier } from "../lib/scoring";
import { computeStreakForRun } from "../lib/computeStreak";
import { syncManualActivityToDailyScores } from "../lib/logActivity";
import { notifyPackMembers } from "../lib/notifications";
import {
  getTodaySteps,
  getTodayActiveCalories,
  requestHealthKitPermissions,
  isHealthKitAvailable,
} from "../lib/healthkit";
import {
  useLogActivitySheetData,
  invalidateLogActivitySheetCache,
} from "../hooks/useLogActivitySheetData";
import type { LogEntry } from "../hooks/useLogActivitySheetData";
import { colors } from "../theme/colors";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: colors.self,
  success: "#3FB950",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LogSheetProps {
  visible: boolean;
  onClose: () => void;
}

const QUICK_AMOUNTS = [8, 16, 32] as const;

// ─────────────────────────────────────────────────────────────────────────────
// HKReadOnlyRow — steps / calories synced from HealthKit
// ─────────────────────────────────────────────────────────────────────────────

function HKReadOnlyRow({
  value,
  target,
  unit,
  available,
  authorized,
  hasManualEntry,
  onConnect,
}: {
  value: number | null;
  target: number;
  unit: string;
  available: boolean;
  authorized: boolean;
  hasManualEntry?: boolean;
  onConnect: () => void;
}) {
  if (!available) {
    return (
      <View style={hk.wrapper}>
        <Text style={hk.dash}>—</Text>
        <Text style={hk.caption}>Health data unavailable</Text>
      </View>
    );
  }

  if (!authorized) {
    return (
      <View style={hk.wrapper}>
        <TouchableOpacity style={hk.connectBtn} onPress={onConnect} activeOpacity={0.8}>
          <Text style={hk.connectText}>Connect Apple Health</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const displayValue = value ?? null;
  const achieved = displayValue !== null && target > 0 && displayValue >= target;
  const pct = displayValue !== null && target > 0 ? Math.min(1, displayValue / target) : 0;
  const barColor = achieved ? C.success : C.accent;
  const widthPct = `${Math.round(pct * 100)}%` as `${number}%`;

  return (
    <View style={hk.wrapper}>
      <View style={hk.valueRow}>
        <Text style={hk.valueText}>
          {displayValue !== null ? displayValue.toLocaleString() : "—"}
          {target > 0 ? ` / ${target.toLocaleString()} ${unit}` : ` ${unit}`}
        </Text>
        {hasManualEntry && <ManualBadge />}
        {achieved && <Text style={hk.check}>✓</Text>}
      </View>
      <View style={hk.barTrack}>
        <View style={[hk.barFill, { width: widthPct, backgroundColor: barColor }]} />
      </View>
      <Text style={hk.caption}>♥ Synced from Apple Health</Text>
    </View>
  );
}

const hk = StyleSheet.create({
  wrapper: { paddingHorizontal: 20, paddingBottom: 16, gap: 6 },
  valueRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  valueText: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  check: { fontSize: 14, color: C.success, fontWeight: "700" },
  barTrack: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: { height: 4, borderRadius: 2 },
  caption: { fontSize: 12, color: C.textTertiary },
  dash: { fontSize: 20, fontWeight: "600", color: C.textTertiary },
  connectBtn: {
    backgroundColor: C.surfaceRaised,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: C.border,
    alignSelf: "flex-start",
  },
  connectText: { fontSize: 14, fontWeight: "600", color: C.accent },
});

// ─────────────────────────────────────────────────────────────────────────────
// ManualBadge — informational pill shown on manually-entered activities
// ─────────────────────────────────────────────────────────────────────────────

function ManualBadge() {
  return (
    <View style={mb.pill}>
      <Text style={mb.text}>M</Text>
    </View>
  );
}

const mb = StyleSheet.create({
  pill: {
    backgroundColor: C.surfaceRaised,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 0.5,
    borderColor: C.border,
    alignSelf: "center",
  },
  text: { fontSize: 10, fontWeight: "700", color: C.textSecondary, letterSpacing: 0.3 },
});

// ─────────────────────────────────────────────────────────────────────────────
// ManualEntryRow — inline expandable number input below HK rows
// ─────────────────────────────────────────────────────────────────────────────

function ManualEntryRow({
  unit,
  isSaving,
  onSave,
}: {
  unit: string;
  isSaving: boolean;
  onSave: (value: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [raw, setRaw] = useState("");

  const handleSave = () => {
    const n = parseInt(raw.replace(/,/g, ""), 10);
    if (!isNaN(n) && n > 0) {
      onSave(n);
      setRaw("");
      setExpanded(false);
    }
  };

  if (!expanded) {
    return (
      <TouchableOpacity
        style={me.link}
        onPress={() => setExpanded(true)}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
      >
        <Text style={me.linkText}>Add manually</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={me.row}>
      <TextInput
        style={me.input}
        value={raw}
        onChangeText={setRaw}
        placeholder={`0 ${unit}`}
        placeholderTextColor={C.textTertiary}
        keyboardType="number-pad"
        autoFocus
        maxLength={8}
      />
      <TouchableOpacity
        style={[me.saveBtn, isSaving && me.saveBtnDisabled]}
        onPress={handleSave}
        disabled={isSaving || raw.length === 0}
        activeOpacity={0.8}
      >
        <Text style={me.saveText}>{isSaving ? "…" : "Save"}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={me.cancelBtn}
        onPress={() => { setExpanded(false); setRaw(""); }}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={me.cancelText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const me = StyleSheet.create({
  link: { paddingHorizontal: 20, paddingBottom: 14 },
  linkText: { fontSize: 13, color: C.accent, fontWeight: "500" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: C.surfaceRaised,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: C.textPrimary,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  saveBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { fontSize: 14, fontWeight: "700", color: "#FFF" },
  cancelBtn: { padding: 4 },
  cancelText: { fontSize: 16, color: C.textTertiary },
});

// ─────────────────────────────────────────────────────────────────────────────
// Water progress ring (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

function WaterRing({
  totalOz,
  targetOz,
}: {
  totalOz: number;
  targetOz: number;
}) {
  const size = 120;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = targetOz > 0 ? Math.min(1, totalOz / targetOz) : 0;
  const offset = circumference - pct * circumference;
  const ringColor = pct >= 1 ? C.success : C.accent;

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg
        width={size}
        height={size}
        style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={C.border}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {pct > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={ringColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        )}
      </Svg>
      <View style={{ alignItems: "center" }}>
        <Text style={s.ringValue}>{Math.round(totalOz)}</Text>
        <Text style={s.ringTarget}>
          {totalOz >= targetOz ? `goal ${targetOz} oz ✓` : `/ ${targetOz} oz`}
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync water total to daily_scores for all active packs (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

async function syncWaterToDailyScores(userId: string): Promise<void> {
  try {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const { data: memberships, error: memberError } = await supabase
      .from("pack_members")
      .select("pack_id")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (memberError || !memberships || memberships.length === 0) return;

    for (const membership of memberships) {
      const { data: pack } = await supabase
        .from("packs")
        .select("id, water_enabled, water_target_oz")
        .eq("id", membership.pack_id)
        .single();

      if (!pack || !pack.water_enabled) continue;

      const { data: run } = await supabase
        .from("runs")
        .select("id")
        .eq("pack_id", pack.id)
        .eq("status", "active")
        .single();

      if (!run) continue;

      const { data: todayLogs } = await supabase
        .from("water_logs")
        .select("amount_oz")
        .eq("user_id", userId)
        .eq("log_date", today);

      const trueTotalOz = (todayLogs ?? []).reduce(
        (sum, row) => sum + row.amount_oz,
        0,
      );

      const water_achieved = trueTotalOz >= pack.water_target_oz;

      const { data: existing } = await supabase
        .from("daily_scores")
        .select(
          "total_points, water_achieved, steps_achieved, workout_achieved, calories_achieved",
        )
        .eq("run_id", run.id)
        .eq("user_id", userId)
        .eq("score_date", today)
        .single();

      const anyAchieved =
        water_achieved ||
        (existing?.steps_achieved ?? false) ||
        (existing?.workout_achieved ?? false) ||
        (existing?.calories_achieved ?? false);
      const streakDays = await computeStreakForRun(userId, run.id, today, anyAchieved);
      const multiplier = getStreakMultiplier(streakDays);

      const basePointsWithoutWater =
        (existing?.steps_achieved ? POINTS.steps : 0) +
        (existing?.workout_achieved ? POINTS.workout : 0) +
        (existing?.calories_achieved ? POINTS.calories : 0);
      const waterPoints = water_achieved ? POINTS.water : 0;
      const newTotalPoints = Math.round(
        (basePointsWithoutWater + waterPoints) * multiplier,
      );

      const { error: upsertError } = await supabase.from("daily_scores").upsert(
        {
          run_id: run.id,
          user_id: userId,
          score_date: today,
          water_achieved,
          water_oz_count: Math.round(trueTotalOz),
          total_points: newTotalPoints,
          streak_days: streakDays,
          streak_multiplier: multiplier,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "run_id,user_id,score_date" },
      );

      if (upsertError) {
        console.error("[LogSheet] daily_scores upsert error:", upsertError);
      }

      if (water_achieved) {
        const wPoints = Math.round(POINTS.water * multiplier);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: existingFeed, error: feedCheckError } = await supabase
          .from("activity_feed")
          .select("id")
          .eq("pack_id", pack.id)
          .eq("user_id", userId)
          .eq("activity_type", "water")
          .gte("created_at", todayStart.toISOString())
          .maybeSingle();

        if (feedCheckError) {
          console.error("[LogSheet] activity_feed check error:", feedCheckError);
        } else if (!existingFeed) {
          const { error: feedInsertError } = await supabase.from("activity_feed").insert({
            pack_id: pack.id,
            user_id: userId,
            activity_type: "water",
            value: Math.round(trueTotalOz),
            points_earned: wPoints,
          });
          if (!feedInsertError) {
            notifyPackMembers(userId, pack.id, {
              kind: "goal",
              activityType: "water",
              pointsEarned: wPoints,
            }).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.error("[LogSheet] syncWaterToDailyScores error:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SheetSkeleton — shown while all data sources are loading
// ─────────────────────────────────────────────────────────────────────────────

function SheetSkeleton() {
  return (
    <View style={sk.container}>
      <Text style={s2.sectionLabel}>STEPS</Text>
      <View style={sk.section}>
        <View style={sk.valueLine} />
        <View style={sk.barTrack} />
        <View style={sk.captionLine} />
      </View>
      <View style={sk.divider} />
      <Text style={[s2.sectionLabel, s2.sectionTop]}>WORKOUT</Text>
      <View style={sk.workoutPlaceholder} />
      <View style={sk.divider} />
      <Text style={[s2.sectionLabel, s2.sectionTop]}>ACTIVE CALORIES</Text>
      <View style={sk.section}>
        <View style={sk.valueLine} />
        <View style={sk.barTrack} />
        <View style={sk.captionLine} />
      </View>
      <View style={sk.divider} />
      <Text style={[s2.sectionLabel, s2.sectionTop]}>WATER</Text>
      <View style={sk.ringPlaceholder} />
      <View style={sk.buttonRowPlaceholder}>
        <View style={sk.buttonPlaceholder} />
        <View style={sk.buttonPlaceholder} />
        <View style={sk.buttonPlaceholder} />
      </View>
    </View>
  );
}

// Shared label styles used by SheetSkeleton (mirrors the main stylesheet, defined
// here so the skeleton component can reference them before the main StyleSheet).
const s2 = StyleSheet.create({
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textTertiary,
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  sectionTop: { marginTop: 16 },
});

const sk = StyleSheet.create({
  container: { paddingBottom: 40 },
  section: { paddingHorizontal: 20, paddingBottom: 16, gap: 6 },
  valueLine: {
    height: 16,
    width: "55%",
    backgroundColor: C.surfaceRaised,
    borderRadius: 4,
  },
  barTrack: {
    height: 4,
    backgroundColor: C.surfaceRaised,
    borderRadius: 2,
    opacity: 0.5,
  },
  captionLine: {
    height: 11,
    width: "40%",
    backgroundColor: C.surfaceRaised,
    borderRadius: 3,
    opacity: 0.4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginHorizontal: 20,
    marginBottom: 4,
  },
  workoutPlaceholder: {
    marginHorizontal: 20,
    marginBottom: 20,
    height: 50,
    backgroundColor: C.surfaceRaised,
    borderRadius: 12,
    opacity: 0.5,
  },
  ringPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: C.surfaceRaised,
    alignSelf: "center",
    marginBottom: 20,
    opacity: 0.4,
  },
  buttonRowPlaceholder: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 20,
  },
  buttonPlaceholder: {
    flex: 1,
    height: 44,
    backgroundColor: C.surfaceRaised,
    borderRadius: 100,
    opacity: 0.5,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LogSheet({ visible, onClose }: LogSheetProps) {
  const userId = useAuthStore((s) => s.user?.id);

  const [modalVisible, setModalVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(600)).current;
  const goalFadeAnim = useRef(new Animated.Value(0)).current;
  const prevGoalReached = useRef(false);

  const scaleAnims = useRef(
    QUICK_AMOUNTS.reduce<Record<number, Animated.Value>>((acc, amt) => {
      acc[amt] = new Animated.Value(1);
      return acc;
    }, {}),
  ).current;

  // ── Water state ───────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [totalOz, setTotalOz] = useState(0);
  const [waterTarget, setWaterTarget] = useState(64);
  const [saving, setSaving] = useState(false);

  // ── HealthKit state ────────────────────────────────────────────────────────
  const hkAvailable = Platform.OS === "ios" && isHealthKitAvailable();
  const [hkAuthorized, setHkAuthorized] = useState(false);
  const [stepsToday, setStepsToday] = useState<number | null>(null);
  const [caloriesToday, setCaloriesToday] = useState<number | null>(null);
  const [stepTarget, setStepTarget] = useState(10000);
  const [calorieTarget, setCalorieTarget] = useState(500);

  // ── Manual entry state ─────────────────────────────────────────────────────
  const [hasManualSteps, setHasManualSteps] = useState(false);
  const [hasManualCalories, setHasManualCalories] = useState(false);
  const [manualStepsSaving, setManualStepsSaving] = useState(false);
  const [manualCalSaving, setManualCalSaving] = useState(false);

  // ── Score store ───────────────────────────────────────────────────────────
  const patchMyScore = useScoreStore((s) => s.patchMyScore);
  const bumpLogVersion = useScoreStore((s) => s.bumpLogVersion);

  const [packRun, setPackRun] = useState<{ runId: string; packId: string } | null>(null);
  const [localWeeklyPoints, setLocalWeeklyPoints] = useState(0);
  const [localScore, setLocalScore] = useState<{
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
  } | null>(null);

  const [workoutSaving, setWorkoutSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; positive: boolean } | null>(null);
  const feedbackAnim = useRef(new Animated.Value(0)).current;
  const prevRankRef = useRef<number | null>(null);

  // ── Data hook ─────────────────────────────────────────────────────────────

  const { data: hookData } = useLogActivitySheetData(userId, visible);

  // ── Initialize local state from hook data ─────────────────────────────────
  // Fires when hookData reference changes — i.e., on fresh network fetches.
  // Cache hits return the same object reference, so this is NOT triggered on
  // reopen within the TTL window, which is what prevents the skeleton flash.

  useEffect(() => {
    if (!hookData) return;
    setEntries(hookData.entries);
    setTotalOz(hookData.totalOz);
    setWaterTarget(hookData.waterTarget);
    setStepTarget(hookData.stepTarget);
    setCalorieTarget(hookData.calorieTarget);
    setHkAuthorized(hookData.hkAuthorized);
    setStepsToday(hookData.stepsToday);
    setCaloriesToday(hookData.caloriesToday);
    setPackRun(hookData.packRun);
    setLocalWeeklyPoints(hookData.localWeeklyPoints);
    setLocalScore(hookData.localScore);
    setHasManualSteps(hookData.localScore?.has_manual_steps ?? false);
    setHasManualCalories(hookData.localScore?.has_manual_calories ?? false);
    if (hookData.packRun && hookData.localScore) {
      patchMyScore(hookData.packRun.packId, {
        ...hookData.localScore,
        weekly_points: hookData.localWeeklyPoints,
      });
    }
  }, [hookData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Slide animation ───────────────────────────────────────────────────────

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      slideAnim.setValue(600);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      // Only reset transient UI state on close. Data (entries, scores, etc.)
      // stays alive so reopen within the cache TTL shows content instantly.
      setFeedback(null);
      prevRankRef.current = null;
      feedbackAnim.setValue(0);
      Animated.timing(slideAnim, {
        toValue: 600,
        duration: 250,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setModalVisible(false);
      });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Goal reached fade ──────────────────────────────────────────────────────

  useEffect(() => {
    const goalReached = waterTarget > 0 && totalOz >= waterTarget;
    if (goalReached && !prevGoalReached.current) {
      goalFadeAnim.setValue(0);
      Animated.timing(goalFadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    } else if (!goalReached) {
      goalFadeAnim.setValue(0);
    }
    prevGoalReached.current = goalReached;
  }, [totalOz, waterTarget, goalFadeAnim]);

  // ── Connect Apple Health ───────────────────────────────────────────────────

  const handleConnectHealthKit = async () => {
    if (!userId) return;
    try {
      const granted = await requestHealthKitPermissions();
      if (!granted) return;
      await supabase
        .from("users")
        .update({ healthkit_authorized: true })
        .eq("id", userId);
      invalidateLogActivitySheetCache();
      setHkAuthorized(true);
      const [steps, cal] = await Promise.all([
        getTodaySteps(),
        getTodayActiveCalories(),
      ]);
      setStepsToday(steps);
      setCaloriesToday(cal);
    } catch (err) {
      console.error("[LogSheet] handleConnectHealthKit error:", err);
    }
  };

  // ── Competitive feedback ───────────────────────────────────────────────────

  const fetchFeedback = async (uid: string, runId: string) => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const { data: scores } = await supabase
      .from("daily_scores")
      .select("user_id, total_points")
      .eq("run_id", runId)
      .eq("score_date", today)
      .order("total_points", { ascending: false });

    if (!scores || scores.length === 0) return;

    const myIndex = scores.findIndex((s) => s.user_id === uid);
    if (myIndex === -1) return;

    const myPts = scores[myIndex].total_points;
    const myRank = myIndex + 1;
    const prevRank = prevRankRef.current;
    prevRankRef.current = myRank;

    let text: string;
    let positive: boolean;

    if (scores.length === 1) {
      text = myPts > 0 ? `+${myPts} pts today` : "Start your day";
      positive = true;
    } else if (myRank === 1) {
      const lead = myPts - scores[1].total_points;
      if (prevRank !== null && prevRank > 1) {
        text = "You took the lead";
        positive = true;
        if (packRun?.packId) {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const { data: existingLead } = await supabase
            .from("activity_feed")
            .select("id")
            .eq("pack_id", packRun.packId)
            .eq("user_id", uid)
            .eq("activity_type", "took_lead")
            .gte("created_at", todayStart.toISOString())
            .maybeSingle();
          if (!existingLead) {
            const { error: leadError } = await supabase.from("activity_feed").insert({
              pack_id: packRun.packId,
              user_id: uid,
              activity_type: "took_lead",
              value: 0,
              points_earned: 0,
            });
            if (!leadError) {
              notifyPackMembers(uid, packRun.packId, { kind: "took_lead" }).catch(() => {});
            }
          }
        }
      } else if (lead === 0) {
        text = "Tied for #1";
        positive = true;
      } else {
        text = `Leading by ${lead} pts`;
        positive = true;
      }
    } else {
      const aheadRow = scores[myIndex - 1];
      const gap = aheadRow.total_points - myPts;

      const { data: userData } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", aheadRow.user_id)
        .maybeSingle();

      const aheadName = userData?.display_name ?? `#${myRank - 1}`;

      if (gap === 0) {
        text = `Tied with ${aheadName}`;
        positive = true;
      } else {
        text = `${gap} pts behind ${aheadName}`;
        positive = false;
      }
    }

    setFeedback({ text, positive });
    feedbackAnim.setValue(0);
    Animated.timing(feedbackAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  };

  // ── Log workout ────────────────────────────────────────────────────────────

  const handleLogWorkout = async () => {
    if (!userId || workoutSaving) return;
    setWorkoutSaving(true);
    Vibration.vibrate(40);

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    if (packRun) {
      const base = localScore ?? {
        steps_achieved: false,
        workout_achieved: false,
        calories_achieved: false,
        water_achieved: false,
        streak_multiplier: 1,
      };
      const newTotalPoints = Math.round(
        ((base.steps_achieved ? POINTS.steps : 0) +
          POINTS.workout +
          (base.calories_achieved ? POINTS.calories : 0) +
          (base.water_achieved ? POINTS.water : 0)) *
          (base.streak_multiplier ?? 1),
      );
      const pointsDelta = newTotalPoints - (localScore?.total_points ?? 0);
      const newWeeklyPoints = localWeeklyPoints + pointsDelta;
      setLocalWeeklyPoints(newWeeklyPoints);

      const patch = {
        weekly_points: newWeeklyPoints,
        workout_achieved: true,
        workout_count: 1,
        total_points: newTotalPoints,
      };
      patchMyScore(packRun.packId, patch);
      setLocalScore((prev) => (prev ? { ...prev, ...patch } : null));
    }

    try {
      await syncManualActivityToDailyScores(userId, "workout", 1, today);
      invalidateLogActivitySheetCache();
      bumpLogVersion();
      if (packRun) {
        fetchFeedback(userId, packRun.runId).catch((e) =>
          console.warn("[LogSheet] fetchFeedback:", e),
        );
      }
    } catch (err) {
      console.error("[LogSheet] handleLogWorkout error:", err);
      if (packRun && localScore) {
        patchMyScore(packRun.packId, {
          weekly_points: localWeeklyPoints,
          workout_achieved: localScore.workout_achieved,
          workout_count: localScore.workout_count,
          total_points: localScore.total_points,
        });
      }
    } finally {
      setWorkoutSaving(false);
    }
  };

  // ── Manual steps / calories ───────────────────────────────────────────────

  const handleManualSteps = async (delta: number) => {
    if (!userId) return;
    setManualStepsSaving(true);
    Vibration.vibrate(40);

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const prevCount = localScore?.steps_count ?? 0;
    const newCount = prevCount + delta;
    const wasAchieved = localScore?.steps_achieved ?? false;
    const nowAchieved = newCount >= stepTarget;

    if (packRun) {
      const base = localScore ?? { steps_achieved: false, workout_achieved: false, calories_achieved: false, water_achieved: false, streak_multiplier: 1 };
      const newTotalPoints = Math.round(
        ((nowAchieved ? POINTS.steps : 0) +
          (base.workout_achieved ? POINTS.workout : 0) +
          (base.calories_achieved ? POINTS.calories : 0) +
          (base.water_achieved ? POINTS.water : 0)) * (base.streak_multiplier ?? 1),
      );
      const pointsDelta = newTotalPoints - (localScore?.total_points ?? 0);
      const newWeeklyPoints = localWeeklyPoints + pointsDelta;
      setLocalWeeklyPoints(newWeeklyPoints);
      const patch = { weekly_points: newWeeklyPoints, steps_count: newCount, steps_achieved: nowAchieved, total_points: newTotalPoints };
      patchMyScore(packRun.packId, patch);
      setLocalScore((prev) => prev ? { ...prev, ...patch } : null);
    }
    setHasManualSteps(true);

    try {
      await syncManualActivityToDailyScores(userId, "steps", delta, today);
      invalidateLogActivitySheetCache();
      bumpLogVersion();
      if (packRun && !wasAchieved && nowAchieved) {
        fetchFeedback(userId, packRun.runId).catch(() => {});
      }
    } catch (err) {
      console.error("[LogSheet] handleManualSteps error:", err);
    } finally {
      setManualStepsSaving(false);
    }
  };

  const handleManualCalories = async (delta: number) => {
    if (!userId) return;
    setManualCalSaving(true);
    Vibration.vibrate(40);

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const prevCount = localScore?.calories_count ?? 0;
    const newCount = prevCount + delta;
    const wasAchieved = localScore?.calories_achieved ?? false;
    const nowAchieved = newCount >= calorieTarget;

    if (packRun) {
      const base = localScore ?? { steps_achieved: false, workout_achieved: false, calories_achieved: false, water_achieved: false, streak_multiplier: 1 };
      const newTotalPoints = Math.round(
        ((base.steps_achieved ? POINTS.steps : 0) +
          (base.workout_achieved ? POINTS.workout : 0) +
          (nowAchieved ? POINTS.calories : 0) +
          (base.water_achieved ? POINTS.water : 0)) * (base.streak_multiplier ?? 1),
      );
      const pointsDelta = newTotalPoints - (localScore?.total_points ?? 0);
      const newWeeklyPoints = localWeeklyPoints + pointsDelta;
      setLocalWeeklyPoints(newWeeklyPoints);
      const patch = { weekly_points: newWeeklyPoints, calories_count: newCount, calories_achieved: nowAchieved, total_points: newTotalPoints };
      patchMyScore(packRun.packId, patch);
      setLocalScore((prev) => prev ? { ...prev, ...patch } : null);
    }
    setHasManualCalories(true);

    try {
      await syncManualActivityToDailyScores(userId, "calories", delta, today);
      invalidateLogActivitySheetCache();
      bumpLogVersion();
      if (packRun && !wasAchieved && nowAchieved) {
        fetchFeedback(userId, packRun.runId).catch(() => {});
      }
    } catch (err) {
      console.error("[LogSheet] handleManualCalories error:", err);
    } finally {
      setManualCalSaving(false);
    }
  };

  // ── Add water ──────────────────────────────────────────────────────────────

  const handleAddWater = async (amount: number) => {
    if (!userId || saving) return;
    setSaving(true);

    Vibration.vibrate(40);

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const newTotalOz = totalOz + amount;
    const newEntry: LogEntry = { amount_oz: amount, logged_at: now.toISOString() };

    const anim = scaleAnims[amount];
    if (anim) {
      Animated.sequence([
        Animated.spring(anim, {
          toValue: 0.94,
          useNativeDriver: true,
          speed: 50,
          bounciness: 0,
        }),
        Animated.spring(anim, {
          toValue: 1,
          useNativeDriver: true,
          speed: 20,
          bounciness: 4,
        }),
      ]).start();
    }

    setEntries((prev) => [newEntry, ...prev]);
    setTotalOz(newTotalOz);

    if (packRun) {
      const base = localScore ?? {
        steps_achieved: false,
        workout_achieved: false,
        calories_achieved: false,
        streak_multiplier: 1,
      };
      const water_achieved = newTotalOz >= waterTarget;
      const basePoints =
        (base.steps_achieved ? POINTS.steps : 0) +
        (base.workout_achieved ? POINTS.workout : 0) +
        (base.calories_achieved ? POINTS.calories : 0) +
        (water_achieved ? POINTS.water : 0);
      const newTotalPoints = Math.round(basePoints * (base.streak_multiplier ?? 1));

      const pointsDelta = newTotalPoints - (localScore?.total_points ?? 0);
      const newWeeklyPoints = localWeeklyPoints + pointsDelta;
      setLocalWeeklyPoints(newWeeklyPoints);

      const patch = {
        weekly_points: newWeeklyPoints,
        water_oz_count: Math.round(newTotalOz),
        water_achieved,
        total_points: newTotalPoints,
      };
      patchMyScore(packRun.packId, patch);
      setLocalScore((prev) => (prev ? { ...prev, ...patch } : null));
    }

    try {
      const { error: insertError } = await supabase.from("water_logs").insert({
        user_id: userId,
        amount_oz: amount,
        log_date: today,
        logged_at: now,
      });
      if (insertError) throw insertError;

      await syncWaterToDailyScores(userId);
      invalidateLogActivitySheetCache();
      bumpLogVersion();

      if (packRun) {
        fetchFeedback(userId, packRun.runId).catch((e) =>
          console.warn("[LogSheet] fetchFeedback:", e),
        );
      }
    } catch (err) {
      console.error("[LogSheet] handleAddWater error:", err);
      setEntries((prev) => prev.filter((e) => e !== newEntry));
      setTotalOz((prev) => prev - amount);
    } finally {
      setSaving(false);
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const goalReached = waterTarget > 0 && totalOz >= waterTarget;
  const displayedEntries = entries.slice(0, 5);
  const moreCount = entries.length - 5;

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={s.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFillObject} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}
        >
          {/* Handle */}
          <View style={s.handleWrap}>
            <View style={s.handle} />
          </View>

          {/* Header */}
          <Text style={s.header}>Log Activity</Text>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.scrollContent}
          >
            {!hookData ? (
              <SheetSkeleton />
            ) : (
            <>
            {/* ── STEPS ──────────────────────────────────────────────── */}
            <Text style={s.sectionLabel}>STEPS</Text>
            <HKReadOnlyRow
              value={stepsToday}
              target={stepTarget}
              unit="steps"
              available={hkAvailable}
              authorized={hkAuthorized}
              hasManualEntry={hasManualSteps}
              onConnect={handleConnectHealthKit}
            />
            <ManualEntryRow
              unit="steps"
              isSaving={manualStepsSaving}
              onSave={handleManualSteps}
            />

            <View style={s.divider} />

            {/* ── WORKOUT ────────────────────────────────────────────── */}
            <Text style={[s.sectionLabel, s.sectionTop]}>WORKOUT</Text>
            <View style={s.workoutRow}>
              {localScore?.workout_achieved ? (
                <View style={s.workoutDone}>
                  <Text style={s.workoutDoneText}>Workout logged ✓</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[s.workoutBtn, workoutSaving && s.addBtnDisabled]}
                  onPress={handleLogWorkout}
                  disabled={workoutSaving}
                  activeOpacity={0.8}
                >
                  <Text style={s.workoutBtnText}>
                    Log Workout  +{POINTS.workout} pts
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={s.divider} />

            {/* ── ACTIVE CALORIES ────────────────────────────────────── */}
            <Text style={[s.sectionLabel, s.sectionTop]}>ACTIVE CALORIES</Text>
            <HKReadOnlyRow
              value={caloriesToday}
              target={calorieTarget}
              unit="cal"
              available={hkAvailable}
              authorized={hkAuthorized}
              hasManualEntry={hasManualCalories}
              onConnect={handleConnectHealthKit}
            />
            <ManualEntryRow
              unit="cal"
              isSaving={manualCalSaving}
              onSave={handleManualCalories}
            />

            <View style={s.divider} />

            {/* ── WATER ──────────────────────────────────────────────── */}
            <Text style={[s.sectionLabel, s.sectionTop]}>WATER</Text>

            <View style={s.ringWrap}>
              <WaterRing totalOz={totalOz} targetOz={waterTarget} />
            </View>

            <View style={s.buttonRow}>
              {QUICK_AMOUNTS.map((amount) => (
                <Animated.View
                  key={amount}
                  style={{ transform: [{ scale: scaleAnims[amount] }] }}
                >
                  <TouchableOpacity
                    style={[s.addBtn, saving && s.addBtnDisabled]}
                    onPress={() => handleAddWater(amount)}
                    disabled={saving}
                    activeOpacity={1}
                  >
                    <Text style={s.addBtnText}>+{amount} oz</Text>
                  </TouchableOpacity>
                </Animated.View>
              ))}
            </View>

            {goalReached && (
              <Animated.View style={[s.goalRow, { opacity: goalFadeAnim }]}>
                <Text style={s.goalText}>Goal reached ✓</Text>
              </Animated.View>
            )}

            {feedback && (
              <Animated.View
                style={[s.feedbackRow, { opacity: feedbackAnim }]}
              >
                <Text
                  style={[
                    s.feedbackText,
                    feedback.positive ? s.feedbackPositive : s.feedbackNeutral,
                  ]}
                >
                  {feedback.text}
                </Text>
              </Animated.View>
            )}

            {displayedEntries.length > 0 && (
              <View style={s.entriesSection}>
                <Text style={s.entriesLabel}>TODAY</Text>
                {displayedEntries.map((entry, i) => (
                  <View
                    key={`${entry.logged_at}-${i}`}
                    style={[
                      s.entryRow,
                      i < displayedEntries.length - 1 && s.entryBorder,
                    ]}
                  >
                    <Text style={s.entryAmount}>+{entry.amount_oz} oz</Text>
                    <Text style={s.entryTime}>{formatTime(entry.logged_at)}</Text>
                  </View>
                ))}
                {moreCount > 0 && (
                  <Text style={s.moreText}>+ {moreCount} more</Text>
                )}
              </View>
            )}
            </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "88%",
    paddingBottom: 0,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  handleWrap: { alignItems: "center", paddingTop: 12, paddingBottom: 4 },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
  },
  header: {
    fontSize: 18,
    fontWeight: "700",
    color: C.textPrimary,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textTertiary,
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  sectionTop: { marginTop: 16 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginHorizontal: 20,
    marginBottom: 4,
  },
  ringWrap: { alignItems: "center", marginBottom: 20 },
  ringValue: { fontSize: 26, fontWeight: "800", color: C.textPrimary },
  ringTarget: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 20,
  },
  addBtn: {
    backgroundColor: C.surfaceRaised,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 100,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  addBtnDisabled: { opacity: 0.6 },
  addBtnText: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  goalRow: { alignItems: "center", marginTop: 10 },
  goalText: { fontSize: 14, fontWeight: "600", color: C.success },
  entriesSection: { marginTop: 16, paddingHorizontal: 20 },
  entriesLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textTertiary,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  entryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 9,
  },
  entryBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  entryAmount: { fontSize: 14, fontWeight: "500", color: C.textPrimary },
  entryTime: { fontSize: 14, color: C.textSecondary },
  moreText: { fontSize: 13, color: C.textTertiary, marginTop: 6 },
  feedbackRow: {
    alignItems: "center",
    marginTop: 10,
    paddingHorizontal: 20,
  },
  feedbackText: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  feedbackPositive: { color: C.success },
  feedbackNeutral: { color: C.textSecondary },
  workoutRow: { paddingHorizontal: 20, marginBottom: 20 },
  workoutBtn: {
    backgroundColor: C.surfaceRaised,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: C.border,
    alignItems: "center",
  },
  workoutBtnText: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  workoutDone: { alignItems: "center", paddingVertical: 14 },
  workoutDoneText: { fontSize: 15, fontWeight: "600", color: C.success },
});
