import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  LayoutAnimation,
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
  UIManager,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../stores/authStore";
import { useScoreStore } from "../stores/scoreStore";
import { supabase } from "../lib/supabase";
import { POINTS, WORKOUT_MAX_DAILY, getStreakMultiplier } from "../lib/scoring";
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
import type { LogEntry, WorkoutLogEntry } from "../hooks/useLogActivitySheetData";
import { colors } from "../theme/colors";
import { PhotoPicker } from "./PhotoPicker";
import { uploadPhoto, attachPhotoToLatestFeedEntry, type PickedPhoto } from "../lib/photoUpload";
import { analytics } from "../lib/analytics";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

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

const QUICK_AMOUNTS = [8, 16, 32] as const;

type ActivityId = "steps" | "workout" | "calories" | "water";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LogSheetProps {
  visible: boolean;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// ManualBadge
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
// ActivityRow — collapsible row
// ─────────────────────────────────────────────────────────────────────────────

function ActivityRow({
  label,
  rightContent,
  showChevron,
  isExpanded,
  onPress,
  children,
}: {
  label: string;
  rightContent: React.ReactNode;
  showChevron: boolean;
  isExpanded: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  return (
    <View>
      <TouchableOpacity
        style={ar.header}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <Text style={ar.label}>{label}</Text>
        <View style={ar.right}>
          {rightContent}
          {showChevron && (
            <Ionicons
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={C.textTertiary}
              style={{ marginLeft: 6 }}
            />
          )}
        </View>
      </TouchableOpacity>
      {isExpanded && children != null && (
        <View style={ar.body}>{children}</View>
      )}
    </View>
  );
}

const ar = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    minHeight: 56,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
    justifyContent: "flex-end",
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  // Progress bar (used in HK expanded sections)
  barTrack: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: { height: 4, borderRadius: 2 },
  caption: { fontSize: 12, color: C.textTertiary },
  // Manual entry row
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: C.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: C.textPrimary,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  addBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { fontSize: 14, fontWeight: "700", color: "#FFF" },
  manualCaption: { fontSize: 12, color: C.textTertiary },
  // Workout expanded
  workoutBtn: {
    backgroundColor: C.surfaceRaised,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: C.border,
    alignItems: "center",
  },
  workoutBtnDisabled: { opacity: 0.5 },
  workoutBtnText: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  workoutDoneText: { fontSize: 15, fontWeight: "600", color: C.success, textAlign: "center", paddingVertical: 6 },
  // Water chips
  chipRow: {
    flexDirection: "row",
    gap: 10,
  },
  chip: {
    flex: 1,
    backgroundColor: C.surfaceRaised,
    paddingVertical: 12,
    borderRadius: 100,
    borderWidth: 0.5,
    borderColor: C.border,
    alignItems: "center",
  },
  chipDisabled: { opacity: 0.6 },
  chipText: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  goalText: { fontSize: 14, fontWeight: "600", color: C.success, textAlign: "center" },
  // Water entries
  entriesLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textTertiary,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  entryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  entryBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  entryAmount: { fontSize: 14, fontWeight: "500", color: C.textPrimary },
  entryTime: { fontSize: 14, color: C.textSecondary },
  moreText: { fontSize: 12, color: C.textTertiary, marginTop: 4 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton — 4 placeholder rows while data loads
// ─────────────────────────────────────────────────────────────────────────────

function RowSkeleton() {
  return (
    <View style={sk.card}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i}>
          <View style={sk.row}>
            <View style={sk.labelLine} />
            <View style={sk.valueLine} />
          </View>
          {i < 3 && <View style={sk.divider} />}
        </View>
      ))}
    </View>
  );
}

