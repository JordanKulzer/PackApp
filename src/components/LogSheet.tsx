import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Vibration,
  StyleSheet,
  UIManager,
  AccessibilityInfo,
  Dimensions,
} from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../stores/authStore";
import { useScoreStore } from "../stores/scoreStore";
import { supabase } from "../lib/supabase";
import { syncManualActivityToDailyScores } from "../lib/logActivity";
import { deviceLocalToday } from "../lib/packDates";
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
import type {
  LogEntry,
  WorkoutLogEntry,
} from "../hooks/useLogActivitySheetData";
import { colors } from "../theme/colors";
import { syncWaterToDailyScores } from "../lib/syncWater";
import { CategoryChip, EmptyChipSlot } from "./CategoryChip";
import {
  SeeMoreCategoriesSheet,
  type SeeMoreEntryPoint,
} from "./SeeMoreCategoriesSheet";
import {
  CATEGORY_DISPLAY_NAMES,
  type ActivityCategory,
} from "../lib/activityCategoryMap";
import { useCurrentUser } from "../context/CurrentUserContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { activity as activityCopy } from "../constants/strings";
import { SkeletonBox } from "./SkeletonBox";

// Pass 25-followup-C-fix-2: single source of truth for data cap = display
// cap = swap-mode threshold. Was 6 (with a -1 offset on render to keep the
// Add tile visible) — that split caused the 6th pinned to render in the
// picker but not the chip grid. Now: data and display agree at 5, and
// every cap expression reads as `MAX` (no `MAX - 1` offsets anywhere).
const QUICK_SELECT_MAX = 5;
const QUICK_SELECT_HINT_KEY = "pack:logsheet:hint:quickselect";

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

// Pass 25-followup-B-final Section A: shared empty-shape baseline for
// optimistic localScore patching. Pre-fix, every handler used
// `setLocalScore((prev) => prev ? {...prev, ...patch} : null)` — which
// silently dropped the patch when prev was null (first-of-day open before
// any daily_scores row exists). Now handlers spread off this constant when
// prev is null: `({ ...(prev ?? EMPTY_LOCAL_SCORE), ...patch })`. Server-
// side scoring still writes the canonical daily_scores row per pack.
const EMPTY_LOCAL_SCORE = {
  total_points: 0,
  steps_achieved: false,
  workout_achieved: false,
  calories_achieved: false,
  water_achieved: false,
  water_oz_count: 0,
  steps_count: 0,
  calories_count: 0,
  workout_count: 0,
  streak_days: 0,
  streak_multiplier: 1,
  manual_steps_count: 0,
  manual_calories_count: 0,
};

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
  text: {
    fontSize: 10,
    fontWeight: "700",
    color: C.textSecondary,
    letterSpacing: 0.3,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// HealthSourceBadge
// ─────────────────────────────────────────────────────────────────────────────

function HealthSourceBadge({ style }: { style?: StyleProp<TextStyle> }) {
  return (
    <View style={hsbS.row}>
      <Text style={hsbS.icon}>♥</Text>
      <Text style={[hsbS.label, style]}>Apple Health</Text>
    </View>
  );
}

const hsbS = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  icon: { fontSize: 11, color: "#FA2C4F" },
  label: { fontSize: 11, color: C.textTertiary, fontWeight: "500" },
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
      <TouchableOpacity style={ar.header} onPress={onPress} activeOpacity={0.7}>
        <Text style={ar.label}>{label}</Text>
        <View style={ar.right}>
          {rightContent}
          {showChevron && (
            <Ionicons
              name="chevron-forward"
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
    paddingVertical: 20,
    minHeight: 72,
  },
  label: {
    fontSize: 15,
    fontWeight: "400",
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
  // Pass 25-followup-B: HK expanded-section progress bar removed (no
  // target = no goal-progress denominator). Caption (HealthSourceBadge
  // sub-text) stays.
  caption: { fontSize: 12, color: C.textTertiary },
  // Manual entry row
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  // Pass 25: subtle-box treatment matching New Pack's nameInput. Transparent
  // background avoids the recessed-well look once the boxed card wrapper is
  // gone; hairline border + radius 8 match the rest of the design language.
  input: {
    flex: 1,
    fontSize: 15,
    color: C.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 8,
    backgroundColor: "transparent",
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
  // Part D: HealthKit auto-fill affordance in the manual detail screens.
  connectHealthRow: {
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 8,
    gap: 2,
  },
  connectHealthLabel: { fontSize: 14, fontWeight: "600", color: C.accent },
  connectHealthHint: { fontSize: 12, color: C.textTertiary },
});

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton — 4 placeholder rows while data loads
// ─────────────────────────────────────────────────────────────────────────────

function RowSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <View key={i}>
          <View style={sk.row}>
            <SkeletonBox width={80} height={14} borderRadius={4} />
            <SkeletonBox width={110} height={13} borderRadius={4} />
          </View>
          {i < 3 && <View style={sk.divider} />}
        </View>
      ))}
    </>
  );
}

