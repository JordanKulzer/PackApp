import React, { useState, useEffect, useCallback } from "react";
import {
  Alert,
  Animated,
  Easing,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Share,
  ActivityIndicator,
  FlatList,
  LayoutAnimation,
  Modal,
  Platform,
  UIManager,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthStore } from "../../../src/stores/authStore";
import { usePack } from "../../../src/hooks/usePack";
import { usePackHistory } from "../../../src/hooks/usePackHistory";
import { useIsPro } from "../../../src/hooks/useIsPro";
import {
  FREE_MEMBER_LIMIT,
  PRO_MEMBER_LIMIT,
} from "../../../src/lib/revenuecat";
import { analytics } from "../../../src/lib/analytics";
import {
  useActivityFeed,
  FeedItem,
  ReactionType,
} from "../../../src/hooks/useActivityFeed";
import { useHealthKit } from "../../../src/hooks/useHealthKit";
import { supabase } from "../../../src/lib/supabase";
import { formatName } from "../../../src/lib/displayName";
import { POINTS, getStreakMultiplier } from "../../../src/lib/scoring";
import {
  buildGapLine,
  gainConsequenceText,
  rankWithTiebreakers,
  TiebreakerReason,
} from "../../../src/lib/competitionCopy";
import { useScoreStore } from "../../../src/stores/scoreStore";
import type { Pack, Run } from "../../../src/types/database";
import { colors } from "../../../src/theme/colors";
import { PackMemberDisplay } from "../../../src/components/PackMemberDisplay";
import { getSignedUrl, deletePhoto, reportPhoto } from "../../../src/lib/photoUpload";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Colors
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
  danger: "#F85149",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface MemberScore {
  user_id: string;
  display_name: string;
  // weekly_points: total accumulated this run — used for ranking + primary display
  weekly_points: number;
  // total_points: today's daily score only — used for "+X pts today" and daily bar
  total_points: number;
  streak_days: number;
  updated_at: string | null;
  steps_achieved: boolean;
  workout_achieved: boolean;
  calories_achieved: boolean;
  water_achieved: boolean;
  steps_count: number;
  calories_count: number;
  water_oz_count: number;
  workout_count: number;
  has_manual_steps: boolean;
  has_manual_calories: boolean;
}

interface WeeklyEntry {
  user_id: string;
  display_name: string;
  weekly_points: number;
}

interface PastWinner {
  run_id: string;
  week_label: string;
  winner_name: string | null;
}