const sk = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    backgroundColor: C.surfaceRaised,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: C.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    minHeight: 56,
  },
  labelLine: {
    height: 14,
    width: 80,
    backgroundColor: C.border,
    borderRadius: 4,
  },
  valueLine: {
    height: 13,
    width: 110,
    backgroundColor: C.border,
    borderRadius: 4,
    opacity: 0.6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginHorizontal: 16,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Sync water total to daily_scores (unchanged)
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
          "total_points, water_achieved, steps_achieved, workout_achieved, workout_count, calories_achieved",
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

      const wCount = existing?.workout_count ?? 0;
      const basePointsWithoutWater =
        (existing?.steps_achieved ? POINTS.steps : 0) +
        Math.min(wCount, WORKOUT_MAX_DAILY) * POINTS.workout +
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

  // ── Row expansion ──────────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<ActivityId | null>(null);

  const toggleRow = (id: ActivityId) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // ── Manual entry inputs ────────────────────────────────────────────────────
  const [rawSteps, setRawSteps] = useState("");
  const [rawCal, setRawCal] = useState("");

  // ── Water state ───────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLogEntry[]>([]);
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
  const [photos, setPhotos] = useState<Partial<Record<ActivityId, PickedPhoto>>>({});
  const [feedback, setFeedback] = useState<{ text: string; positive: boolean } | null>(null);
  const feedbackAnim = useRef(new Animated.Value(0)).current;
  const prevRankRef = useRef<number | null>(null);

  // ── Data hook ─────────────────────────────────────────────────────────────

  const { data: hookData } = useLogActivitySheetData(userId, visible);

  useEffect(() => {
    if (!hookData) return;
    setEntries(hookData.entries);
    setWorkoutLogs(hookData.workoutLogs);
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
      setFeedback(null);
      setExpandedId(null);
      setRawSteps("");
      setRawCal("");
      setWorkoutLogs([]);
      setPhotos({});
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

  // ── Photo upload ──────────────────────────────────────────────────────────

  const uploadPhotoInBackground = useCallback(
    (activityType: ActivityId, photo: PickedPhoto) => {
      if (!userId || !packRun) return;
      const { packId } = packRun;
      setPhotos((prev) => {
        const next = { ...prev };
        delete next[activityType];
        return next;
      });
      uploadPhoto(userId, photo)
        .then((path) => {
          analytics.photoAdded(activityType, packId);
          return attachPhotoToLatestFeedEntry(userId, packId, activityType, path);
        })
        .catch((err: unknown) => {
          analytics.photoUploadFailed(err instanceof Error ? err.message : "unknown");
          Alert.alert("Upload failed", "Your activity was saved but the photo couldn't be uploaded.");
        });
    },
    [userId, packRun],
  );

  // ── Log workout ────────────────────────────────────────────────────────────

  const handleLogWorkout = async () => {
    if (!userId || workoutSaving) return;

    const currentCount = localScore?.workout_count ?? 0;
    if (currentCount >= WORKOUT_MAX_DAILY) return; // silently guard; UI already disables

    setWorkoutSaving(true);
    Vibration.vibrate(40);

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const newWorkoutCount = currentCount + 1;

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
          Math.min(newWorkoutCount, WORKOUT_MAX_DAILY) * POINTS.workout +
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
        workout_count: newWorkoutCount,
        total_points: newTotalPoints,
      };
      patchMyScore(packRun.packId, patch);
      setLocalScore((prev) => (prev ? { ...prev, ...patch } : null));
    }

    // Optimistically add a log entry for the expanded history
    setWorkoutLogs((prev) => [...prev, { logged_at: now.toISOString(), entry_method: "manual" }]);

    try {
      await syncManualActivityToDailyScores(userId, "workout", 1, today);
      if (photos.workout) uploadPhotoInBackground("workout", photos.workout);
      invalidateLogActivitySheetCache();
      bumpLogVersion();
      if (packRun) {
        fetchFeedback(userId, packRun.runId).catch((e) =>
          console.warn("[LogSheet] fetchFeedback:", e),
        );
      }
    } catch (err) {
      // Rollback optimistic update on error
      setWorkoutLogs((prev) => prev.slice(0, -1));
      console.error("[LogSheet] handleLogWorkout error:", err);
      if (packRun && localScore) {
        patchMyScore(packRun.packId, {
          weekly_points: localWeeklyPoints,
          workout_achieved: localScore.workout_achieved,
          workout_count: localScore.workout_count,
          total_points: localScore.total_points,
        });
        setLocalScore((prev) => prev ? { ...prev, workout_count: currentCount } : null);
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
      if (photos.steps) uploadPhotoInBackground("steps", photos.steps);
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
      if (photos.calories) uploadPhotoInBackground("calories", photos.calories);
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

  const handleSaveManualSteps = () => {
    const n = parseInt(rawSteps.replace(/,/g, ""), 10);
    if (!isNaN(n) && n > 0) {
      handleManualSteps(n);
      setRawSteps("");
    }
  };

  const handleSaveManualCal = () => {
    const n = parseInt(rawCal.replace(/,/g, ""), 10);
    if (!isNaN(n) && n > 0) {
      handleManualCalories(n);
      setRawCal("");
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
        Animated.spring(anim, { toValue: 0.94, useNativeDriver: true, speed: 50, bounciness: 0 }),
        Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 4 }),
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
      if (photos.water) uploadPhotoInBackground("water", photos.water);
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

  // ── Derived values ─────────────────────────────────────────────────────────

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const goalReached = waterTarget > 0 && totalOz >= waterTarget;
  const displayedEntries = entries.slice(0, 5);
  const moreCount = entries.length - 5;

  const stepsAchieved = localScore?.steps_achieved ?? false;
  const calAchieved = localScore?.calories_achieved ?? false;
  const stepsBarPct = hkAuthorized && stepTarget > 0 && stepsToday !== null
    ? (`${Math.round(Math.min(1, stepsToday / stepTarget) * 100)}%` as `${number}%`)
    : "0%";
  const calBarPct = hkAuthorized && calorieTarget > 0 && caloriesToday !== null
    ? (`${Math.round(Math.min(1, caloriesToday / calorieTarget) * 100)}%` as `${number}%`)
    : "0%";

  // ── Row right-side content helpers ────────────────────────────────────────

  function hkRowRight(
    value: number | null,
    target: number,
    unit: string,
    achieved: boolean,
    hasManual: boolean,
  ) {
    if (!hkAvailable) {
      return <Text style={s.valueDim}>—</Text>;
    }
    if (!hkAuthorized) {
      return <Text style={s.valueAccent}>Connect</Text>;
    }
    return (
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={s.rowValue}>
            {value !== null ? value.toLocaleString() : "—"} / {target.toLocaleString()} {unit}
          </Text>
          {hasManual && <ManualBadge />}
          {achieved && <Text style={s.rowCheck}>✓</Text>}
        </View>
        <Text style={s.rowCaption}>Synced from Apple Health</Text>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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
              <RowSkeleton />
            ) : (
              <View style={s.card}>
                {/* ── STEPS ───────────────────────────────────────────── */}
                <ActivityRow
                  label="Steps"
                  rightContent={hkRowRight(stepsToday, stepTarget, "steps", stepsAchieved, hasManualSteps)}
                  showChevron={hkAvailable && hkAuthorized}
                  isExpanded={expandedId === "steps"}
                  onPress={() => {
                    if (!hkAvailable) return;
                    if (!hkAuthorized) { handleConnectHealthKit(); return; }
                    toggleRow("steps");
                  }}
                >
                  {/* Progress bar */}
                  <View style={ar.barTrack}>
                    <View style={[ar.barFill, { width: stepsBarPct, backgroundColor: stepsAchieved ? C.success : C.accent }]} />
                  </View>
                  <Text style={ar.caption}>♥ Synced from Apple Health</Text>
                  {/* Manual entry */}
                  <View style={ar.inputRow}>
                    <TextInput
                      style={ar.input}
                      value={rawSteps}
                      onChangeText={setRawSteps}
                      placeholder="0 steps"
                      placeholderTextColor={C.textTertiary}
                      keyboardType="number-pad"
                      maxLength={8}
                    />
                    <TouchableOpacity
                      style={[ar.addBtn, (manualStepsSaving || rawSteps.length === 0) && ar.addBtnDisabled]}
                      onPress={handleSaveManualSteps}
                      disabled={manualStepsSaving || rawSteps.length === 0}
                      activeOpacity={0.8}
                    >
                      <Text style={ar.addBtnText}>{manualStepsSaving ? "…" : "Add"}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={ar.manualCaption}>Manual entries are flagged with M to your pack.</Text>
                  <PhotoPicker
                    photo={photos.steps ?? null}
                    onPhotoSelected={(p) => setPhotos((prev) => ({ ...prev, steps: p }))}
                    onPhotoRemoved={() => setPhotos((prev) => { const n = { ...prev }; delete n.steps; return n; })}
                    disabled={manualStepsSaving}
                  />
                </ActivityRow>

                <View style={s.rowDivider} />

                {/* ── WORKOUT ─────────────────────────────────────────── */}
                {(() => {
                  const wCount = localScore?.workout_count ?? 0;
                  const atCap = wCount >= WORKOUT_MAX_DAILY;
                  return (
                    <ActivityRow
                      label="Workout"
                      rightContent={
                        atCap
                          ? <Text style={s.valueSuccess}>{wCount}/{WORKOUT_MAX_DAILY} ✓</Text>
                          : wCount === 1
                            ? <Text style={s.valueDim}>1/{WORKOUT_MAX_DAILY} logged</Text>
                            : <Text style={s.valueDim}>Not logged</Text>
                      }
                      showChevron
                      isExpanded={expandedId === "workout"}
                      onPress={() => toggleRow("workout")}
                    >
                      {/* Log button */}
                      {atCap ? (
                        <Text style={ar.workoutDoneText}>
                          {WORKOUT_MAX_DAILY}/{WORKOUT_MAX_DAILY} workouts today — max reached
                        </Text>
                      ) : (
                        <TouchableOpacity
                          style={[ar.workoutBtn, workoutSaving && ar.workoutBtnDisabled]}
                          onPress={handleLogWorkout}
                          disabled={workoutSaving}
                          activeOpacity={0.8}
                        >
                          <Text style={ar.workoutBtnText}>
                            {wCount === 1
                              ? `Log Another Workout  +${POINTS.workout} pts`
                              : `Log Workout  +${POINTS.workout} pts`}
                          </Text>
                        </TouchableOpacity>
                      )}

                      {!atCap && (
                        <PhotoPicker
                          photo={photos.workout ?? null}
                          onPhotoSelected={(p) => setPhotos((prev) => ({ ...prev, workout: p }))}
                          onPhotoRemoved={() => setPhotos((prev) => { const n = { ...prev }; delete n.workout; return n; })}
                          disabled={workoutSaving}
                        />
                      )}

                      {/* History of today's workouts */}
                      {workoutLogs.length > 0 && (
                        <View>
                          <Text style={ar.entriesLabel}>TODAY</Text>
                          {workoutLogs.map((w, i) => (
                            <View
                              key={`${w.logged_at}-${i}`}
                              style={[ar.entryRow, i < workoutLogs.length - 1 && ar.entryBorder]}
                            >
                              <Text style={ar.entryAmount}>
                                {w.entry_method === "healthkit" ? "Apple Health" : "Manual"}
                              </Text>
                              <Text style={ar.entryTime}>{formatTime(w.logged_at)}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </ActivityRow>
                  );
                })()}

                <View style={s.rowDivider} />

                {/* ── ACTIVE CALORIES ─────────────────────────────────── */}
                <ActivityRow
                  label="Active Calories"
                  rightContent={hkRowRight(caloriesToday, calorieTarget, "cal", calAchieved, hasManualCalories)}
                  showChevron={hkAvailable && hkAuthorized}
                  isExpanded={expandedId === "calories"}
                  onPress={() => {
                    if (!hkAvailable) return;
                    if (!hkAuthorized) { handleConnectHealthKit(); return; }
                    toggleRow("calories");
                  }}
                >
                  <View style={ar.barTrack}>
                    <View style={[ar.barFill, { width: calBarPct, backgroundColor: calAchieved ? C.success : C.accent }]} />
                  </View>
                  <Text style={ar.caption}>♥ Synced from Apple Health</Text>
                  <View style={ar.inputRow}>
                    <TextInput
                      style={ar.input}
                      value={rawCal}
                      onChangeText={setRawCal}
                      placeholder="0 cal"
                      placeholderTextColor={C.textTertiary}
                      keyboardType="number-pad"
                      maxLength={8}
                    />
                    <TouchableOpacity
                      style={[ar.addBtn, (manualCalSaving || rawCal.length === 0) && ar.addBtnDisabled]}
                      onPress={handleSaveManualCal}
                      disabled={manualCalSaving || rawCal.length === 0}
                      activeOpacity={0.8}
                    >
                      <Text style={ar.addBtnText}>{manualCalSaving ? "…" : "Add"}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={ar.manualCaption}>Manual entries are flagged with M to your pack.</Text>
                  <PhotoPicker
                    photo={photos.calories ?? null}
                    onPhotoSelected={(p) => setPhotos((prev) => ({ ...prev, calories: p }))}
                    onPhotoRemoved={() => setPhotos((prev) => { const n = { ...prev }; delete n.calories; return n; })}
                    disabled={manualCalSaving}
                  />
                </ActivityRow>

                <View style={s.rowDivider} />

                {/* ── WATER ───────────────────────────────────────────── */}
                <ActivityRow
                  label="Water"
                  rightContent={
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={s.rowValue}>{totalOz} / {waterTarget} oz</Text>
                      {goalReached && <Text style={s.rowCheck}>✓</Text>}
                    </View>
                  }
                  showChevron
                  isExpanded={expandedId === "water"}
                  onPress={() => toggleRow("water")}
                >
                  {/* Quick-add chips */}
                  <View style={ar.chipRow}>
                    {QUICK_AMOUNTS.map((amount) => (
                      <Animated.View
                        key={amount}
                        style={{ flex: 1, transform: [{ scale: scaleAnims[amount] }] }}
                      >
                        <TouchableOpacity
                          style={[ar.chip, saving && ar.chipDisabled]}
                          onPress={() => handleAddWater(amount)}
                          disabled={saving}
                          activeOpacity={1}
                        >
                          <Text style={ar.chipText}>+{amount} oz</Text>
                        </TouchableOpacity>
                      </Animated.View>
                    ))}
                  </View>

                  <PhotoPicker
                    photo={photos.water ?? null}
                    onPhotoSelected={(p) => setPhotos((prev) => ({ ...prev, water: p }))}
                    onPhotoRemoved={() => setPhotos((prev) => { const n = { ...prev }; delete n.water; return n; })}
                    disabled={saving}
                  />

                  {goalReached && (
                    <Animated.View style={{ opacity: goalFadeAnim }}>
                      <Text style={ar.goalText}>Goal reached ✓</Text>
                    </Animated.View>
                  )}

                  {/* Water entries log */}
                  {displayedEntries.length > 0 && (
                    <View>
                      <Text style={ar.entriesLabel}>TODAY</Text>
                      {displayedEntries.map((entry, i) => (
                        <View
                          key={`${entry.logged_at}-${i}`}
                          style={[ar.entryRow, i < displayedEntries.length - 1 && ar.entryBorder]}
                        >
                          <Text style={ar.entryAmount}>+{entry.amount_oz} oz</Text>
                          <Text style={ar.entryTime}>{formatTime(entry.logged_at)}</Text>
                        </View>
                      ))}
                      {moreCount > 0 && <Text style={ar.moreText}>+ {moreCount} more</Text>}
                    </View>
                  )}
                </ActivityRow>
              </View>
            )}

            {/* Feedback banner */}
            {feedback && (
              <Animated.View style={[s.feedbackRow, { opacity: feedbackAnim }]}>
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
  // Rows card — groups all activity rows
  card: {
    marginHorizontal: 16,
    backgroundColor: C.surfaceRaised,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: C.border,
    overflow: "hidden",
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginHorizontal: 16,
  },
  // Row right-side value styles
  rowValue: {
    fontSize: 14,
    fontWeight: "500",
    color: C.textSecondary,
  },
  rowCaption: {
    fontSize: 11,
    color: C.textTertiary,
  },
  rowCheck: {
    fontSize: 14,
    color: C.success,
    fontWeight: "700",
  },
  valueDim: {
    fontSize: 14,
    color: C.textTertiary,
  },
  valueAccent: {
    fontSize: 14,
    fontWeight: "600",
    color: C.accent,
  },
  valueSuccess: {
    fontSize: 14,
    fontWeight: "600",
    color: C.success,
  },
  // Feedback
  feedbackRow: {
    alignItems: "center",
    marginTop: 16,
    paddingHorizontal: 20,
  },
  feedbackText: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  feedbackPositive: { color: C.success },
  feedbackNeutral: { color: C.textSecondary },
});