const sk = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    minHeight: 64,
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
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LogSheet({ visible, onClose }: LogSheetProps) {
  const userId = useAuthStore((s) => s.user?.id);

  const [modalVisible, setModalVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(600)).current;
  // Pass 26 CHANGE 4: drag-down to dismiss. PanResponder attached to the
  // drag handle (sibling of the page track, so always gesture-active on
  // any page). Trigger onClose when the user drags past ~80px or releases
  // with downward velocity. The existing slide-out animation runs via the
  // visible→false effect — no custom drag-follow animation introduced.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) slideAnim.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 60 || g.vy > 0.3) {
          onCloseRef.current();
        } else {
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
    }),
  ).current;
  // Pass 25-followup-B-final-2 Section C: keyboard offset composed with the
  // sheet's slide animation via Animated.add so the sheet translates up
  // when the keyboard opens. Both translateY values run on the native
  // driver — no JS-thread layout work, no driver mixing.
  const keyboardOffsetAnim = useRef(new Animated.Value(0)).current;

  const scaleAnims = useRef(
    QUICK_AMOUNTS.reduce<Record<number, Animated.Value>>((acc, amt) => {
      acc[amt] = new Animated.Value(1);
      return acc;
    }, {}),
  ).current;

  // ── Page navigation ───────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState<"overview" | ActivityId>(
    "overview",
  );
  const pageAnim = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const dataOpacityAnim = useRef(new Animated.Value(0)).current;

  // ── Manual entry inputs ────────────────────────────────────────────────────
  const [rawSteps, setRawSteps] = useState("");
  const [rawCal, setRawCal] = useState("");

  // ── Water state ───────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLogEntry[]>([]);
  const [totalOz, setTotalOz] = useState(0);
  const [saving, setSaving] = useState(false);

  // ── HealthKit state ────────────────────────────────────────────────────────
  const hkAvailable = Platform.OS === "ios" && isHealthKitAvailable();
  const [hkAuthorized, setHkAuthorized] = useState(false);
  const [stepsToday, setStepsToday] = useState<number | null>(null);
  const [caloriesToday, setCaloriesToday] = useState<number | null>(null);

  // ── Manual entry state ─────────────────────────────────────────────────────
  const [hasManualSteps, setHasManualSteps] = useState(false);
  const [hasManualCalories, setHasManualCalories] = useState(false);
  const [manualStepsSaving, setManualStepsSaving] = useState(false);
  const [manualCalSaving, setManualCalSaving] = useState(false);

  // ── Score store ───────────────────────────────────────────────────────────
  const patchMyScore = useScoreStore((s) => s.patchMyScore);
  const bumpLogVersion = useScoreStore((s) => s.bumpLogVersion);

  const [packRun, setPackRun] = useState<{
    runId: string;
    packId: string;
    packTimezone: string;
  } | null>(null);
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
    manual_steps_count: number;
    manual_calories_count: number;
  } | null>(null);

  const [workoutSaving, setWorkoutSaving] = useState(false);

  // Pass C-revised-followup-B: the LogSheet photo affordance was removed.
  // Photo capture now lives only in the chat composer (ChatInputBar).
  // Existing activity_feed rows with photo_url from the old LogSheet
  // pathway still render in the feed; only the capture UI is gone.

  // Pass 25-followup-B-fix Section A: per-row log-success flash. On every
  // successful log, the corresponding row's value text briefly tints
  // C.success and fades back to C.textPrimary over 600ms. useNativeDriver:
  // false because color interpolation runs on the JS thread. Independent
  // refs per row so rapid sequential logs don't race.
  const stepsFlashAnim = useRef(new Animated.Value(0)).current;
  const caloriesFlashAnim = useRef(new Animated.Value(0)).current;
  const workoutFlashAnim = useRef(new Animated.Value(0)).current;
  const waterFlashAnim = useRef(new Animated.Value(0)).current;

  // ── Quick Select (workout category chips inside the Workout row) ─────────
  const { user: currentUser, applyLocal } = useCurrentUser();
  // Pass 25-followup-C-fix-2: display-only slice at consumption. Existing
  // dev-state rows with 6+ pinned categories silently render the first 5;
  // the next save (pin/unpin/swap) cleans storage via saveQuickSelect's
  // slice(0, QUICK_SELECT_MAX). No login-time write-back.
  const quickSelectCategories: ActivityCategory[] =
    currentUser?.quickSelectCategories?.slice(0, QUICK_SELECT_MAX) ?? [];

  const [seeMoreState, setSeeMoreState] = useState<{
    open: boolean;
    entryPoint: SeeMoreEntryPoint;
    replaceTargetIndex?: number;
  }>({ open: false, entryPoint: "add" });

  // Pass 25-followup-C-fix: when Quick Select is full and the user picks a
  // new category from the See More sheet, we don't pin immediately — we
  // flip the sheet into swap mode so the user can choose which existing
  // pin to replace. Stored as state on LogSheet (not the sheet itself) so
  // the swap target survives the sheet closing/reopening transitions and
  // so handleSwapModeReplace can reuse the existing handleReplaceCategory
  // primitive without prop-drilling the pending category through.
  const [pendingSwapCategory, setPendingSwapCategory] =
    useState<ActivityCategory | null>(null);

  const [chipMenuIndex, setChipMenuIndex] = useState<number | null>(null);

  const [hintDismissed, setHintDismissed] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem(QUICK_SELECT_HINT_KEY).then((v) => {
      setHintDismissed(v === "1");
    });
  }, []);
  const dismissHint = () => {
    if (hintDismissed) return;
    setHintDismissed(true);
    AsyncStorage.setItem(QUICK_SELECT_HINT_KEY, "1").catch(() => {});
  };

  const saveQuickSelect = async (next: ActivityCategory[]) => {
    if (!userId) return;
    applyLocal({ quickSelectCategories: next });
    const { error } = await supabase
      .from("users")
      .update({ quick_select_categories: next })
      .eq("id", userId);
    if (error) {
      console.error("[LogSheet] save quick_select_categories error:", error);
    }
  };

  const handlePinCategory = async (cat: ActivityCategory) => {
    if (quickSelectCategories.includes(cat)) return;
    // Pass 25-followup-C-fix: if Quick Select is full, flip the SeeMore
    // sheet into swap mode and stop here. The user picks which pinned
    // chip to replace via handleSwapModeReplace.
    if (quickSelectCategories.length >= QUICK_SELECT_MAX) {
      setPendingSwapCategory(cat);
      return;
    }
    const next = [...quickSelectCategories, cat].slice(0, QUICK_SELECT_MAX);
    await saveQuickSelect(next);
  };

  const handleReplaceCategory = async (idx: number, cat: ActivityCategory) => {
    if (idx < 0 || idx >= quickSelectCategories.length) return;
    const next = [...quickSelectCategories];
    const existingIdx = next.indexOf(cat);
    if (existingIdx !== -1) {
      // Swap if the chosen category is already pinned elsewhere
      next[existingIdx] = next[idx];
    }
    next[idx] = cat;
    await saveQuickSelect(next);
  };

  const handleSwapModeReplace = async (idx: number) => {
    if (!pendingSwapCategory) return;
    const cat = pendingSwapCategory;
    setPendingSwapCategory(null);
    closeSeeMore();
    await handleReplaceCategory(idx, cat);
  };

  const handleSwapCancel = () => {
    setPendingSwapCategory(null);
  };

  const handleRemoveCategory = async (idx: number) => {
    const next = quickSelectCategories.filter((_, i) => i !== idx);
    await saveQuickSelect(next);
  };

  const openSeeMore = (
    entryPoint: SeeMoreEntryPoint,
    replaceTargetIndex?: number,
  ) => {
    dismissHint();
    setSeeMoreState({ open: true, entryPoint, replaceTargetIndex });
  };

  const closeSeeMore = () =>
    setSeeMoreState((prev) => ({ ...prev, open: false }));

  // ── Data hook ─────────────────────────────────────────────────────────────

  const { data: hookData } = useLogActivitySheetData(userId, visible);

  useEffect(() => {
    if (!hookData) return;
    setEntries(hookData.entries);
    setWorkoutLogs(hookData.workoutLogs);
    setTotalOz(hookData.totalOz);
    setHkAuthorized(hookData.hkAuthorized);
    setStepsToday(hookData.stepsToday);
    setCaloriesToday(hookData.caloriesToday);
    setPackRun(hookData.packRun);
    setLocalWeeklyPoints(hookData.localWeeklyPoints);
    setLocalScore(hookData.localScore);
    // F.2: M-badge derives from manual_*_count > 0 (replaced the prior
    // has_manual_* booleans dropped in migration 20260513b).
    setHasManualSteps((hookData.localScore?.manual_steps_count ?? 0) > 0);
    setHasManualCalories((hookData.localScore?.manual_calories_count ?? 0) > 0);
    if (hookData.packRun && hookData.localScore) {
      patchMyScore(hookData.packRun.packId, {
        ...hookData.localScore,
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
      setCurrentPage("overview");
      pageAnim.setValue(0);
      setRawSteps("");
      setRawCal("");
      setWorkoutLogs([]);
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

  // ── Keyboard offset (Pass 25-followup-B-final-2 Section C) ────────────────
  //
  // Translate the sheet upward by keyboard height when the keyboard opens
  // so the row header + expanded body sit above the keyboard. Composed
  // with slideAnim via Animated.add at the sheet's transform — both
  // values run on the native driver, no driver mixing.
  //
  // Match `event.duration` from the keyboard event for native-feel sync.
  // Fallback 250ms if duration is missing (older iOS sometimes reports 0).
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardWillShow", (e) => {
      Animated.timing(keyboardOffsetAnim, {
        toValue: -e.endCoordinates.height,
        duration: e.duration || 250,
        useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener("keyboardWillHide", (e) => {
      Animated.timing(keyboardOffsetAnim, {
        toValue: 0,
        duration: e.duration || 250,
        useNativeDriver: true,
      }).start();
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardOffsetAnim]);

  // ── Reduce motion preference ───────────────────────────────────────────────
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      if (sub?.remove) sub.remove();
    };
  }, []);

  // ── Data opacity animation ─────────────────────────────────────────────────
  useEffect(() => {
    if (hookData) {
      Animated.timing(dataOpacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      dataOpacityAnim.setValue(0);
    }
  }, [hookData, dataOpacityAnim]);

  // ── Connect Apple Health ───────────────────────────────────────────────────

  const handleConnectHealthKit = async () => {
    if (!userId) return;
    try {
      const granted = await requestHealthKitPermissions();
      if (!granted) return;
      // Part E: no longer writes users.healthkit_authorized. The real iOS
      // status (getHealthKitAuthStatus, read in useLogActivitySheetData) is
      // the source of truth; the DB column is not an auth source.
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

  // ── Page navigation ────────────────────────────────────────────────────────
  const goToDetail = (id: ActivityId) => {
    setCurrentPage(id);
    if (reduceMotion) {
      pageAnim.setValue(1);
    } else {
      Animated.timing(pageAnim, {
        toValue: 1,
        duration: 250,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  };

  const goToOverview = () => {
    if (reduceMotion) {
      pageAnim.setValue(0);
      setCurrentPage("overview");
    } else {
      Animated.timing(pageAnim, {
        toValue: 0,
        duration: 250,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setCurrentPage("overview");
      });
    }
  };

  // ── Log-success flash ────────────────────────────────────────────────────

  // Pass 25-followup-B-fix Section A: brief tint-fade on the row's value
  // text after a successful log. Decoupled from any target/achievement —
  // fires on every successful log as plain "we got it" acknowledgment.
  // Pass 25-followup-B-polish Section A: hold-then-fade timing curve.
  // Instant peak (0ms timing) + 200ms hold at full green + 600ms fade.
  // The held peak gives the eye time to register before the fade — the
  // pre-polish 600ms color-only fade was too subtle to perceive.
  function flashRow(anim: Animated.Value) {
    Animated.sequence([
      Animated.timing(anim, {
        toValue: 1,
        duration: 0,
        useNativeDriver: false,
      }),
      Animated.delay(200),
      Animated.timing(anim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: false,
      }),
    ]).start();
  }

  // ── Log workout ────────────────────────────────────────────────────────────

  const handleLogWorkout = async (category: ActivityCategory) => {
    if (!userId || workoutSaving) return;

    // Pass 25-followup-C: cap-gate removed. Users can log activity that
    // happened; scoring caps points server-side via workoutPoints helper.
    const currentCount = localScore?.workout_count ?? 0;

    setWorkoutSaving(true);
    dismissHint();
    Vibration.vibrate(40);

    const newWorkoutCount = currentCount + 1;

    // Pass 25-followup-B-final-2 Section A checkpoint 2: optimistic local
    // UI patch lifted out of the `if (packRun)` gate. setLocalScore +
    // points computation + setLocalWeeklyPoints all run unconditionally so
    // fresh-day-start (when packRun resolves null until run is fetched)
    // doesn't lose the optimistic UI update. patchMyScore alone stays
    // gated since it requires packRun.packId.
    // Stage 2A: the optimistic points computation is gone with the POINTS
    // table. The patch carries only count/achievement fields now.
    const patch = {
      workout_achieved: true,
      workout_count: newWorkoutCount,
    };
    setLocalScore((prev) => ({ ...(prev ?? EMPTY_LOCAL_SCORE), ...patch }));
    if (packRun) {
      patchMyScore(packRun.packId, patch);
    }

    // Optimistically add a log entry for the expanded history
    setWorkoutLogs((prev) => [
      ...prev,
      { logged_at: new Date().toISOString(), entry_method: "manual" },
    ]);
    flashRow(workoutFlashAnim);

    try {
      await syncManualActivityToDailyScores(userId, "workout", 1, category);
      invalidateLogActivitySheetCache();
      bumpLogVersion();
    } catch (err) {
      // Rollback optimistic update on error
      setWorkoutLogs((prev) => prev.slice(0, -1));
      console.error("[LogSheet] handleLogWorkout error:", err);
      setLocalScore((prev) => ({
        ...(prev ?? EMPTY_LOCAL_SCORE),
        workout_count: currentCount,
      }));
      if (packRun && localScore) {
        patchMyScore(packRun.packId, {
          workout_achieved: localScore.workout_achieved,
          workout_count: localScore.workout_count,
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

    // Pass 25-followup-B: count-only optimistic patching. Achievement +
    // total_points re-derive server-side per-pack and refetch after
    // syncManualActivityToDailyScores. fetchFeedback was target-tied; gone.
    const prevCount = localScore?.steps_count ?? 0;
    const newCount = prevCount + delta;

    // Pass 25-followup-B-final-2 Section A checkpoint 2: setLocalScore
    // lifted out of the packRun gate so optimistic count UI updates fire
    // even on fresh-day-start when packRun is null.
    const patch = { steps_count: newCount };
    setLocalScore((prev) => ({ ...(prev ?? EMPTY_LOCAL_SCORE), ...patch }));
    if (packRun) {
      patchMyScore(packRun.packId, patch);
    }
    setHasManualSteps(true);
    flashRow(stepsFlashAnim);

    try {
      await syncManualActivityToDailyScores(userId, "steps", delta);
      invalidateLogActivitySheetCache();
      bumpLogVersion();
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

    // Pass 25-followup-B: count-only optimistic patching (see handleManualSteps).
    const prevCount = localScore?.calories_count ?? 0;
    const newCount = prevCount + delta;

    // Pass 25-followup-B-final-2 Section A checkpoint 2: setLocalScore lifted (see handleManualSteps).
    const patch = { calories_count: newCount };
    setLocalScore((prev) => ({ ...(prev ?? EMPTY_LOCAL_SCORE), ...patch }));
    if (packRun) {
      patchMyScore(packRun.packId, patch);
    }
    setHasManualCalories(true);
    flashRow(caloriesFlashAnim);

    try {
      await syncManualActivityToDailyScores(userId, "calories", delta);
      invalidateLogActivitySheetCache();
      bumpLogVersion();
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
    // F.2: deviceLocalToday() is the single source of truth for the
    // YYYY-MM-DD string written to water_logs.log_date. syncWater and
    // useLogActivitySheetData read the table with the same helper, so
    // all three surfaces resolve identical date strings (was an
    // inline getFullYear/Month/Date construction here + an
    // Intl.DateTimeFormat call on the read side that leaked UTC in
    // Hermes — F.2 Bug 3).
    const today = deviceLocalToday();
    const newTotalOz = totalOz + amount;
    const newEntry: LogEntry = {
      amount_oz: amount,
      logged_at: now.toISOString(),
    };

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

    // Pass 25-followup-B: count-only optimistic patching (see handleManualSteps).
    // Pass 25-followup-B-final-2 Section A checkpoint 2: setLocalScore lifted out
    // of packRun gate so optimistic count UI updates on fresh-day-start.
    const patch = { water_oz_count: Math.round(newTotalOz) };
    setLocalScore((prev) => ({ ...(prev ?? EMPTY_LOCAL_SCORE), ...patch }));
    if (packRun) {
      patchMyScore(packRun.packId, patch);
    }
    flashRow(waterFlashAnim);

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
    new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  const displayedEntries = entries.slice(0, 5);
  const moreCount = entries.length - 5;

  // Prefer the DB-backed localScore count (includes manual entries) over the raw
  // HealthKit value, which never reflects manual additions.
  const stepsDisplay: number | null = localScore?.steps_count ?? stepsToday;
  const calDisplay: number | null = localScore?.calories_count ?? caloriesToday;

  // ── Quick Select and page variables ────────────────────────────────────────
  const screenWidth = Dimensions.get("window").width;
  const translateX = pageAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -screenWidth],
  });
  const wCount = localScore?.workout_count ?? 0;
  const visibleChips = quickSelectCategories.slice(0, QUICK_SELECT_MAX);
  const canAddMore = quickSelectCategories.length < QUICK_SELECT_MAX;
  const showHint = !hintDismissed && canAddMore;

  // ── Row right-side content helpers ────────────────────────────────────────

  // Pass 25-followup-B: targets and achievement check removed. Renders the
  // user's "today" count without a goal denominator. LogSheet is now a
  // personal logger; per-pack achievement evaluation lives server-side.
  // Pass 25-followup-B-fix: value text now Animated.Text driven by the row's
  // flashAnim — interpolates color C.textPrimary → C.success on log success.
  function hkRowRight(
    value: number | null,
    hasManual: boolean,
    flashAnim: Animated.Value,
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
          <Animated.Text
            style={[
              s.rowValue,
              {
                color: flashAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [C.textPrimary, C.success],
                }),
              },
            ]}
          >
            {value !== null ? value.toLocaleString() : "—"}
          </Animated.Text>
          {/* TODO(voice review): "today" suffix copy provisional. */}
          <Text style={s.rowToday}>today</Text>
          {hasManual && <ManualBadge />}
        </View>
        <HealthSourceBadge style={s.rowCaption} />
      </View>
    );
  }

  // Part D: HealthKit auto-fill affordance inside the manual detail screens.
  // HealthKit is optional auto-fill, never a gate — the manual input above
  // always works. Shown only on HK-capable devices. When iOS reports the
  // prompt has not been answered, offer to connect; once answered, the app
  // can neither re-prompt nor know grant-vs-deny, so it only points the
  // user to the Apple Health app.
  function renderHealthConnectRow(category: "steps" | "calories") {
    if (!hkAvailable) return null;
    if (hkAuthorized) {
      // Already asked: iOS shows the HealthKit prompt only once per data
      // type, ever — requestHealthKitPermissions() would be a silent no-op.
      // Send the user to this app's iOS Settings page (where Health access
      // lives) via the documented Linking.openSettings() API instead.
      return (
        <TouchableOpacity
          style={ar.connectHealthRow}
          onPress={() => Linking.openSettings()}
          activeOpacity={0.7}
        >
          <Text style={ar.connectHealthLabel}>
            Want to auto-fill your {category} from Apple Health?
          </Text>
          <Text style={ar.connectHealthHint}>
            Open Settings and navigate to Apple Health to allow Pack to
            auto-fill your {category}.
          </Text>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity
        style={ar.connectHealthRow}
        onPress={handleConnectHealthKit}
        activeOpacity={0.7}
      >
        <Text style={ar.connectHealthLabel}>Connect Apple Health</Text>
        <Text style={ar.connectHealthHint}>
          Auto-fills your {category} from Apple Health when available.
        </Text>
      </TouchableOpacity>
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
          style={[
            s.sheet,
            {
              transform: [
                {
                  translateY: Animated.add(slideAnim, keyboardOffsetAnim),
                },
              ],
            },
          ]}
        >
          {/* Handle — sibling of the page track so the swipe-down gesture
              is active on every page (CHANGE 4). */}
          <View style={s.handleWrap} {...dismissPanResponder.panHandlers}>
            <View style={s.handle} />
          </View>

          {/* Header — Page 1 and Page 2 share the same row layout so the
              centered title aligns visually across pages (CHANGE 1). Page 1
              uses a 24px left spacer in place of the back chevron. */}
          {currentPage === "overview" ? (
            <View style={s.headerDetail}>
              <View style={{ width: 24 }} />
              <View style={s.headerCenter}>
                <Text style={s.header}>{activityCopy.logSheet.title}</Text>
              </View>
              <View style={{ width: 24 }} />
            </View>
          ) : (
            <View style={s.headerDetail}>
              <TouchableOpacity onPress={goToOverview}>
                <Ionicons name="chevron-back" size={24} color={C.textPrimary} />
              </TouchableOpacity>
              <Text style={s.header}>
                {currentPage === "steps" && activityCopy.logSheet.types.steps}
                {currentPage === "workout" &&
                  activityCopy.logSheet.types.workout}
                {currentPage === "calories" && "Calories"}
                {currentPage === "water" && activityCopy.logSheet.types.water}
              </Text>
              <View style={{ width: 24 }} />
            </View>
          )}

          <Animated.View
            style={[
              s.pagesTrack,
              {
                transform: [{ translateX }],
              },
            ]}
          >
            {/* PAGE 1: Overview */}
            <ScrollView
              style={s.page}
              scrollEnabled={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={s.scrollContent}
            >
              {!hookData ? (
                <RowSkeleton />
              ) : (
                <>
                  {/* Steps Row */}
                  <ActivityRow
                    label={activityCopy.logSheet.types.steps}
                    rightContent={
                      <Animated.Text
                        style={[s.rowValue, { opacity: dataOpacityAnim }]}
                      >
                        {stepsDisplay !== null
                          ? `${stepsDisplay.toLocaleString()} steps`
                          : "—"}
                      </Animated.Text>
                    }
                    showChevron
                    isExpanded={false}
                    onPress={() => goToDetail("steps")}
                  />

                  <View style={s.rowDivider} />

                  {/* Workout Row */}
                  <ActivityRow
                    label={activityCopy.logSheet.types.workout}
                    rightContent={
                      <Animated.Text
                        style={[s.valueDim, { opacity: dataOpacityAnim }]}
                      >
                        {wCount === 0 ? "None today" : `${wCount} logged today`}
                      </Animated.Text>
                    }
                    showChevron
                    isExpanded={false}
                    onPress={() => goToDetail("workout")}
                  />

                  <View style={s.rowDivider} />

                  {/* Calories Row */}
                  <ActivityRow
                    label="Calories"
                    rightContent={
                      <Animated.Text
                        style={[s.rowValue, { opacity: dataOpacityAnim }]}
                      >
                        {calDisplay !== null
                          ? `${calDisplay.toLocaleString()} cal`
                          : "—"}
                      </Animated.Text>
                    }
                    showChevron
                    isExpanded={false}
                    onPress={() => goToDetail("calories")}
                  />

                  <View style={s.rowDivider} />

                  {/* Water Row */}
                  <ActivityRow
                    label={activityCopy.logSheet.types.water}
                    rightContent={
                      <Animated.Text
                        style={[s.rowValue, { opacity: dataOpacityAnim }]}
                      >
                        {totalOz} oz
                      </Animated.Text>
                    }
                    showChevron
                    isExpanded={false}
                    onPress={() => goToDetail("water")}
                  />
                </>
              )}
            </ScrollView>

            {/* PAGE 2: Detail */}
            <ScrollView
              style={s.page}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={s.scrollContentDetail}
            >
              {/* Steps Detail */}
              {currentPage === "steps" && (
                <>
                  <View style={s.captionBlock}>
                    <HealthSourceBadge style={ar.caption} />
                    <Text style={ar.manualCaption}>
                      M = manual entry, visible to your pack
                    </Text>
                  </View>
                  <View style={ar.inputRow}>
                    <TextInput
                      style={ar.input}
                      value={rawSteps}
                      onChangeText={setRawSteps}
                      placeholder="Enter steps"
                      placeholderTextColor={C.textTertiary}
                      keyboardType="number-pad"
                      maxLength={8}
                    />
                    <TouchableOpacity
                      style={[
                        ar.addBtn,
                        (manualStepsSaving || rawSteps.length === 0) &&
                          ar.addBtnDisabled,
                      ]}
                      onPress={() => {
                        handleSaveManualSteps();
                        goToOverview();
                      }}
                      disabled={manualStepsSaving || rawSteps.length === 0}
                      activeOpacity={0.8}
                    >
                      <Text style={ar.addBtnText}>
                        {manualStepsSaving ? "…" : "Add"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {renderHealthConnectRow("steps")}

                  {(localScore?.manual_steps_count ?? 0) > 0 && (
                    <View>
                      <Text style={ar.entriesLabel}>TODAY</Text>
                      <View style={ar.entryRow}>
                        <Text style={ar.entryAmount}>
                          Manual:{" "}
                          {(
                            localScore?.manual_steps_count ?? 0
                          ).toLocaleString()}{" "}
                          steps
                        </Text>
                      </View>
                    </View>
                  )}
                </>
              )}

              {/* Workout Detail */}
              {currentPage === "workout" && (
                <>
                  <View style={qs.grid}>
                    {visibleChips.map((cat, idx) => (
                      <View key={`chip-${idx}`} style={qs.cell}>
                        <CategoryChip
                          label={CATEGORY_DISPLAY_NAMES[cat]}
                          containerStyle={qs.chipFill}
                          onPress={() => {
                            dismissHint();
                            handleLogWorkout(cat);
                            goToOverview();
                          }}
                          onLongPress={() => setChipMenuIndex(idx)}
                          disabled={workoutSaving}
                        />
                      </View>
                    ))}
                    <View style={qs.cell}>
                      <EmptyChipSlot
                        onPress={() => openSeeMore("add")}
                        containerStyle={qs.chipFill}
                      />
                    </View>
                  </View>

                  {showHint && <Text style={qs.hint}>Tap + to add more.</Text>}

                  <TouchableOpacity
                    onPress={() => openSeeMore("browse")}
                    activeOpacity={0.7}
                  >
                    <Text style={qs.seeMoreLink}>See more categories →</Text>
                  </TouchableOpacity>

                  {workoutLogs.length > 0 && (
                    <View>
                      <Text style={ar.entriesLabel}>TODAY</Text>
                      {workoutLogs.map((w, i) => (
                        <View
                          key={`${w.logged_at}-${i}`}
                          style={[
                            ar.entryRow,
                            i < workoutLogs.length - 1 && ar.entryBorder,
                          ]}
                        >
                          <Text style={ar.entryAmount}>
                            {w.entry_method === "healthkit"
                              ? "Apple Health"
                              : "Manual"}
                          </Text>
                          <Text style={ar.entryTime}>
                            {formatTime(w.logged_at)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              )}

              {/* Calories Detail */}
              {currentPage === "calories" && (
                <>
                  <View style={s.captionBlock}>
                    <HealthSourceBadge style={ar.caption} />
                    <Text style={ar.manualCaption}>
                      M = manual entry, visible to your pack
                    </Text>
                  </View>
                  <View style={ar.inputRow}>
                    <TextInput
                      style={ar.input}
                      value={rawCal}
                      onChangeText={setRawCal}
                      placeholder="Enter calories"
                      placeholderTextColor={C.textTertiary}
                      keyboardType="number-pad"
                      maxLength={8}
                    />
                    <TouchableOpacity
                      style={[
                        ar.addBtn,
                        (manualCalSaving || rawCal.length === 0) &&
                          ar.addBtnDisabled,
                      ]}
                      onPress={() => {
                        handleSaveManualCal();
                        goToOverview();
                      }}
                      disabled={manualCalSaving || rawCal.length === 0}
                      activeOpacity={0.8}
                    >
                      <Text style={ar.addBtnText}>
                        {manualCalSaving ? "…" : "Add"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {renderHealthConnectRow("calories")}

                  {(localScore?.manual_calories_count ?? 0) > 0 && (
                    <View>
                      <Text style={ar.entriesLabel}>TODAY</Text>
                      <View style={ar.entryRow}>
                        <Text style={ar.entryAmount}>
                          Manual:{" "}
                          {(
                            localScore?.manual_calories_count ?? 0
                          ).toLocaleString()}{" "}
                          cal
                        </Text>
                      </View>
                    </View>
                  )}
                </>
              )}

              {/* Water Detail */}
              {currentPage === "water" && (
                <>
                  <View style={ar.chipRow}>
                    {QUICK_AMOUNTS.map((amount) => (
                      <Animated.View
                        key={amount}
                        style={{
                          flex: 1,
                          transform: [{ scale: scaleAnims[amount] }],
                        }}
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

                  {displayedEntries.length > 0 && (
                    <View>
                      <Text style={ar.entriesLabel}>TODAY</Text>
                      {displayedEntries.map((entry, i) => (
                        <View
                          key={`${entry.logged_at}-${i}`}
                          style={[
                            ar.entryRow,
                            i < displayedEntries.length - 1 && ar.entryBorder,
                          ]}
                        >
                          <Text style={ar.entryAmount}>
                            +{entry.amount_oz} oz
                          </Text>
                          <Text style={ar.entryTime}>
                            {formatTime(entry.logged_at)}
                          </Text>
                        </View>
                      ))}
                      {moreCount > 0 && (
                        <Text style={ar.moreText}>+ {moreCount} more</Text>
                      )}
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </Animated.View>
        </Animated.View>

        {/* See More + ChipMenu render INSIDE LogSheet's Modal as siblings of
            <Animated.View>. They render on top because they come later in
            child order. Keeping them inside the Modal sidesteps iOS's
            sibling-Modal-presentation rule (a Modal can't reliably present
            on top of an already-presenting Modal). */}
        <SeeMoreCategoriesSheet
          visible={seeMoreState.open}
          entryPoint={seeMoreState.entryPoint}
          pinnedCategories={quickSelectCategories}
          userId={userId ?? null}
          onClose={() => {
            // Closing the sheet (backdrop tap) also clears any pending swap
            setPendingSwapCategory(null);
            closeSeeMore();
          }}
          pendingSwapCategory={pendingSwapCategory}
          onSwapModeReplace={handleSwapModeReplace}
          onSwapCancel={handleSwapCancel}
          onSelect={(cat) => {
            const ep = seeMoreState.entryPoint;
            const idx = seeMoreState.replaceTargetIndex;
            // For "add" with a full Quick Select, route into swap mode and
            // KEEP the sheet open so the user picks which pin to swap.
            // All other paths (add-with-room, replace, browse) close and
            // act as before.
            if (
              ep === "add" &&
              quickSelectCategories.length >= QUICK_SELECT_MAX &&
              !quickSelectCategories.includes(cat)
            ) {
              handlePinCategory(cat);
              return;
            }
            closeSeeMore();
            if (ep === "add") {
              handlePinCategory(cat);
            } else if (ep === "replace" && typeof idx === "number") {
              handleReplaceCategory(idx, cat);
            } else if (ep === "browse") {
              handleLogWorkout(cat);
            }
          }}
        />

        {/* Chip long-press menu — Replace / Remove. Inline overlay; not a
            separate Modal. Tapping outside dismisses via the backdrop
            Pressable's onPress. */}
        {chipMenuIndex !== null && (
          <Pressable style={cm.overlay} onPress={() => setChipMenuIndex(null)}>
            <Pressable style={cm.sheet}>
              <View style={cm.handle} />
              <TouchableOpacity
                style={cm.row}
                activeOpacity={0.7}
                onPress={() => {
                  const idx = chipMenuIndex;
                  setChipMenuIndex(null);
                  if (idx !== null) openSeeMore("replace", idx);
                }}
              >
                <Ionicons
                  name="swap-horizontal-outline"
                  size={18}
                  color="#FFFFFF"
                />
                <Text style={cm.rowText}>Replace</Text>
              </TouchableOpacity>
              <View style={cm.divider} />
              <TouchableOpacity
                style={cm.row}
                activeOpacity={0.7}
                onPress={() => {
                  const idx = chipMenuIndex;
                  setChipMenuIndex(null);
                  if (idx !== null) handleRemoveCategory(idx);
                }}
              >
                <Ionicons name="trash-outline" size={18} color="#F87171" />
                <Text style={[cm.rowText, cm.rowTextDestructive]}>Remove</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        )}
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
    height: 420,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  scrollContentDetail: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  captionBlock: {
    marginTop: 12,
    marginBottom: 12,
  },
  pagesTrack: {
    flexDirection: "row",
    width: "200%",
  },
  page: {
    width: "50%",
  },
  headerDetail: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 0,
  },
  handleWrap: { alignItems: "center", paddingTop: 14, paddingBottom: 10 },
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
  },
  headerCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  // Pass 25: dropped the boxed-card wrapper. Rows render directly on the
  // sheet's C.surface background with hairline dividers between them — the
  // dividers carry structural rhythm in absence of the card. The divider's
  // marginHorizontal: 16 mirrors ar.header's paddingHorizontal so the
  // divider visually aligns with row-content edges.
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginHorizontal: 16,
  },
  // Row right-side value styles. Pass 25: rowValue bumped to primary white
  // for load-bearing data (today's count). Pass 25-followup-B: rowToday
  // softens the trailing "today" suffix; rowCheck + valueSuccess removed
  // (achievement icons gone with target removal).
  rowValue: {
    fontSize: 18,
    fontWeight: "700",
    color: C.textPrimary,
  },
  rowToday: {
    fontSize: 12,
    color: C.textSecondary,
  },
  rowCaption: {
    fontSize: 11,
    color: C.textTertiary,
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
});

// Quick Select grid styles — 2 rows × 3 cols, 8pt gaps. Each cell is a
// fixed share of the row so all 6 chips render identical dimensions
// regardless of label length. 30% × 3 = 90% leaves 10% for the 2
// inter-cell gaps and a small slack — fits comfortably on iPhone SE
// (256pt content width inside card+row padding) through Pro Max.
const qs = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  cell: {
    width: "30%",
    flexGrow: 1,
  },
  // Pass 25-followup-C-fix-2: passed as CategoryChip/EmptyChipSlot's
  // containerStyle. Chip wrapper stretches to fill the cell so all chips
  // in a wrap-row share the row's height (set by the tallest chip).
  chipFill: {
    flex: 1,
  },
  hint: {
    fontSize: 12,
    color: C.textTertiary,
    marginTop: 4,
  },
  seeMoreLink: {
    fontSize: 13,
    fontWeight: "600",
    color: C.accent,
    marginTop: 4,
    marginBottom: 4,
  },
});

// ChipMenu styles — small bottom sheet that pops up on chip long-press.
// Inline overlay (no nested Modal); absolute fill positions over the
// LogSheet content.
const cm = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#1C1C1E",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#3A3A3C",
    alignSelf: "center",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 10,
  },
  rowText: {
    fontSize: 16,
    color: "#FFFFFF",
  },
  rowTextDestructive: {
    color: "#F87171",
  },
  divider: {
    height: 1,
    backgroundColor: "#2C2C2E",
  },
});