type ScoreRow = {
  user_id: string;
  total_points: number;
  streak_days: number;
  updated_at: string | null;
  steps_achieved: boolean;
  workout_achieved: boolean;
  calories_achieved: boolean;
  water_achieved: boolean;
  steps_count: number;
  calories_count: number;
  water_oz_count: number;
  workout_count: number;
  has_manual_steps: boolean;
  has_manual_calories: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function maxPossiblePoints(pack: Pack): number {
  let pts = 0;
  if (pack.steps_enabled) pts += 10;
  if (pack.workouts_enabled) pts += 15;
  if (pack.calories_enabled) pts += 10;
  if (pack.water_enabled) pts += 8;
  return pts;
}

function toPercent(score: MemberScore, pack: Pack): number {
  const max = maxPossiblePoints(pack);
  if (max === 0) return 0;
  return Math.min(100, Math.round((score.total_points / max) * 100));
}

function mapRows(
  data: ScoreRow[],
  nameMap: Record<string, string>,
  weeklyTotals: Record<string, number>,
): MemberScore[] {
  return data.map((row) => ({
    user_id: row.user_id,
    display_name: nameMap[row.user_id] ?? "",
    weekly_points: weeklyTotals[row.user_id] ?? row.total_points,
    total_points: row.total_points, // today's daily score only
    streak_days: row.streak_days,
    updated_at: row.updated_at,
    steps_achieved: row.steps_achieved,
    workout_achieved: row.workout_achieved,
    calories_achieved: row.calories_achieved,
    water_achieved: row.water_achieved,
    steps_count: row.steps_count ?? 0,
    calories_count: row.calories_count ?? 0,
    water_oz_count: row.water_oz_count ?? 0,
    workout_count: row.workout_count ?? 0,
    has_manual_steps: row.has_manual_steps ?? false,
    has_manual_calories: row.has_manual_calories ?? false,
  }));
}

// No user join — display names are fetched in a separate explicit query
const SCORE_SELECT =
  "user_id, total_points, streak_days, updated_at, steps_achieved, workout_achieved, calories_achieved, water_achieved, steps_count, calories_count, water_oz_count, workout_count, has_manual_steps, has_manual_calories";

// ─────────────────────────────────────────────────────────────────────────────
// Manual badge
// ─────────────────────────────────────────────────────────────────────────────

function ManualBadge() {
  return (
    <View style={mbS.pill}>
      <Text style={mbS.text}>M</Text>
    </View>
  );
}

const mbS = StyleSheet.create({
  pill: {
    backgroundColor: "#1C2333",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 0.5,
    borderColor: "#30363D",
    alignSelf: "center",
  },
  text: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8B949E",
    letterSpacing: 0.3,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Progress Row (dark)
// ─────────────────────────────────────────────────────────────────────────────

function ProgressRow({
  label,
  achieved,
  current,
  target,
  unit = "",
  isManual = false,
}: {
  label: string;
  achieved: boolean;
  current: number;
  target: number;
  unit?: string;
  isManual?: boolean;
}) {
  const fillPct = target > 0 ? Math.min(1, current / target) : 0;
  const fillColor = achieved ? C.success : C.accent;
  const widthPct = `${Math.round(fillPct * 100)}%` as `${number}%`;
  const overTarget = achieved && current > target;

  return (
    <View style={barS.row}>
      <Text style={barS.label}>{label}</Text>
      <View style={barS.track}>
        <View
          style={[barS.fill, { width: widthPct, backgroundColor: fillColor }]}
        />
      </View>
      <View style={barS.fracBlock}>
        <View style={barS.fracRow}>
          <Text
            style={[barS.frac, achieved && { color: C.success }]}
            numberOfLines={1}
          >
            {achieved
              ? `${current.toLocaleString()}${unit} ✓`
              : `${current.toLocaleString()}${unit} / ${target.toLocaleString()}${unit}`}
          </Text>
          {isManual && <ManualBadge />}
        </View>
        {overTarget && (
          <Text style={barS.overflow}>
            goal: {target.toLocaleString()}
            {unit}
          </Text>
        )}
      </View>
    </View>
  );
}

const barS = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 30 },
  label: { width: 72, fontSize: 13, color: C.textSecondary, fontWeight: "500" },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: C.border,
    borderRadius: 3,
    overflow: "hidden",
  },
  fill: { height: 6, borderRadius: 3 },
  fracBlock: { width: 88, alignItems: "flex-end", gap: 1 },
  fracRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    justifyContent: "flex-end",
  },
  frac: { fontSize: 12, color: C.textSecondary, textAlign: "right" },
  overflow: { fontSize: 10, color: C.textTertiary, textAlign: "right" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Today section — competitive consequence copy
// ─────────────────────────────────────────────────────────────────────────────

type ActivitySlot = {
  label: string;
  actionPhrase: string; // verb phrase for use in action hint sentences
  base: number;
  enabled: boolean;
  achieved: boolean;
};

// Effort order: water → steps → workout → calories (lowest to highest effort).
// actionPhrase is a concrete verb phrase that reads naturally in a sentence.
function buildActivitySlots(
  pack: Pack,
  myScore: MemberScore | null,
): ActivitySlot[] {
  const stepsLeft = Math.max(
    0,
    (pack.step_target ?? 10000) - (myScore?.steps_count ?? 0),
  );
  const stepsPhrase =
    stepsLeft > 0
      ? `Walk ${stepsLeft.toLocaleString()} more steps`
      : "Hit your steps goal";

  return [
    {
      label: "Water",
      actionPhrase: "Log your water",
      base: POINTS.water,
      enabled: pack.water_enabled,
      achieved: myScore?.water_achieved ?? false,
    },
    {
      label: "Steps",
      actionPhrase: stepsPhrase,
      base: POINTS.steps,
      enabled: pack.steps_enabled,
      achieved: myScore?.steps_achieved ?? false,
    },
    {
      label: "Workout",
      actionPhrase: "Log a workout",
      base: POINTS.workout,
      enabled: pack.workouts_enabled,
      achieved: myScore?.workout_achieved ?? false,
    },
    {
      label: "Calories",
      actionPhrase: "Hit your calorie goal",
      base: POINTS.calories,
      enabled: pack.calories_enabled,
      achieved: myScore?.calories_achieved ?? false,
    },
  ];
}

type TodaySection = {
  status: string;
  secondary: string | null;
  action: string;
  actionVariant: "success" | "action" | "info";
};

// Returns all three lines of Today copy driven by live competition context.
// Adapts to: leading / behind / tied / alone / no points yet / all done.
function buildTodaySection(
  pack: Pack,
  myScore: MemberScore | null,
  ranked: MemberScore[],
  userId: string | undefined,
): TodaySection {
  const myIndex = ranked.findIndex((s) => s.user_id === userId);
  const myRank = myIndex + 1;
  const personAhead = myIndex > 0 ? ranked[myIndex - 1] : null;
  const isAlone = ranked.length <= 1;

  const todayPts = myScore?.total_points ?? 0;
  const weeklyPts = myScore?.weekly_points ?? 0;
  const hasPointsToday = todayPts > 0;
  const multiplier = getStreakMultiplier(myScore?.streak_days ?? 0);

  const slots = buildActivitySlots(pack, myScore);
  const enabled = slots.filter((a) => a.enabled);
  const incomplete = enabled.filter((a) => !a.achieved);
  const totalGainRemaining = incomplete.reduce(
    (sum, a) => sum + Math.round(a.base * multiplier),
    0,
  );

  // ── Status line (rank headline) — with tie detection ─────────────────
  let status: string;
  if (isAlone) {
    status = "You're ranked #1 · No rivals yet";
  } else if (myRank === 1) {
    const lead = weeklyPts - ranked[1].weekly_points;
    status = lead === 0 ? "Tied for #1" : "You're leading";
  } else {
    status = `You're ranked #${myRank} of ${ranked.length}`;
  }

  // ── Secondary line — gap + today context (shared helper, tie-aware) ──
  const secondary = buildGapLine(ranked, userId, todayPts);

  // ── No goals configured ───────────────────────────────────────────────
  if (enabled.length === 0) {
    return {
      status,
      secondary,
      action: "No tracked activities configured",
      actionVariant: "info",
    };
  }

  // ── All goals done ────────────────────────────────────────────────────
  if (incomplete.length === 0) {
    if (isAlone) {
      return {
        status,
        secondary,
        action: "All goals hit today — keep the streak",
        actionVariant: "success",
      };
    }
    if (!personAhead) {
      return {
        status,
        secondary,
        action: "All goals hit today — lead is safe",
        actionVariant: "success",
      };
    }
    return {
      status,
      secondary,
      action: "All goals hit today — keep the streak",
      actionVariant: "success",
    };
  }

  const best = incomplete[0];
  const bestGain = Math.round(best.base * multiplier);

  // ── Alone in pack ─────────────────────────────────────────────────────
  if (isAlone) {
    return {
      status,
      secondary,
      action: hasPointsToday
        ? `${best.actionPhrase} for +${bestGain} pts`
        : `${best.actionPhrase} to get on the board`,
      actionVariant: "action",
    };
  }

  // ── Leading ───────────────────────────────────────────────────────────
  if (!personAhead) {
    const lead = weeklyPts - (ranked[1]?.weekly_points ?? 0);
    if (!hasPointsToday) {
      return {
        status,
        secondary,
        action: `${best.actionPhrase} to lead by +${lead + bestGain} pts`,
        actionVariant: "action",
      };
    }
    return {
      status,
      secondary,
      action:
        incomplete.length === 1
          ? `${best.actionPhrase} to lock in today's lead`
          : `${best.actionPhrase} to lead by +${lead + bestGain} pts`,
      actionVariant: "action",
    };
  }

  // ── Behind (or tied — any gain breaks the tie and advances rank) ──────
  const gapToAhead = personAhead.weekly_points - weeklyPts;
  const gapToFirst = ranked[0].weekly_points - weeklyPts;
  const opponentName = formatName(personAhead.display_name, myRank - 1);

  if (!hasPointsToday) {
    const consequence = gainConsequenceText(
      bestGain,
      gapToAhead,
      gapToFirst,
      opponentName,
      best.actionPhrase,
    );
    if (consequence) {
      return {
        status,
        secondary,
        action: consequence,
        actionVariant: "action",
      };
    }
    return {
      status,
      secondary,
      action: `${best.actionPhrase} for +${bestGain} pts today`,
      actionVariant: "action",
    };
  }

  // Has points today — find the single activity that meaningfully closes a gap
  for (const activity of incomplete) {
    const gain = Math.round(activity.base * multiplier);
    const consequence = gainConsequenceText(
      gain,
      gapToAhead,
      gapToFirst,
      opponentName,
      activity.actionPhrase,
    );
    if (consequence) {
      return {
        status,
        secondary,
        action: consequence,
        actionVariant: "action",
      };
    }
  }

  // Check if completing all remaining goals closes or exceeds a gap
  const allConsequence = gainConsequenceText(
    totalGainRemaining,
    gapToAhead,
    gapToFirst,
    opponentName,
    `Complete all ${incomplete.length} remaining goals`,
  );
  if (allConsequence) {
    return {
      status,
      secondary,
      action: allConsequence,
      actionVariant: "action",
    };
  }

  // Can't close any gap today — grind message
  return {
    status,
    secondary,
    action: `${best.actionPhrase} for +${bestGain} pts`,
    actionVariant: "action",
  };
}

function DailySection({
  ranked,
  userId,
  pack,
  isSyncing,
}: {
  ranked: MemberScore[];
  userId: string | undefined;
  pack: Pack;
  isSyncing: boolean;
}) {
  const { status, secondary, action, actionVariant } = buildTodaySection(
    pack,
    ranked.find((s) => s.user_id === userId) ?? null,
    ranked,
    userId,
  );

  return (
    <View style={dsS.container}>
      {/* Section label */}
      <View style={dsS.labelRow}>
        <Text style={dsS.sectionLabel}>TODAY</Text>
        {isSyncing && <ActivityIndicator size="small" color={C.textTertiary} />}
      </View>

      {/* Status headline */}
      <Text style={dsS.statusText}>{status}</Text>

      {/* Gap + today context */}
      {secondary !== null && <Text style={dsS.secondaryText}>{secondary}</Text>}

      {/* Next action */}
      <Text
        style={[
          dsS.actionText,
          actionVariant === "success" && dsS.actionSuccess,
          actionVariant === "info" && dsS.actionInfo,
        ]}
      >
        {action}
      </Text>
    </View>
  );
}

const dsS = StyleSheet.create({
  // Compact, utility feel — clearly distinct from the prominent weekly rings above
  container: {
    backgroundColor: C.surface,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textTertiary,
    letterSpacing: 1.0,
  },
  statusText: {
    fontSize: 18,
    fontWeight: "700",
    color: C.textPrimary,
  },
  secondaryText: {
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 2,
  },
  actionText: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
  },
  actionSuccess: {
    color: C.success,
  },
  actionInfo: {
    color: C.textTertiary,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Animated bar — only rendered for the current user's row
// ─────────────────────────────────────────────────────────────────────────────

function AnimatedSelfBar({ pct, color }: { pct: number; color: string }) {
  const animPct = React.useRef(new Animated.Value(pct)).current;

  React.useEffect(() => {
    Animated.timing(animPct, {
      toValue: pct,
      duration: 350,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // width% interpolation requires JS thread
    }).start();
  }, [pct]); // eslint-disable-line react-hooks/exhaustive-deps

  const widthPct = animPct.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={lrS.barTrackSelf}>
      <Animated.View
        style={[lrS.barFillSelf, { width: widthPct, backgroundColor: color }]}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Completion Ring — shown in expanded row header only
// ─────────────────────────────────────────────────────────────────────────────

function CompletionRing({ pct }: { pct: number }) {
  const size = 44;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - Math.min(1, pct / 100) * circumference;
  const color = pct >= 100 ? C.success : C.accent;

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
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        )}
      </Svg>
      <Text
        style={{
          fontSize: 11,
          fontWeight: "700",
          color: pct >= 100 ? C.success : C.textTertiary,
        }}
      >
        {pct}%
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — Leaderboard List Row
// ─────────────────────────────────────────────────────────────────────────────

// Returns the streak signal to show beneath a member's name — only when meaningful.
// Goals count is already shown in the pts block; streak is the only extra signal worth surfacing.
function rowSignal(score: MemberScore): { text: string; color: string } {
  if (score.streak_days >= 2) {
    return {
      text: `🔥 ${score.streak_days}`,
      color: score.streak_days >= 5 ? C.success : C.textSecondary,
    };
  }
  return { text: "", color: C.textTertiary };
}

function LeaderboardListRow({
  score,
  rank,
  pack,
  isCurrentUser,
  isExpanded,
  onToggle,
  isTied = false,
  tieCaption = null,
}: {
  score: MemberScore;
  rank: number;
  pack: Pack;
  isCurrentUser: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  isTied?: boolean;
  tieCaption?: string | null;
}) {
  const pct = toPercent(score, pack);
  const displayName = formatName(score.display_name, rank);
  const signal = rowSignal(score);

  const enabledCount = [
    pack.steps_enabled,
    pack.workouts_enabled,
    pack.calories_enabled,
    pack.water_enabled,
  ].filter(Boolean).length;
  const doneCount = [
    pack.steps_enabled && score.steps_achieved,
    pack.workouts_enabled && score.workout_achieved,
    pack.calories_enabled && score.calories_achieved,
    pack.water_enabled && score.water_achieved,
  ].filter(Boolean).length;
  const completionPct =
    enabledCount === 0 ? 0 : Math.round((doneCount / enabledCount) * 100);
  const barFillColor =
    completionPct === 0
      ? "#374151"
      : completionPct === 100
        ? "#22C55E"
        : colors.accent;

  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      style={[lrS.row, isCurrentUser && lrS.rowSelf]}
    >
      {/* Main info row */}
      <View style={lrS.mainRow}>
        <View style={lrS.rankBlock}>
          <Text style={lrS.rank}>#{rank}</Text>
          {isTied && (
            <View style={lrS.tiedPill}>
              <Text style={lrS.tiedPillText}>Tied</Text>
            </View>
          )}
        </View>
        <View style={lrS.nameBlock}>
          <Text
            style={[lrS.name, isCurrentUser && lrS.nameSelf]}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          {tieCaption && (
            <Text style={lrS.tiebreakerCaption}>{tieCaption}</Text>
          )}
          {score.total_points > 0 && (
            <Text style={lrS.todaySubtext}>
              Today: +{score.total_points} pts
            </Text>
          )}
        </View>
        <View style={lrS.ptsBlock}>
          <Text style={lrS.pts}>{score.weekly_points} pts</Text>
          {enabledCount > 0 && (
            <Text style={lrS.goalsFrac}>
              {doneCount}/{enabledCount} goals
            </Text>
          )}
        </View>
      </View>

      {/* Secondary signal — sits below name block, above bar */}
      {signal.text !== "" && (
        <Text style={[lrS.signal, { color: signal.color }]}>{signal.text}</Text>
      )}

      {/* Progress bar — goal completion percentage */}
      {isCurrentUser ? (
        <AnimatedSelfBar pct={completionPct} color={barFillColor} />
      ) : (
        <View style={lrS.barTrack}>
          <View
            style={[
              lrS.barFill,
              {
                width: `${completionPct}%` as `${number}%`,
                backgroundColor: barFillColor,
              },
            ]}
          />
        </View>
      )}

      {/* Expanded detail — per-activity progress bars only */}
      {isExpanded && (
        <View style={lrS.expandedDetail}>
          {pack.steps_enabled && (
            <ProgressRow
              label="Steps"
              achieved={score.steps_achieved}
              current={score.steps_count}
              target={pack.step_target}
              isManual={score.has_manual_steps}
            />
          )}
          {pack.workouts_enabled && (
            <ProgressRow
              label="Workouts"
              achieved={score.workout_achieved}
              current={score.workout_count}
              target={1}
            />
          )}
          {pack.calories_enabled && (
            <ProgressRow
              label="Calories"
              achieved={score.calories_achieved}
              current={score.calories_count}
              target={pack.calorie_target}
              isManual={score.has_manual_calories}
            />
          )}
          {pack.water_enabled && (
            <ProgressRow
              label="Water"
              achieved={score.water_achieved}
              current={score.water_oz_count}
              target={pack.water_target_oz}
              unit=" oz"
            />
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const lrS = StyleSheet.create({
  row: {
    backgroundColor: C.surface,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  rowSelf: {
    backgroundColor: C.surfaceRaised,
    borderLeftWidth: 2,
    borderLeftColor: C.accent,
    paddingLeft: 14,
  },
  mainRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  rankBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    width: 28,
  },
  rank: {
    fontSize: 13,
    color: C.textTertiary,
  },
  tiedPill: {
    backgroundColor: C.surfaceRaised,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  tiedPillText: {
    fontSize: 9,
    fontWeight: "700",
    color: C.textTertiary,
    letterSpacing: 0.3,
  },
  tiebreakerCaption: {
    fontSize: 10,
    color: C.textTertiary,
    fontWeight: "500",
  },
  nameBlock: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  nameSelf: {
    color: C.accent,
  },
  todaySubtext: {
    fontSize: 11,
    color: C.textTertiary,
    fontWeight: "500",
  },
  pts: {
    fontSize: 15,
    fontWeight: "700",
    color: C.textPrimary,
  },
  signal: {
    fontSize: 12,
    marginLeft: 28,
    marginBottom: 7,
  },
  barTrack: {
    height: 3,
    backgroundColor: "#1F2937",
    borderRadius: 2,
    marginTop: 4,
    overflow: "hidden",
  },
  barFill: {
    height: 3,
    borderRadius: 2,
  },
  ptsBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  goalsFrac: {
    fontSize: 11,
    color: "#6B7280",
  },
  barTrackSelf: {
    width: "100%",
    height: 3,
    backgroundColor: "#1F2937",
    borderRadius: 2,
    marginTop: 4,
    overflow: "hidden",
  },
  barFillSelf: {
    height: 3,
    borderRadius: 2,
  },
  expandedDetail: {
    marginTop: 12,
    gap: 2,
  },
  ringHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 10,
    marginBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  ringMeta: {
    gap: 3,
  },
  ringMetaLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: C.textTertiary,
    letterSpacing: 0.8,
  },
  ringMetaValue: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textSecondary,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Your Stats (dark)
// ─────────────────────────────────────────────────────────────────────────────

function YourStatsSection({
  score,
  pack,
}: {
  score: MemberScore | null;
  pack: Pack;
}) {
  const totalPts = score?.total_points ?? 0;
  const maxPts = maxPossiblePoints(pack);
  const streak = score?.streak_days ?? 0;

  return (
    <View style={ysS.section}>
      <View style={ysS.topRow}>
        <Text style={ysS.sectionLabel}>YOUR STATS</Text>
        <View style={ysS.meta}>
          <Text style={ysS.pts}>
            {totalPts} / {maxPts} pts
          </Text>
          {streak > 0 && <Text style={ysS.streak}>🔥 {streak}</Text>}
        </View>
      </View>
      <View style={ysS.bars}>
        {pack.steps_enabled && (
          <ProgressRow
            label="Steps"
            achieved={score?.steps_achieved ?? false}
            current={score?.steps_count ?? 0}
            target={pack.step_target}
          />
        )}
        {pack.workouts_enabled && (
          <ProgressRow
            label="Workouts"
            achieved={score?.workout_achieved ?? false}
            current={score?.workout_count ?? 0}
            target={1}
          />
        )}
        {pack.calories_enabled && (
          <ProgressRow
            label="Calories"
            achieved={score?.calories_achieved ?? false}
            current={score?.calories_count ?? 0}
            target={pack.calorie_target}
          />
        )}
        {pack.water_enabled && (
          <ProgressRow
            label="Water"
            achieved={score?.water_achieved ?? false}
            current={score?.water_oz_count ?? 0}
            target={pack.water_target_oz}
            unit=" oz"
          />
        )}
      </View>
    </View>
  );
}

const ysS = StyleSheet.create({
  section: {
    backgroundColor: C.surface,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textTertiary,
    letterSpacing: 0.8,
  },
  meta: { flexDirection: "row", alignItems: "center", gap: 8 },
  pts: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  streak: { fontSize: 13, fontWeight: "600" },
  bars: { gap: 2 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty Members State (dark)
// ─────────────────────────────────────────────────────────────────────────────

function EmptyMembers({ onInvite }: { onInvite: () => void }) {
  return (
    <View style={emS.container}>
      <Ionicons name="person-add-outline" size={48} color={C.textTertiary} />
      <Text style={emS.title}>No one else is in this pack yet.</Text>
      <Text style={emS.sub}>Invite friends to start competing.</Text>
      <TouchableOpacity style={emS.button} onPress={onInvite}>
        <Text style={emS.buttonText}>Invite Friends</Text>
      </TouchableOpacity>
    </View>
  );
}

const emS = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: C.textPrimary,
    marginTop: 8,
    textAlign: "center",
  },
  sub: { fontSize: 14, color: C.textSecondary, textAlign: "center" },
  button: {
    marginTop: 8,
    backgroundColor: C.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Ring Leaderboard — weekly totals podium shown at top of pack screen
// ─────────────────────────────────────────────────────────────────────────────

// ── Weekly max helpers ───────────────────────────────────────────────────────
// The weekly max is the sum of each enabled goal's BASE daily point value
// multiplied by the number of calendar days in the active run.
// Streak bonuses are intentionally excluded from the denominator — rings
// represent base-rate progress. A user with a long streak can exceed the
// expected max (ring caps at 100%), which correctly signals exceptional effort.

function runLengthDays(run: Run): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.max(
    1,
    Math.round(
      (new Date(run.end_date).getTime() - new Date(run.start_date).getTime()) /
        msPerDay,
    ),
  );
}

// Returns which calendar day of the run we're currently on (1-indexed, clamped).
function currentDayOf(run: Run): { day: number; total: number } {
  const msPerDay = 1000 * 60 * 60 * 24;
  const elapsed = Math.floor(
    (Date.now() - new Date(run.start_date).getTime()) / msPerDay,
  );
  const total = runLengthDays(run);
  return { day: Math.min(Math.max(1, elapsed + 1), total), total };
}

function maxRunPoints(pack: Pack, run: Run): number {
  // maxPossiblePoints(pack) gives the base-rate daily ceiling
  return maxPossiblePoints(pack) * runLengthDays(run);
}

// Returns 0–100: the user's actual weekly progress toward the real run ceiling.
// Does NOT normalize relative to other players. Ring fills because the user
// progresses, not because someone else falls behind.
function weeklyRingAbsolutePct(
  weeklyPoints: number,
  pack: Pack,
  run: Run,
): number {
  const max = maxRunPoints(pack, run);
  if (max === 0) return 0; // no goals enabled — stable zero, not divide-by-zero
  return Math.min(100, Math.round((weeklyPoints / max) * 100));
}


const STRIP_SIZE_HEADER = 48;
const STRIP_SW_HEADER = 4;

function RingLeaderboard({
  entries,
  pack,
  activeRun,
  currentUserId,
}: {
  entries: WeeklyEntry[];
  pack: Pack;
  activeRun: Run;
  currentUserId: string | undefined;
}) {
  const animRefs = React.useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]);

  // Animate rings whenever entries update (initial load or after any log/sync)
  useEffect(() => {
    const top3 = entries.slice(0, 3);
    if (top3.length === 0) return;

    Animated.parallel(
      top3.map((entry, i) =>
        Animated.timing(animRefs.current[i], {
          toValue: weeklyRingAbsolutePct(entry.weekly_points, pack, activeRun),
          duration: 700,
          delay: i * 80,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ),
    ).start();
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3); // ranks 4+

  // Only skip render when hook hasn't resolved yet (no member data at all)
  if (top3.length === 0) return null;

  const layoutMode: "solo" | "duo" | "trio" =
    top3.length === 1 ? "solo" : top3.length === 2 ? "duo" : "trio";

  const SIZE_LEADER = 104;
  const SIZE_FLANK = 74;
  const SW_LEADER = 8;
  const SW_FLANK = 5;

  const leaderId = entries[0]?.user_id;

  // Not a React component — no hooks. Returns JSX for one ring slot.
  function ringSlot(
    entry: WeeklyEntry,
    rank: number,
    animIdx: number,
    size: number,
    sw: number,
    slotOpacity = 1,
    elevated = false,
  ) {
    const isFirst = rank === 1;
    const pct = weeklyRingAbsolutePct(entry.weekly_points, pack, activeRun);
    const nameDisplay = formatName(entry.display_name, rank);

    return (
      <View
        key={entry.user_id}
        style={[
          rlS.podiumSlot,
          { width: size + 12, opacity: slotOpacity },
          elevated && rlS.podiumSlotElevated,
        ]}
      >
        <PackMemberDisplay
          userId={entry.user_id}
          displayName={nameDisplay}
          progressPct={pct}
          rank={rank}
          currentUserId={currentUserId}
          leaderId={leaderId}
          size={size}
          strokeWidth={sw}
          animValue={animRefs.current[animIdx]}
        />

        {/* Weekly point total — below ring/badge/name from PackMemberDisplay */}
        <Text style={[rlS.ringPts, isFirst && rlS.ringPtsFirst]}>
          {`${entry.weekly_points} pts`}
        </Text>
      </View>
    );
  }

  return (
    <View style={rlS.container}>
      <Text style={rlS.sectionLabel}>THIS WEEK</Text>

      {/* 1 member: single centered ring */}
      {layoutMode === "solo" && (
        <View style={{ alignItems: "center" }}>
          {ringSlot(top3[0], 1, 0, SIZE_LEADER, SW_LEADER, 1, false)}
        </View>
      )}

      {/* 2 members: [#2 smaller] [#1 elevated] — matches trio/home rule: left=#2, center=#1 */}
      {layoutMode === "duo" && (
        <View style={rlS.podiumRow}>
          {ringSlot(top3[1], 2, 1, SIZE_FLANK, SW_FLANK, 0.88, false)}
          {ringSlot(top3[0], 1, 0, SIZE_LEADER, SW_LEADER, 1, true)}
        </View>
      )}

      {/* 3+ members: [#2] [#1 elevated] [#3] */}
      {layoutMode === "trio" && (
        <View style={rlS.podiumRow}>
          {ringSlot(top3[1], 2, 1, SIZE_FLANK, SW_FLANK, 0.88, false)}
          {ringSlot(top3[0], 1, 0, SIZE_LEADER, SW_LEADER, 1, true)}
          {ringSlot(top3[2], 3, 2, SIZE_FLANK, SW_FLANK, 0.76, false)}
        </View>
      )}

      {/* Strip: ranks 4+ — scrollable horizontal row */}
      {rest.length > 0 && (
        <View style={rlS.stripWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={rlS.stripScroll}
          >
            {rest.map((entry, i) => {
              const rank = i + 4;
              const pct = weeklyRingAbsolutePct(entry.weekly_points, pack, activeRun);
              const nameDisplay = formatName(entry.display_name, rank);
              return (
                <View key={entry.user_id} style={rlS.stripItem}>
                  <PackMemberDisplay
                    userId={entry.user_id}
                    displayName={nameDisplay}
                    progressPct={pct}
                    rank={rank}
                    currentUserId={currentUserId}
                    leaderId={leaderId}
                    size={STRIP_SIZE_HEADER}
                    strokeWidth={STRIP_SW_HEADER}
                    showName={false}
                  />
                  <Text style={rlS.stripRank}>#{rank}</Text>
                  <Text style={rlS.stripPts}>{entry.weekly_points} pts</Text>
                </View>
              );
            })}
          </ScrollView>
          {/* Fade at right edge signals scrollability */}
          <View style={rlS.stripFade} pointerEvents="none" />
        </View>
      )}

      {/* Time context: anchors the weekly rings to the competition window */}
      {(() => {
        const { day, total } = currentDayOf(activeRun);
        const leaderPts = top3[0].weekly_points;
        return (
          <Text style={rlS.dayContext}>
            {leaderPts > 0 ? `${leaderPts} pts lead  ·  ` : ""}
            {"Day "}
            {day}
            {" of "}
            {total}
          </Text>
        );
      })()}
    </View>
  );
}

const rlS = StyleSheet.create({
  container: {
    backgroundColor: C.bg,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textSecondary,
    letterSpacing: 1.0,
    marginBottom: 24,
    textAlign: "center",
  },
  podiumRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 16,
  },
  podiumSlot: {
    alignItems: "center",
    gap: 7,
  },
  podiumSlotElevated: {
    marginBottom: 22,
  },
  rankBadge: {
    backgroundColor: C.surfaceRaised,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  rankBadgeFirst: {
    backgroundColor: colors.leaderBg,
    borderColor: colors.leaderBorder,
  },
  rankBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textSecondary,
  },
  rankBadgeTextFirst: {
    color: colors.leader,
  },
  ringInitial: {
    fontWeight: "700",
    color: C.textPrimary,
  },
  ringNameFirst: {
    fontSize: 13,
    fontWeight: "700",
    color: C.textPrimary,
    maxWidth: 116,
    textAlign: "center",
  },
  ringNameFlank: {
    fontSize: 12,
    fontWeight: "600",
    color: C.textSecondary,
    maxWidth: 86,
    textAlign: "center",
  },
  ringPts: {
    fontSize: 11,
    color: C.textTertiary,
    fontWeight: "500",
  },
  ringPtsFirst: {
    color: C.textSecondary,
    fontWeight: "600",
  },
  stripWrapper: {
    marginTop: 16,
    position: "relative",
  },
  stripScroll: {
    paddingHorizontal: 4,
    gap: 16,
    alignItems: "center",
  },
  stripItem: {
    alignItems: "center",
    gap: 4,
  },
  stripRank: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textSecondary,
  },
  stripPts: {
    fontSize: 10,
    color: C.textTertiary,
    fontWeight: "500",
  },
  stripFade: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 32,
    backgroundColor: C.bg,
    opacity: 0.75,
  },
  dayContext: {
    fontSize: 12,
    color: C.textTertiary,
    textAlign: "center",
    marginTop: 14,
    fontWeight: "500",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — Pack History
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatRunRange(startedAt: string, endedAt: string): string {
  const s = new Date(startedAt);
  const e = new Date(endedAt);
  return `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()} – ${MONTHS_SHORT[e.getMonth()]} ${e.getDate()}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayMemberScore {
  userId: string;
  displayName: string;
  totalPoints: number;
  stepsCount: number;
  caloriesCount: number;
  waterOzCount: number;
  workoutCount: number;
  stepsAchieved: boolean;
  caloriesAchieved: boolean;
  waterAchieved: boolean;
  workoutAchieved: boolean;
  hasManualSteps: boolean;
  hasManualCalories: boolean;
}

interface WeekDetailEntry {
  runId: string;
  startedAt: string;
  endedAt: string;
  isActive: boolean;
  // Active run: current rankings from the Compete tab
  activeRanked?: WeeklyEntry[];
  // Completed run: final snapshot from usePackHistory
  winner?: { userId: string; displayName: string; totalPoints: number };
  completedStandings?: import("../../../src/hooks/usePackHistory").RunStanding[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const WEEK_DAY_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

// Returns ISO date strings for each day of the run up to today (for active runs)
// or up to the end date (for completed runs).
function generateRunDays(
  startedAt: string,
  endedAt: string,
  isActive: boolean,
): string[] {
  const startDate = startedAt.split("T")[0];
  const endDate = endedAt.split("T")[0];

  const days: string[] = [];
  const start = new Date(startDate + "T00:00:00");
  const now = new Date();
  const runEnd = new Date(endDate + "T23:59:59");
  const cap = isActive && now < runEnd ? now : runEnd;

  const cur = new Date(start);
  while (cur <= cap) {
    days.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`,
    );
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function parseDayLabel(isoDate: string): { dayName: string; dateNum: number } {
  const d = new Date(isoDate + "T12:00:00"); // noon avoids DST edge cases
  return { dayName: WEEK_DAY_SHORT[d.getDay()], dateNum: d.getDate() };
}

// ── Week Detail Sheet — full-screen modal with standings + day-level drill-down

function WeekDetailSheet({
  entry,
  pack,
  memberNameMap,
  currentUserId,
  onClose,
}: {
  entry: WeekDetailEntry | null;
  pack: Pack;
  memberNameMap: Map<string, string>;
  currentUserId: string | undefined;
  onClose: () => void;
}) {
  const { top } = useSafeAreaInsets();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayScores, setDayScores] = useState<DayMemberScore[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

  const toggleMember = useCallback((userId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedMemberId((prev) => (prev === userId ? null : userId));
  }, []);

  const days = React.useMemo(
    () =>
      entry
        ? generateRunDays(entry.startedAt, entry.endedAt, entry.isActive)
        : [],
    // entry.runId changing is the signal that a new week was opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry?.runId, entry?.isActive],
  );

  // Reset and default to today (or last available day) when a week is opened
  useEffect(() => {
    if (!entry) {
      setSelectedDay(null);
      setDayScores([]);
      return;
    }
    const d = generateRunDays(entry.startedAt, entry.endedAt, entry.isActive);
    if (d.length === 0) return;
    const todayStr = new Date().toISOString().split("T")[0];
    setSelectedDay(d.includes(todayStr) ? todayStr : d[d.length - 1]);
    setDayScores([]);
  }, [entry?.runId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch per-member daily scores for the selected day
  useEffect(() => {
    if (!selectedDay || !entry) return;
    let cancelled = false;
    setDayLoading(true);
    setDayScores([]);
    setExpandedMemberId(null);

    (async () => {
      const { data } = await supabase
        .from("daily_scores")
        .select(
          "user_id, total_points, steps_count, calories_count, water_oz_count, workout_count, steps_achieved, calories_achieved, water_achieved, workout_achieved, has_manual_steps, has_manual_calories",
        )
        .eq("run_id", entry.runId)
        .eq("score_date", selectedDay);

      if (cancelled) return;

      const scores: DayMemberScore[] = (data ?? [])
        .map((row) => ({
          userId: row.user_id,
          displayName: memberNameMap.get(row.user_id) ?? "Member",
          totalPoints: row.total_points,
          stepsCount: row.steps_count ?? 0,
          caloriesCount: row.calories_count ?? 0,
          waterOzCount: row.water_oz_count ?? 0,
          workoutCount: row.workout_count ?? 0,
          stepsAchieved: row.steps_achieved,
          caloriesAchieved: row.calories_achieved,
          waterAchieved: row.water_achieved,
          workoutAchieved: row.workout_achieved,
          hasManualSteps: row.has_manual_steps ?? false,
          hasManualCalories: row.has_manual_calories ?? false,
        }))
        .sort((a, b) => b.totalPoints - a.totalPoints);

      setDayScores(scores);
      setDayLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDay, entry?.runId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build summary standings for the sheet header section
  const summaryStandings = entry?.isActive
    ? (entry.activeRanked ?? []).map((e, i) => ({
        userId: e.user_id,
        displayName: e.display_name,
        totalPoints: e.weekly_points,
        rank: i + 1,
      }))
    : (entry?.completedStandings ?? []);

  const enabledCount = [
    pack.steps_enabled,
    pack.workouts_enabled,
    pack.calories_enabled,
    pack.water_enabled,
  ].filter(Boolean).length;

  // Merge all pack members with fetched day scores.
  // Members without a score row appear at the bottom with zeros.
  const allMemberScores = React.useMemo<(DayMemberScore & { hasNoData: boolean })[]>(() => {
    const scoredIds = new Set(dayScores.map((s) => s.userId));
    const withData = dayScores.map((s) => ({ ...s, hasNoData: false }));
    const noData: (DayMemberScore & { hasNoData: boolean })[] = [];
    memberNameMap.forEach((displayName, userId) => {
      if (!scoredIds.has(userId)) {
        noData.push({
          userId,
          displayName,
          totalPoints: 0,
          stepsCount: 0,
          caloriesCount: 0,
          waterOzCount: 0,
          workoutCount: 0,
          stepsAchieved: false,
          caloriesAchieved: false,
          waterAchieved: false,
          workoutAchieved: false,
          hasManualSteps: false,
          hasManualCalories: false,
          hasNoData: true,
        });
      }
    });
    return [...withData, ...noData];
  }, [dayScores, memberNameMap]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal visible={!!entry} animationType="slide" onRequestClose={onClose}>
      <View style={wdS.container}>
        {/* Header */}
        <View style={[wdS.header, { paddingTop: top + 12 }]}>
          <TouchableOpacity onPress={onClose} style={wdS.closeBtn} hitSlop={12}>
            <Ionicons name="chevron-down" size={22} color={C.textPrimary} />
          </TouchableOpacity>
          <View style={wdS.headerCenter}>
            <Text style={wdS.headerTitle} numberOfLines={1}>
              {entry ? formatRunRange(entry.startedAt, entry.endedAt) : ""}
            </Text>
            <Text style={wdS.headerStatus}>
              {entry?.isActive ? "In Progress" : "Completed"}
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={wdS.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Weekly standings */}
          <View style={wdS.section}>
            <Text style={wdS.sectionLabel}>
              {entry?.isActive ? "CURRENT STANDINGS" : "FINAL STANDINGS"}
            </Text>

            {summaryStandings.length === 0 ? (
              <Text style={wdS.emptyHint}>No activity recorded yet</Text>
            ) : (
              summaryStandings.map((standing) => {
                const isFirst = standing.rank === 1;
                const isMe = standing.userId === currentUserId;
                return (
                  <View
                    key={standing.userId}
                    style={[wdS.standingRow, isMe && wdS.standingRowMe]}
                  >
                    <Text style={[wdS.sRank, isFirst && wdS.sRankGold]}>
                      #{standing.rank}
                    </Text>
                    <Text
                      style={[wdS.sName, isMe && wdS.sNameMe]}
                      numberOfLines={1}
                    >
                      {formatName(standing.displayName ?? null, standing.rank)}
                    </Text>
                    <Text style={[wdS.sPts, isFirst && wdS.sPtsGold]}>
                      {standing.totalPoints} pts
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          {/* Daily breakdown — day picker + selected day's per-member results */}
          {days.length > 0 && (
            <View style={wdS.section}>
              <Text style={wdS.sectionLabel}>DAILY BREAKDOWN</Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={wdS.dayPickerRow}
              >
                {days.map((day) => {
                  const { dayName, dateNum } = parseDayLabel(day);
                  const isSelected = day === selectedDay;
                  const isToday =
                    day === new Date().toISOString().split("T")[0];
                  return (
                    <TouchableOpacity
                      key={day}
                      style={[wdS.dayBtn, isSelected && wdS.dayBtnActive]}
                      onPress={() => setSelectedDay(day)}
                    >
                      <Text
                        style={[
                          wdS.dayBtnName,
                          isSelected && wdS.dayBtnNameActive,
                        ]}
                      >
                        {dayName}
                      </Text>
                      <Text
                        style={[
                          wdS.dayBtnDate,
                          isSelected && wdS.dayBtnDateActive,
                        ]}
                      >
                        {dateNum}
                      </Text>
                      {isToday && (
                        <View
                          style={[
                            wdS.todayDot,
                            isSelected && wdS.todayDotActive,
                          ]}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={wdS.dayList}>
                {dayLoading ? (
                  <ActivityIndicator
                    size="small"
                    color={C.accent}
                    style={{ marginVertical: 16 }}
                  />
                ) : allMemberScores.length === 0 ? (
                  <Text style={wdS.emptyHint}>
                    Day-by-day stats will appear here as your pack logs activity.
                  </Text>
                ) : (
                  allMemberScores.map((score, idx) => {
                    const isMe = score.userId === currentUserId;
                    const isFirst = idx === 0 && !score.hasNoData;
                    const doneCount = [
                      pack.steps_enabled && score.stepsAchieved,
                      pack.workouts_enabled && score.workoutAchieved,
                      pack.calories_enabled && score.caloriesAchieved,
                      pack.water_enabled && score.waterAchieved,
                    ].filter(Boolean).length;

                    const isExpanded = expandedMemberId === score.userId;
                    return (
                      <TouchableOpacity
                        key={score.userId}
                        style={[wdS.memberCard, isMe && wdS.memberCardMe]}
                        onPress={() => toggleMember(score.userId)}
                        activeOpacity={0.75}
                      >
                        {/* Header row: rank + name + pts + chevron */}
                        <View style={wdS.memberHeaderRow}>
                          <Text style={[wdS.dayRank, isFirst && wdS.dayRankFirst]}>
                            #{idx + 1}
                          </Text>
                          <Text
                            style={[wdS.dayName, isMe && wdS.dayNameMe]}
                            numberOfLines={1}
                          >
                            {formatName(score.displayName, idx + 1)}
                          </Text>
                          <Text style={[wdS.dayPts, isFirst && wdS.dayPtsFirst]}>
                            +{score.totalPoints} pts
                          </Text>
                          <Ionicons
                            name={isExpanded ? "chevron-up" : "chevron-down"}
                            size={14}
                            color={C.textSecondary}
                          />
                        </View>

                        {/* Expanded: goals summary + per-activity breakdown */}
                        {isExpanded && enabledCount > 0 && !score.hasNoData && (
                          <Text style={wdS.dayGoals}>
                            {doneCount}/{enabledCount} goals
                          </Text>
                        )}

                        {isExpanded && (
                          score.hasNoData ? (
                            <Text style={wdS.noActivityText}>No activity logged.</Text>
                          ) : (
                            <View style={wdS.actList}>
                              {pack.steps_enabled && (
                                <View style={wdS.actRow}>
                                  <Text style={wdS.actLabel}>Steps</Text>
                                  <View style={wdS.actRight}>
                                    {score.hasManualSteps && <ManualBadge />}
                                    <Text style={[wdS.actValue, score.stepsAchieved && wdS.actValueDone]}>
                                      {score.stepsCount.toLocaleString()} / {(pack.step_target ?? 10000).toLocaleString()}
                                    </Text>
                                    {score.stepsAchieved && <Text style={wdS.actCheck}>✓</Text>}
                                  </View>
                                </View>
                              )}
                              {pack.workouts_enabled && (
                                <View style={wdS.actRow}>
                                  <Text style={wdS.actLabel}>Workout</Text>
                                  <View style={wdS.actRight}>
                                    <Text style={[wdS.actValue, score.workoutAchieved && wdS.actValueDone]}>
                                      {score.workoutCount} / 2
                                    </Text>
                                    {score.workoutAchieved && <Text style={wdS.actCheck}>✓</Text>}
                                  </View>
                                </View>
                              )}
                              {pack.calories_enabled && (
                                <View style={wdS.actRow}>
                                  <Text style={wdS.actLabel}>Calories</Text>
                                  <View style={wdS.actRight}>
                                    {score.hasManualCalories && <ManualBadge />}
                                    <Text style={[wdS.actValue, score.caloriesAchieved && wdS.actValueDone]}>
                                      {score.caloriesCount.toLocaleString()} / {(pack.calorie_target ?? 500).toLocaleString()} cal
                                    </Text>
                                    {score.caloriesAchieved && <Text style={wdS.actCheck}>✓</Text>}
                                  </View>
                                </View>
                              )}
                              {pack.water_enabled && (
                                <View style={wdS.actRow}>
                                  <Text style={wdS.actLabel}>Water</Text>
                                  <View style={wdS.actRight}>
                                    <Text style={[wdS.actValue, score.waterAchieved && wdS.actValueDone]}>
                                      {score.waterOzCount} / {pack.water_target_oz ?? 64} oz
                                    </Text>
                                    {score.waterAchieved && <Text style={wdS.actCheck}>✓</Text>}
                                  </View>
                                </View>
                              )}
                            </View>
                          )
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const wdS = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: "#0A0A0A",
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
    gap: 8,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center", gap: 2 },
  headerTitle: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  headerStatus: {
    fontSize: 11,
    fontWeight: "600",
    color: C.textTertiary,
    letterSpacing: 0.5,
  },
  scroll: { flex: 1 },
  section: {
    backgroundColor: C.surface,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textTertiary,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  emptyHint: { fontSize: 13, color: C.textTertiary, paddingVertical: 12 },
  // Standings rows inside sheet
  standingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 8,
  },
  standingRowMe: {
    backgroundColor: colors.selfBgSubtle,
    borderRadius: 6,
    paddingHorizontal: 6,
    marginHorizontal: -6,
  },
  sRank: { width: 26, fontSize: 12, fontWeight: "600", color: C.textTertiary },
  sRankGold: { color: colors.leader },
  sName: { flex: 1, fontSize: 14, fontWeight: "500", color: C.textSecondary },
  sNameMe: { color: C.accent, fontWeight: "600" },
  sPts: { fontSize: 13, fontWeight: "600", color: C.textTertiary },
  sPtsGold: { color: colors.leader },
  // Day picker
  dayPickerRow: { flexDirection: "row", gap: 6, paddingBottom: 14 },
  dayBtn: {
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.surfaceRaised,
    minWidth: 42,
    gap: 1,
  },
  dayBtnActive: { backgroundColor: C.accent },
  dayBtnName: { fontSize: 10, fontWeight: "600", color: C.textTertiary },
  dayBtnNameActive: { color: "#FFFFFF" },
  dayBtnDate: { fontSize: 14, fontWeight: "700", color: C.textSecondary },
  dayBtnDateActive: { color: "#FFFFFF" },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
    marginTop: 2,
  },
  todayDotActive: { backgroundColor: "rgba(255,255,255,0.7)" },
  // Day member cards
  dayList: { gap: 0 },
  memberCard: {
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
    gap: 4,
  },
  memberCardMe: {
    backgroundColor: colors.selfBgDim,
    borderRadius: 6,
    paddingHorizontal: 4,
    marginHorizontal: -4,
  },
  memberHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dayRank: {
    width: 26,
    fontSize: 12,
    fontWeight: "600",
    color: C.textTertiary,
  },
  dayRankFirst: { color: colors.leader },
  dayName: { flex: 1, fontSize: 14, fontWeight: "600", color: C.textPrimary },
  dayNameMe: { color: C.accent },
  dayGoals: { fontSize: 11, color: C.textTertiary, marginLeft: 34 },
  dayPts: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  dayPtsFirst: { color: colors.leader },
  noActivityText: {
    fontSize: 12,
    color: C.textTertiary,
    marginLeft: 34,
    marginTop: 2,
  },
  // Per-activity breakdown rows
  actList: { marginLeft: 34, marginTop: 6, gap: 6 },
  actRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actLabel: {
    fontSize: 13,
    color: C.textSecondary,
    width: 72,
  },
  actRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    justifyContent: "flex-end",
  },
  actValue: {
    fontSize: 13,
    color: C.textTertiary,
    textAlign: "right",
  },
  actValueDone: { color: C.success },
  actCheck: {
    fontSize: 12,
    color: C.success,
    fontWeight: "700",
  },
});

// ── History list — current week + completed weeks, each tappable for detail ──

function PastRunsSection({
  packId,
  currentUserId,
  activeRun,
  activeRanked,
  pack,
  memberNameMap,
  isPro,
}: {
  packId: string;
  currentUserId: string | undefined;
  activeRun?: Run;
  activeRanked?: WeeklyEntry[];
  pack: Pack;
  memberNameMap: Map<string, string>;
  isPro: boolean;
}) {
  const router = useRouter();
  const { completedRuns, isLoading } = usePackHistory(packId);
  const [detailEntry, setDetailEntry] = useState<WeekDetailEntry | null>(null);

  const hasAnyHistory = !!activeRun || completedRuns.length > 0;

  const handleLockedRun = () => {
    analytics.gateHit("history");
    router.push("/paywall?trigger=history");
  };

  return (
    <View style={pbS.section}>
      <Text style={pbS.title}>HISTORY</Text>

      {isLoading && !activeRun ? (
        <ActivityIndicator
          size="small"
          color={C.textTertiary}
          style={{ marginVertical: 16 }}
        />
      ) : !hasAnyHistory ? (
        <View style={pbS.emptyState}>
          <Text style={pbS.emptyTitle}>No weekly records yet</Text>
          <Text style={pbS.emptySubtitle}>
            This week and past results will appear here
          </Text>
        </View>
      ) : (
        <>
          {/* Current in-progress week — always first */}
          {activeRun && (
            <TouchableOpacity
              style={pbS.card}
              onPress={() =>
                setDetailEntry({
                  runId: activeRun.id,
                  startedAt: activeRun.start_date,
                  endedAt: activeRun.end_date,
                  isActive: true,
                  activeRanked,
                })
              }
              activeOpacity={0.8}
            >
              <View style={pbS.currentHeader}>
                <Text style={pbS.currentLabel}>This Week</Text>
                <View style={pbS.activeBadge}>
                  <Text style={pbS.activeBadgeText}>In Progress</Text>
                </View>
              </View>
              <View style={pbS.currentBody}>
                <Text style={pbS.currentLeader} numberOfLines={1}>
                  {activeRanked && activeRanked.length > 0
                    ? activeRanked[0].user_id === currentUserId
                      ? `You're leading · ${activeRanked[0].weekly_points} pts`
                      : `${formatName(activeRanked[0].display_name, 1)} is leading · ${activeRanked[0].weekly_points} pts`
                    : "No activity yet"}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={C.textTertiary}
                />
              </View>
            </TouchableOpacity>
          )}

          {/* Completed weeks — locked for free users */}
          {completedRuns.map((run) =>
            isPro ? (
              <TouchableOpacity
                key={run.runId}
                style={pbS.card}
                onPress={() =>
                  setDetailEntry({
                    runId: run.runId,
                    startedAt: run.startedAt,
                    endedAt: run.endedAt,
                    isActive: false,
                    winner: run.winner,
                    completedStandings: run.standings,
                  })
                }
                activeOpacity={0.8}
              >
                <Text style={pbS.dateLabel}>
                  {formatRunRange(run.startedAt, run.endedAt)}
                </Text>
                <View style={pbS.completedBody}>
                  <Text style={pbS.crown}>🏆</Text>
                  <View style={pbS.winnerMeta}>
                    <Text style={pbS.winnerName} numberOfLines={1}>
                      {run.winner.userId === currentUserId
                        ? "You won"
                        : `${formatName(run.winner.displayName, 1)} won`}
                    </Text>
                    <Text style={pbS.winnerPts}>
                      {run.winner.totalPoints} pts
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={C.textTertiary}
                  />
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                key={run.runId}
                style={[pbS.card, pbS.cardLocked]}
                onPress={handleLockedRun}
                activeOpacity={0.8}
              >
                <Text style={pbS.dateLabel}>
                  {formatRunRange(run.startedAt, run.endedAt)}
                </Text>
                <View style={pbS.completedBody}>
                  <Ionicons
                    name="lock-closed"
                    size={16}
                    color={C.textTertiary}
                  />
                  <Text style={pbS.lockedText}>Full history with Pro</Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={C.textTertiary}
                  />
                </View>
              </TouchableOpacity>
            ),
          )}
        </>
      )}

      <WeekDetailSheet
        entry={detailEntry}
        pack={pack}
        memberNameMap={memberNameMap}
        currentUserId={currentUserId}
        onClose={() => setDetailEntry(null)}
      />
    </View>
  );
}

const pbS = StyleSheet.create({
  section: {
    backgroundColor: C.surface,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 10,
  },
  title: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textTertiary,
    letterSpacing: 0.8,
  },
  // Week list cards
  card: {
    backgroundColor: C.surfaceRaised,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  // Current week card
  currentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  currentLabel: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  activeBadge: {
    backgroundColor: colors.selfBgLight,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activeBadgeText: { fontSize: 11, fontWeight: "600", color: C.accent },
  currentBody: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  currentLeader: { flex: 1, fontSize: 13, color: C.textSecondary },
  // Completed week card
  dateLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: C.textTertiary,
    letterSpacing: 0.4,
  },
  completedBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  crown: { fontSize: 18 },
  winnerMeta: { flex: 1, gap: 1 },
  winnerName: { fontSize: 14, fontWeight: "700", color: colors.leader },
  winnerPts: { fontSize: 12, fontWeight: "500", color: C.textSecondary },
  // Empty state
  emptyState: { paddingVertical: 24, gap: 6, alignItems: "center" },
  emptyTitle: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  emptySubtitle: { fontSize: 13, color: C.textTertiary, textAlign: "center" },
  cardLocked: { opacity: 0.6 },
  lockedText: {
    flex: 1,
    fontSize: 13,
    color: C.textTertiary,
    fontStyle: "italic",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// In-Screen Tab Bar
// ─────────────────────────────────────────────────────────────────────────────

type TabId = "compete" | "feed" | "history";

const TABS: { id: TabId; label: string }[] = [
  { id: "compete", label: "Compete" },
  { id: "feed", label: "Feed" },
  { id: "history", label: "History" },
];

function InScreenTabBar({
  onTabChange,
  scrollX,
  screenWidth,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  scrollX: Animated.Value;
  screenWidth: number;
}) {
  const tabWidth = screenWidth / TABS.length;
  const indicatorWidth = tabWidth * 0.6;
  const indicatorTranslateX = scrollX.interpolate({
    inputRange: TABS.map((_, i) => i * screenWidth),
    outputRange: TABS.map((_, i) => i * tabWidth + tabWidth * 0.2),
    extrapolate: "clamp",
  });

  return (
    <View style={tabBarS.bar}>
      {TABS.map((tab, index) => {
        const labelColor = scrollX.interpolate({
          inputRange: [
            (index - 1) * screenWidth,
            index * screenWidth,
            (index + 1) * screenWidth,
          ],
          outputRange: ["#6B7280", "#FFFFFF", "#6B7280"],
          extrapolate: "clamp",
        });

        return (
          <Pressable
            key={tab.id}
            style={tabBarS.tab}
            onPress={() => onTabChange(tab.id)}
          >
            <Animated.Text style={[tabBarS.label, { color: labelColor }]}>
              {tab.label}
            </Animated.Text>
          </Pressable>
        );
      })}
      <Animated.View
        style={[
          tabBarS.indicator,
          {
            width: indicatorWidth,
            transform: [{ translateX: indicatorTranslateX }],
          },
        ]}
      />
    </View>
  );
}

const tabBarS = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: C.bg,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
  indicator: {
    position: "absolute",
    bottom: 0,
    left: 0,
    height: 2,
    backgroundColor: C.accent,
    borderRadius: 1,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Feed Tab — activity feed with reaction chips
// ─────────────────────────────────────────────────────────────────────────────

function getRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}

// ── Reactor list sheet — fetches and shows who reacted with a given emoji ──

function ReactorListModal({
  feedItemId,
  emoji,
  onClose,
}: {
  feedItemId: string;
  emoji: ReactionType;
  onClose: () => void;
}) {
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: rows } = await supabase
        .from("activity_reactions")
        .select("user_id")
        .eq("feed_item_id", feedItemId)
        .eq("reaction_type", emoji);

      const userIds = (rows ?? []).map((r) => r.user_id);

      if (userIds.length === 0) {
        if (!cancelled) {
          setNames([]);
          setLoading(false);
        }
        return;
      }

      const { data: users } = await supabase
        .from("users")
        .select("display_name")
        .in("id", userIds);

      if (!cancelled) {
        setNames((users ?? []).map((u) => u.display_name ?? "Unknown"));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feedItemId, emoji]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={feedS.sheetOverlay} onPress={onClose}>
        <Pressable style={feedS.reactorSheet}>
          <View style={feedS.sheetHandle} />
          <View style={feedS.reactorHeader}>
            <Text style={feedS.reactorEmoji}>{emoji}</Text>
            <Text style={feedS.reactorTitle}>Reacted</Text>
          </View>
          {loading ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 16 }} />
          ) : names.length === 0 ? (
            <Text style={feedS.reactorEmpty}>No reactions yet</Text>
          ) : (
            names.map((name, i) => (
              <Text key={i} style={feedS.reactorName}>
                {name}
              </Text>
            ))
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Emoji picker sheet — shown when user taps the "+" add-reaction button ──

function EmojiPickerModal({
  item,
  onToggle,
  onClose,
}: {
  item: FeedItem;
  onToggle: (type: ReactionType) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={feedS.sheetOverlay} onPress={onClose}>
        <Pressable style={feedS.pickerPanel}>
          <View style={feedS.sheetHandle} />
          <Text style={feedS.pickerLabel}>React</Text>
          <View style={feedS.pickerRow}>
            {(["💪", "🔥", "👏"] as ReactionType[]).map((emoji) => {
              const rx = item.reactions.find((r) => r.type === emoji)!;
              return (
                <Pressable
                  key={emoji}
                  style={[
                    feedS.pickerBtn,
                    rx.hasReacted && feedS.pickerBtnActive,
                  ]}
                  onPress={() => {
                    onClose();
                    onToggle(emoji);
                  }}
                >
                  <Text style={feedS.pickerEmoji}>{emoji}</Text>
                  {rx.count > 0 && (
                    <Text style={feedS.pickerCount}>{rx.count}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Feed card ──

const REPORT_REASONS = ["Inappropriate", "Spam", "Nudity", "Violence"] as const;

function FeedItemRow({
  item,
  currentUserId,
  onToggleReaction,
  removePhotoFromItem,
}: {
  item: FeedItem;
  currentUserId: string | undefined;
  onToggleReaction: (id: string, type: ReactionType) => Promise<void>;
  removePhotoFromItem: (id: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reactorEmoji, setReactorEmoji] = useState<ReactionType | null>(null);
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [reportMenuOpen, setReportMenuOpen] = useState(false);

  const isMe = item.userId === currentUserId;
  const name = formatName(item.displayName, 0);
  const initial = isMe
    ? "Y"
    : (item.displayName.trim().charAt(0) || "?").toUpperCase();

  useEffect(() => {
    if (!item.photoUrl) { setSignedPhotoUrl(null); return; }
    getSignedUrl(item.photoUrl).then((url) => setSignedPhotoUrl(url)).catch(() => {});
  }, [item.photoUrl]);

  // TODO: pass packWaterTarget as prop when available
  const WATER_TARGET_FALLBACK = 64;

  let activityPhrase: string;
  switch (item.activityType) {
    case "steps":
      activityPhrase = ` logged ${item.value.toLocaleString()} steps`;
      break;
    case "workout":
      activityPhrase = " logged a workout";
      break;
    case "calories":
      activityPhrase = ` burned ${item.value.toLocaleString()} active calories`;
      break;
    case "water":
      activityPhrase =
        item.value >= WATER_TARGET_FALLBACK
          ? isMe
            ? " hit your water goal"
            : " hit their water goal"
          : ` logged ${item.value} oz of water`;
      break;
    case "took_lead":
      activityPhrase = " took the lead";
      break;
    case "all_goals":
      activityPhrase =
        item.value > 0
          ? ` completed all ${item.value} goals today`
          : " completed all goals today";
      break;
    default:
      activityPhrase = ` completed ${item.activityType}`;
  }

  const phraseColor = isMe ? "#FFFFFF" : "#9CA3AF";
  const visibleChips = item.reactions.filter((rx) => rx.count > 0);

  const handleDeletePhoto = async () => {
    setPhotoMenuOpen(false);
    if (item.photoUrl) {
      deletePhoto(item.photoUrl).catch(() => {});
    }
    removePhotoFromItem(item.id);
  };

  const handleReport = (reason: string) => {
    setReportMenuOpen(false);
    if (currentUserId && item.photoUrl) {
      reportPhoto(currentUserId, item.id, item.photoUrl, reason).catch(() => {});
      Alert.alert("Reported", "Thanks for letting us know. We'll review this photo.");
    }
  };

  return (
    <View style={feedS.card}>
      {/* Top row: avatar + event text */}
      <View style={feedS.cardTop}>
        <View style={feedS.avatar}>
          <Text style={feedS.avatarText}>{initial}</Text>
        </View>
        <View style={feedS.content}>
          <View style={feedS.line1Row}>
            <Text style={feedS.line1Text}>
              <Text style={isMe ? feedS.nameTextSelf : feedS.nameText}>
                {name}
              </Text>
              <Text style={{ color: phraseColor }}>{activityPhrase}</Text>
            </Text>
            {item.pointsEarned > 0 && (
              <View style={feedS.ptsRow}>
                <Text style={feedS.ptsInline}>+{item.pointsEarned} pts</Text>
                {item.entryMethod === "manual" &&
                  (item.activityType === "steps" ||
                    item.activityType === "calories") && <ManualBadge />}
              </View>
            )}
          </View>
          <Text style={feedS.time}>{getRelativeTime(item.createdAt)}</Text>
        </View>
      </View>

      {/* Photo */}
      {signedPhotoUrl && (
        <TouchableOpacity
          style={feedS.photoWrap}
          onPress={() => { analytics.photoViewedFullscreen(item.id); setFullscreenOpen(true); }}
          onLongPress={() => setPhotoMenuOpen(true)}
          activeOpacity={0.92}
        >
          <Image source={{ uri: signedPhotoUrl }} style={feedS.photo} resizeMode="cover" />
        </TouchableOpacity>
      )}

      {/* Chips row: reaction summary + add button */}
      <View style={feedS.chipsRow}>
        {visibleChips.map((rx) => (
          <Pressable
            key={rx.type}
            style={[feedS.chip, rx.hasReacted && feedS.chipActive]}
            onPress={() => onToggleReaction(item.id, rx.type)}
            onLongPress={() => setReactorEmoji(rx.type)}
            hitSlop={4}
          >
            <Text style={feedS.chipEmoji}>{rx.type}</Text>
            <Text
              style={[feedS.chipCount, rx.hasReacted && feedS.chipCountActive]}
            >
              {rx.count}
            </Text>
          </Pressable>
        ))}
        <Pressable
          style={feedS.addBtn}
          onPress={() => setPickerOpen(true)}
          hitSlop={4}
        >
          <Text style={feedS.addBtnText}>+</Text>
        </Pressable>
      </View>

      {/* Emoji picker */}
      {pickerOpen && (
        <EmojiPickerModal
          item={item}
          onToggle={(type) => onToggleReaction(item.id, type)}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Who reacted sheet */}
      {reactorEmoji !== null && (
        <ReactorListModal
          feedItemId={item.id}
          emoji={reactorEmoji}
          onClose={() => setReactorEmoji(null)}
        />
      )}

      {/* Full-screen photo viewer */}
      {fullscreenOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setFullscreenOpen(false)}>
          <Pressable style={feedS.fullscreenOverlay} onPress={() => setFullscreenOpen(false)}>
            <Image source={{ uri: signedPhotoUrl! }} style={feedS.fullscreenImage} resizeMode="contain" />
          </Pressable>
        </Modal>
      )}

      {/* Photo context menu */}
      {photoMenuOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPhotoMenuOpen(false)}>
          <Pressable style={feedS.sheetOverlay} onPress={() => setPhotoMenuOpen(false)}>
            <Pressable style={feedS.contextSheet}>
              <View style={feedS.sheetHandle} />
              {isMe && (
                <>
                  <TouchableOpacity style={feedS.contextRow} onPress={handleDeletePhoto} activeOpacity={0.7}>
                    <Ionicons name="trash-outline" size={18} color="#F87171" />
                    <Text style={[feedS.contextRowText, { color: "#F87171" }]}>Delete photo</Text>
                  </TouchableOpacity>
                  <View style={feedS.contextDivider} />
                </>
              )}
              <TouchableOpacity
                style={feedS.contextRow}
                onPress={() => { setPhotoMenuOpen(false); setReportMenuOpen(true); }}
                activeOpacity={0.7}
              >
                <Ionicons name="flag-outline" size={18} color={C.textPrimary} />
                <Text style={feedS.contextRowText}>Report photo</Text>
              </TouchableOpacity>
              <View style={feedS.contextDivider} />
              <TouchableOpacity style={feedS.contextRow} onPress={() => setPhotoMenuOpen(false)} activeOpacity={0.7}>
                <Text style={[feedS.contextRowText, { color: C.textTertiary }]}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Report reason sheet */}
      {reportMenuOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setReportMenuOpen(false)}>
          <Pressable style={feedS.sheetOverlay} onPress={() => setReportMenuOpen(false)}>
            <Pressable style={feedS.contextSheet}>
              <View style={feedS.sheetHandle} />
              <Text style={feedS.reportTitle}>Report photo</Text>
              {REPORT_REASONS.map((reason, i) => (
                <React.Fragment key={reason}>
                  <TouchableOpacity style={feedS.contextRow} onPress={() => handleReport(reason)} activeOpacity={0.7}>
                    <Text style={feedS.contextRowText}>{reason}</Text>
                  </TouchableOpacity>
                  {i < REPORT_REASONS.length - 1 && <View style={feedS.contextDivider} />}
                </React.Fragment>
              ))}
              <View style={feedS.contextDivider} />
              <TouchableOpacity style={feedS.contextRow} onPress={() => setReportMenuOpen(false)} activeOpacity={0.7}>
                <Text style={[feedS.contextRowText, { color: C.textTertiary }]}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

function FeedTab({
  packId,
  currentUserId,
}: {
  packId: string;
  currentUserId: string | undefined;
}) {
  const { items, isLoading, toggleReaction, removePhotoFromItem } = useActivityFeed(
    packId,
    currentUserId,
  );

  if (isLoading) {
    return (
      <ActivityIndicator
        size="small"
        color={C.accent}
        style={{ marginTop: 48 }}
      />
    );
  }

  if (items.length === 0) {
    return (
      <View style={feedS.empty}>
        <Text style={feedS.emptyTitle}>No activity yet</Text>
        <Text style={feedS.emptySub}>
          Big moments in the pack will show up here
        </Text>
      </View>
    );
  }

  return (
    <View>
      {items.map((item) => (
        <FeedItemRow
          key={item.id}
          item={item}
          currentUserId={currentUserId}
          onToggleReaction={toggleReaction}
          removePhotoFromItem={removePhotoFromItem}
        />
      ))}
    </View>
  );
}

const feedS = StyleSheet.create({
  // ── Card ──
  card: {
    backgroundColor: C.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 15,
    fontWeight: "700",
    color: C.textPrimary,
  },
  content: {
    flex: 1,
    gap: 3,
  },
  line1Row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
  },
  line1Text: {
    fontSize: 14,
    color: "#FFFFFF",
    lineHeight: 20,
  },
  nameText: {
    fontWeight: "700",
    color: "#FFFFFF",
  },
  nameTextSelf: {
    fontWeight: "700",
    color: C.accent,
  },
  ptsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  ptsInline: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
  },
  time: {
    fontSize: 11,
    color: "#4B5563",
    marginTop: 3,
  },

  // ── Chips row ──
  chipsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
    marginLeft: 48, // align under text, past avatar (36) + gap (12)
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    backgroundColor: "#1A2030",
    borderWidth: 1,
    borderColor: "#30363D",
  },
  chipActive: {
    backgroundColor: "#1E3A5F",
    borderColor: colors.accent,
  },
  chipEmoji: { fontSize: 13 },
  chipCount: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6B7280",
  },
  chipCountActive: { color: "#93C5FD" },
  addBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#1A2030",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#30363D",
  },
  addBtnText: {
    fontSize: 16,
    color: "#6B7280",
    lineHeight: 20,
  },

  // ── Shared sheet base ──
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#374151",
    alignSelf: "center",
    marginBottom: 16,
  },

  // ── Emoji picker sheet ──
  pickerPanel: {
    backgroundColor: C.surfaceRaised,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  pickerLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textTertiary,
    textAlign: "center",
    marginBottom: 20,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  pickerRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  pickerBtn: {
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "#0F1623",
    borderWidth: 1,
    borderColor: "transparent",
    minWidth: 88,
  },
  pickerBtnActive: {
    backgroundColor: "#1E3A5F",
    borderColor: colors.accent,
  },
  pickerEmoji: { fontSize: 34 },
  pickerCount: {
    fontSize: 12,
    color: "#6B7280",
    fontWeight: "500",
  },

  // ── Reactor list sheet ──
  reactorSheet: {
    backgroundColor: C.surfaceRaised,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 0,
  },
  reactorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  reactorEmoji: { fontSize: 22 },
  reactorTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  reactorName: {
    fontSize: 15,
    color: C.textSecondary,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  reactorEmpty: {
    fontSize: 14,
    color: C.textTertiary,
    marginTop: 8,
  },

  // ── Empty feed state ──
  empty: {
    paddingTop: 64,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: C.textSecondary,
  },
  emptySub: {
    fontSize: 13,
    color: C.textTertiary,
    textAlign: "center",
    paddingHorizontal: 32,
  },

  // ── Photo ──
  photoWrap: {
    marginTop: 10,
    marginLeft: 48,
    borderRadius: 10,
    overflow: "hidden",
  },
  photo: {
    width: "100%",
    aspectRatio: 4 / 3,
    backgroundColor: C.surfaceRaised,
  },
  fullscreenOverlay: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  fullscreenImage: {
    width: "100%",
    height: "100%",
  },

  // ── Photo context / report sheets ──
  contextSheet: {
    backgroundColor: C.surfaceRaised,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
    borderTopWidth: 0.5,
    borderColor: C.border,
  },
  contextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
  },
  contextRowText: {
    fontSize: 16,
    color: C.textPrimary,
  },
  contextDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
  },
  reportTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: C.textPrimary,
    marginBottom: 4,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function PackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { isPro } = useIsPro();
  const { data: packData, isLoading: packLoading } = usePack(id ?? null);
  const { syncNow, isSyncing } = useHealthKit(user?.id ?? null);

  const { width: screenWidth } = useWindowDimensions();
  const { top: topInset } = useSafeAreaInsets();
  const pageScrollRef = React.useRef<ScrollView>(null);
  const scrollX = React.useRef(new Animated.Value(0)).current;

  const TAB_ORDER: TabId[] = ["compete", "feed", "history"];

  const [scores, setScores] = useState<MemberScore[]>([]);
  const [weeklyTotals, setWeeklyTotals] = useState<Record<string, number>>({});
  const [scoresLoading, setScoresLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("compete");

  const handleTabChange = (tab: TabId) => {
    const index = TAB_ORDER.indexOf(tab);
    setActiveTab(tab);
    pageScrollRef.current?.scrollTo({ x: index * screenWidth, animated: true });
  };

  const handleSwipeEnd = (e: {
    nativeEvent: { contentOffset: { x: number } };
  }) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    const tab = TAB_ORDER[index];
    if (tab) setActiveTab(tab);
  };

  // ── Fetch scores: today's details + weekly totals (parallel) ─────────

  const fetchWeekly = useCallback(async (runId: string) => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Fetch today's daily detail rows (goal flags, counts, streak) and the
    // full run's totals (for ranking and primary point display) in parallel.
    const [todayResult, weeklyResult] = await Promise.all([
      supabase
        .from("daily_scores")
        .select(SCORE_SELECT)
        .eq("run_id", runId)
        .eq("score_date", today),
      supabase
        .from("daily_scores")
        .select("user_id, total_points")
        .eq("run_id", runId),
    ]);

    if (todayResult.error) {
      console.error("[fetchWeekly] today query failed:", todayResult.error);
    }

    // Aggregate weekly totals per user across all run dates
    const weeklyTotals: Record<string, number> = {};
    (weeklyResult.data ?? []).forEach((row) => {
      weeklyTotals[row.user_id] =
        (weeklyTotals[row.user_id] ?? 0) + row.total_points;
    });

    // Store weeklyTotals separately so fullRoster can give correct weekly_points
    // to members who have no today row (scored on previous days but not today).
    setWeeklyTotals(weeklyTotals);
    setScores(
      todayResult.data
        ? mapRows(todayResult.data as ScoreRow[], {}, weeklyTotals)
        : [],
    );
    setScoresLoading(false);
  }, []);

  // ── Load scores when pack loads ───────────────────────────────────────

  useEffect(() => {
    if (!packData) return;
    setScoresLoading(true);

    if (packData.activeRun) {
      fetchWeekly(packData.activeRun.id);
    } else {
      setScores([]);
      setScoresLoading(false);
    }
  }, [packData, fetchWeekly]);

  // ── Trigger HealthKit sync when pack loads ────────────────────────────

  useEffect(() => {
    if (!packData?.activeRun || !packData?.pack) return;
    syncNow(packData.pack.id, packData.activeRun.id, packData.pack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packData?.activeRun?.id]);

  // ── Realtime subscription ─────────────────────────────────────────────

  useEffect(() => {
    if (!packData?.activeRun) return;
    const runId = packData.activeRun.id;

    const channel = supabase
      .channel(`scores-${runId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "daily_scores",
          filter: `run_id=eq.${runId}`,
        },
        () => fetchWeekly(runId),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [packData?.activeRun?.id, fetchWeekly]);

  // ── Refetch after any activity log (belt-and-suspenders alongside realtime) ──
  const logVersion = useScoreStore((s) => s.logVersion);
  useEffect(() => {
    if (logVersion > 0 && packData?.activeRun) {
      fetchWeekly(packData.activeRun.id);
    }
  }, [logVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleInvite = async () => {
    if (!packData?.pack.invite_code) return;
    const memberLimit = isPro ? PRO_MEMBER_LIMIT : FREE_MEMBER_LIMIT;
    if (!isPro && (packData.memberCount ?? 0) >= memberLimit) {
      analytics.gateHit("member_limit");
      router.push("/paywall?trigger=member_limit");
      return;
    }
    await Share.share({
      message: `Join my pack "${packData.pack.name}"! Invite code: ${packData.pack.invite_code}`,
    });
  };

  const handleToggle = (userId: string) => {
    LayoutAnimation.configureNext({
      duration: 220,
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.scaleXY,
      },
      update: { type: LayoutAnimation.Types.easeInEaseOut, duration: 220 },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.scaleXY,
      },
    });
    setExpandedId((prev) => (prev === userId ? null : userId));
  };

  // ── Optimistic overlay from score store ──────────────────────────────
  // Populated by LogSheet immediately on each log tap (before DB roundtrip).
  // Realtime subscription reconciles after DB write completes.
  const packId = packData?.pack.id;
  const optimisticMyScore = useScoreStore((s) =>
    packId ? s.myScores[packId] : undefined,
  );

  // ── Derived ───────────────────────────────────────────────────────────

  // Build a name map from packData.members — the pack_members→users join is
  // the reliable post-RLS-fix source of truth for display names.
  // At runtime PostgREST returns the key as "users" (table name), not "user".
  const memberNameMap = new Map<string, string>();
  (packData?.members ?? []).forEach((m) => {
    const name = (m as unknown as { users: { display_name: string } | null })
      .users?.display_name;
    if (name) memberNameMap.set(m.user_id, name);
  });

  // Apply names to scores fetched today
  const namedScores: MemberScore[] = scores.map((s) => ({
    ...s,
    display_name: memberNameMap.get(s.user_id) ?? s.display_name,
  }));

  // Build a full roster from ALL pack members so everyone is always visible,
  // even if they have no daily_scores row today (they show at 0 pts).
  const scoreById = new Map(namedScores.map((s) => [s.user_id, s]));
  const zero = (): Omit<MemberScore, "user_id" | "display_name"> => ({
    weekly_points: 0,
    total_points: 0,
    streak_days: 0,
    updated_at: null,
    steps_achieved: false,
    workout_achieved: false,
    calories_achieved: false,
    water_achieved: false,
    steps_count: 0,
    calories_count: 0,
    water_oz_count: 0,
    workout_count: 0,
    has_manual_steps: false,
    has_manual_calories: false,
  });

  const fullRoster: MemberScore[] = (packData?.members ?? []).map((m) => {
    const existing = scoreById.get(m.user_id);
    if (existing) return existing;
    // Member has no today row — use their accumulated run total so the ring
    // and standings show their real weekly progress, not a misleading 0.
    return {
      user_id: m.user_id,
      display_name: memberNameMap.get(m.user_id) ?? "",
      weekly_points: weeklyTotals[m.user_id] ?? 0,
      total_points: 0,
      streak_days: 0,
      updated_at: null,
      steps_achieved: false,
      workout_achieved: false,
      calories_achieved: false,
      water_achieved: false,
      steps_count: 0,
      calories_count: 0,
      water_oz_count: 0,
      workout_count: 0,
      has_manual_steps: false,
      has_manual_calories: false,
    };
  });

  // Guarantee current user is present even if they aren't in pack_members yet
  if (!fullRoster.find((r) => r.user_id === user?.id)) {
    fullRoster.push({
      user_id: user?.id ?? "",
      display_name: (user?.user_metadata?.display_name as string | undefined) ?? "",
      ...zero(),
    });
  }

  // Apply optimistic values for the current user's row so the leaderboard
  // updates the moment LogSheet writes — before the realtime event fires.
  if (optimisticMyScore && user?.id) {
    const idx = fullRoster.findIndex((r) => r.user_id === user.id);
    if (idx >= 0) {
      fullRoster[idx] = { ...fullRoster[idx], ...optimisticMyScore };
    }
  }

  const ranked = rankWithTiebreakers(fullRoster);
  const others = ranked.filter((r) => r.user_id !== user?.id);

  // ── Loading / error ───────────────────────────────────────────────────

  if (packLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  if (!packData) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Pack not found</Text>
      </View>
    );
  }

  const { pack } = packData;

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[s.header, { paddingTop: topInset + 12 }]}>
        <View style={s.headerLeft}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 16, right: 24 }}
            style={s.backBtn}
          >
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            <Text style={s.backText}>Back</Text>
          </Pressable>
        </View>
        <View style={s.headerCenter}>
          <Text style={s.packName} numberOfLines={1}>
            {pack.name}
          </Text>
        </View>
        <View style={s.headerRight}>
          <TouchableOpacity onPress={handleInvite} style={s.inviteBtn}>
            <Ionicons
              name="person-add-outline"
              size={20}
              color={C.textPrimary}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* In-screen tab bar */}
      <InScreenTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        scrollX={scrollX}
        screenWidth={screenWidth}
      />

      {/* Horizontally paged body — swipe or tap tab bar to navigate */}
      <ScrollView
        ref={pageScrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false },
        )}
        onMomentumScrollEnd={handleSwipeEnd}
        style={s.scroll}
        // Prevent the horizontal pager from stealing vertical scroll events
        // inside each page's vertical ScrollView on Android.
        disableIntervalMomentum
      >
        {/* ── PAGE 0: COMPETE ────────────────────────────────────────── */}
        <ScrollView
          style={{ width: screenWidth }}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          {!scoresLoading && packData.activeRun && (
            <RingLeaderboard
              entries={ranked}
              pack={pack}
              activeRun={packData.activeRun}
              currentUserId={user?.id}
            />
          )}

          {!scoresLoading && (
            <DailySection
              ranked={ranked}
              userId={user?.id}
              pack={pack}
              isSyncing={isSyncing}
            />
          )}

          {scoresLoading ? (
            <View style={s.loadingBox}>
              <ActivityIndicator size="small" color={C.textTertiary} />
            </View>
          ) : (
            <View>
              <View style={s.standingsHeader}>
                <Text style={s.standingsLabel}>STANDINGS</Text>
                <Text style={s.standingsSubLabel}>weekly pts</Text>
              </View>
              {ranked.map((score) => (
                <LeaderboardListRow
                  key={score.user_id}
                  score={score}
                  rank={score.rank}
                  pack={pack}
                  isCurrentUser={score.user_id === user?.id}
                  isExpanded={expandedId === score.user_id}
                  onToggle={() => handleToggle(score.user_id)}
                  isTied={score.isTied}
                  tieCaption={
                    score.tiebreaker === "streak"
                      ? "Leading by streak"
                      : score.tiebreaker === "time"
                        ? "Got there first"
                        : null
                  }
                />
              ))}
            </View>
          )}

          {!scoresLoading && others.length === 0 && (
            <EmptyMembers onInvite={handleInvite} />
          )}

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* ── PAGE 1: FEED ───────────────────────────────────────────── */}
        <ScrollView
          style={{ width: screenWidth }}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <FeedTab packId={pack.id} currentUserId={user?.id} />
          <View style={{ height: 40 }} />
        </ScrollView>

        {/* ── PAGE 2: HISTORY ────────────────────────────────────────── */}
        <ScrollView
          style={{ width: screenWidth }}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <PastRunsSection
            packId={pack.id}
            currentUserId={user?.id}
            activeRun={packData.activeRun ?? undefined}
            activeRanked={ranked}
            pack={pack}
            memberNameMap={memberNameMap}
            isPro={isPro}
          />
          <View style={{ height: 40 }} />
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bg,
  },
  errorText: { fontSize: 16, color: C.textSecondary },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#0A0A0A",
    borderBottomWidth: 0.5,
    borderBottomColor: "#1F2937",
  },
  headerLeft: {
    flex: 1,
    alignItems: "flex-start",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backText: {
    fontSize: 16,
    color: "#FFFFFF",
    fontWeight: "400",
  },
  headerCenter: {
    flex: 2,
    alignItems: "center",
  },
  packName: {
    fontSize: 17,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  headerRight: {
    flex: 1,
    alignItems: "flex-end",
  },
  inviteBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flex: 1 },
  content: { gap: 0 },
  loadingBox: { paddingVertical: 40, alignItems: "center" },
  standingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    backgroundColor: C.bg,
  },
  standingsLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textTertiary,
    letterSpacing: 1.0,
  },
  standingsSubLabel: {
    fontSize: 11,
    color: C.textTertiary,
    fontWeight: "500",
  },
});
