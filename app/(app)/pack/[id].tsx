import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Alert,
  Animated,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Keyboard,
  ScrollView,
  ActivityIndicator,
  LayoutAnimation,
  Modal,
  Platform,
  UIManager,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useNavigation, CommonActions } from "@react-navigation/native";
import { useConsumeSuppressFlag } from "../../../src/context/ModalMutationContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmDialog } from "../../../src/components/ConfirmDialog";
import {
  leavePack,
  deletePack,
  canUserDeletePack,
  transferPackOwnership,
} from "../../../src/lib/packLifecycle";
import { notifyUser } from "../../../src/lib/notifications";
import { showToast } from "../../../src/lib/toast";
import { packToday } from "../../../src/lib/packDates";
import { useAuthStore } from "../../../src/stores/authStore";
import { usePack } from "../../../src/hooks/usePack";
import {
  usePackRunHistory,
  type RunMemberStanding,
  type RunCategoryWinner,
} from "../../../src/hooks/usePackRunHistory";
import { useIsPro } from "../../../src/hooks/useIsPro";
import {
  FREE_HISTORY_WEEKS,
  FREE_MEMBER_LIMIT,
  PRO_MEMBER_LIMIT,
} from "../../../src/lib/revenuecat";
import { analytics } from "../../../src/lib/analytics";
import { useActivityFeed } from "../../../src/hooks/useActivityFeed";
import { usePackTimeline } from "../../../src/hooks/usePackTimeline";
import { TimelineRow } from "../../../src/components/TimelineRow";
import { ChatInputBar } from "../../../src/components/ChatInputBar";
import { FeedItemRow } from "../../../src/components/FeedItemRow";
import { ReactionPicker } from "../../../src/components/ReactionPicker";
import {
  MessageActionMenu,
  type AnchorPosition,
} from "../../../src/components/MessageActionMenu";
import type { ChatMessage } from "../../../src/types/database";
import type { FeedItem } from "../../../src/hooks/useActivityFeed";
import { useHealthKit } from "../../../src/hooks/useHealthKit";
import { RulesSheet } from "../../../src/components/RulesSheet";
import { InviteSheet } from "../../../src/components/InviteSheet";
import { supabase } from "../../../src/lib/supabase";
import { formatName } from "../../../src/lib/displayName";
import { useScoreStore } from "../../../src/stores/scoreStore";
import type { Pack, Run } from "../../../src/types/database";
import { colors } from "../../../src/theme/colors";
import { PackGridView, type GridEntry } from "../../../src/components/PackGridView";
import {
  usePackCategoryStandings,
  type PackCategoryStandings,
} from "../../../src/hooks/usePackCategoryStandings";
import { Crown } from "lucide-react-native";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
} from "../../../src/lib/categories";
import { useCurrentUser } from "../../../src/context/CurrentUserContext";
import { useRefreshCurrentUserOnFocus } from "../../../src/hooks/useRefreshCurrentUserOnFocus";
import { den, packEdit, t } from "../../../src/constants/strings";
import { subscribeToRunScores } from "../../../src/lib/realtimeSubscriptions";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Colors
// ─────────────────────────────────────────────────────────────────────────────
//
// Color rule (mirrors src/theme/colors.ts — keep in sync):
//   colors.leader (#E3A000 gold)  → leader-only signal: #1 rank, leader name,
//                                   leader's points, leader's ring arc.
//   colors.self / C.accent (blue) → self-identity + UI chrome: own row border,
//                                   own name, day picker active button,
//                                   tab indicator, progress bars.
//   C.success (green)             → achievement signal: 100% bar fill, goal-hit.
//   C.danger (red)                → destructive only: delete actions, errors.
//
// Future drift: keep gold strictly leader-only. Don't use gold for chrome.
// Don't introduce a third blue. Token consolidation tracked in X1.

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
  avatar_url?: string | null;
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
  // F.2: M badge derives from manual_*_count > 0 (replaced the prior
  // has_manual_* booleans dropped in migration 20260513b).
  manual_steps_count: number;
  manual_calories_count: number;
}

type ScoreRow = {
  user_id: string;
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
  manual_steps_count: number;
  manual_calories_count: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mapRows(
  data: ScoreRow[],
  nameMap: Record<string, string>,
): MemberScore[] {
  return data.map((row) => ({
    user_id: row.user_id,
    display_name: nameMap[row.user_id] ?? "",
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
    manual_steps_count: row.manual_steps_count ?? 0,
    manual_calories_count: row.manual_calories_count ?? 0,
  }));
}

// No user join — display names are fetched in a separate explicit query
// F.2: SELECT manual_*_count instead of dropped has_manual_* booleans.
// steps_count/calories_count are DB-generated (manual + hk) and still
// returned by Postgres; no client-side recompute needed.
const SCORE_SELECT =
  "user_id, streak_days, updated_at, steps_achieved, workout_achieved, calories_achieved, water_achieved, steps_count, calories_count, water_oz_count, workout_count, manual_steps_count, manual_calories_count";

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
  // Parse at noon local time to avoid UTC-midnight date shifting across timezones.
  // Consistent with parseDayLabel which also uses T12:00:00.
  const s = new Date(startedAt.split("T")[0] + "T12:00:00");
  const e = new Date(endedAt.split("T")[0] + "T12:00:00");
  return `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()} – ${MONTHS_SHORT[e.getMonth()]} ${e.getDate()}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayMemberScore {
  userId: string;
  displayName: string;
  stepsCount: number;
  caloriesCount: number;
  waterOzCount: number;
  workoutCount: number;
  stepsAchieved: boolean;
  caloriesAchieved: boolean;
  waterAchieved: boolean;
  workoutAchieved: boolean;
  manualStepsCount: number;
  manualCaloriesCount: number;
}

interface WeekDetailEntry {
  runId: string;
  startedAt: string;
  endedAt: string;
  isActive: boolean;
  // Unified standings — RunMemberStanding[] for both active and completed
  // runs. Active: the caller derives it from categoryStandings. Completed:
  // run.standings from usePackRunHistory.
  standings: RunMemberStanding[];
  // Per-category run winners — completed runs only (run.categoryWinners
  // from usePackRunHistory). undefined for active runs.
  categoryWinners?: RunCategoryWinner[];
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
function generateRunDays(startedAt: string, endedAt: string): string[] {
  const startDate = startedAt.split("T")[0];
  const endDate = endedAt.split("T")[0];

  const days: string[] = [];
  const start = new Date(startDate + "T00:00:00");
  const runEnd = new Date(endDate + "T23:59:59");

  const cur = new Date(start);
  while (cur <= runEnd) {
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

// A DayMemberScore's metric value for a category — used to compute an
// active run's still-unsettled today winners live from daily_scores.
function dayCategoryValue(s: DayMemberScore, category: Category): number {
  switch (category) {
    case "steps":
      return s.stepsCount;
    case "workouts":
      return s.workoutCount;
    case "calories":
      return s.caloriesCount;
    case "water":
      return s.waterOzCount;
  }
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
  const { user: currentUser } = useCurrentUser();
  const { top } = useSafeAreaInsets();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayScores, setDayScores] = useState<DayMemberScore[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());
  // Settled per-day-per-category winners for the run: score_date → category
  // → winner user ids. A still-unsettled today (active run) has no entry.
  const [dayWinners, setDayWinners] = useState<
    Record<string, Record<string, string[]>>
  >({});

  const toggleMember = useCallback((userId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedMemberId((prev) => (prev === userId ? null : userId));
  }, []);

  const days = React.useMemo(
    () => (entry ? generateRunDays(entry.startedAt, entry.endedAt) : []),
    // entry.runId changing is the signal that a new week was opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry?.runId],
  );

  // Reset and default to today (or last available day) when a week is opened
  useEffect(() => {
    if (!entry) {
      setSelectedDay(null);
      setDayScores([]);
      return;
    }
    const d = generateRunDays(entry.startedAt, entry.endedAt);
    if (d.length === 0) return;
    const todayStr = packToday(pack.timezone ?? "UTC");
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
          "user_id, steps_count, calories_count, water_oz_count, workout_count, steps_achieved, calories_achieved, water_achieved, workout_achieved, manual_steps_count, manual_calories_count",
        )
        .eq("run_id", entry.runId)
        .eq("score_date", selectedDay);

      if (cancelled) return;

      const scores: DayMemberScore[] = (data ?? []).map((row) => ({
        userId: row.user_id,
        displayName: memberNameMap.get(row.user_id) ?? "Member",
        stepsCount: row.steps_count ?? 0,
        caloriesCount: row.calories_count ?? 0,
        waterOzCount: row.water_oz_count ?? 0,
        workoutCount: row.workout_count ?? 0,
        stepsAchieved: row.steps_achieved,
        caloriesAchieved: row.calories_achieved,
        waterAchieved: row.water_achieved,
        workoutAchieved: row.workout_achieved,
        manualStepsCount: row.manual_steps_count ?? 0,
        manualCaloriesCount: row.manual_calories_count ?? 0,
      }));

      setDayScores(scores);
      setDayLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDay, entry?.runId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch every settled per-day-per-category winner for this run. Drives
  // the daily-breakdown badges and the day-picker activity underline (a
  // day "had activity" if it has any daily_winners row). One query.
  useEffect(() => {
    if (!entry?.runId) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("daily_winners")
        .select("score_date, category, winner_user_ids")
        .eq("run_id", entry.runId)
        .neq("category", "legacy");

      if (cancelled) return;
      const byDate: Record<string, Record<string, string[]>> = {};
      for (const row of (data ?? []) as {
        score_date: string;
        category: string;
        winner_user_ids: string[];
      }[]) {
        if (!byDate[row.score_date]) byDate[row.score_date] = {};
        byDate[row.score_date][row.category] = row.winner_user_ids;
      }
      setDayWinners(byDate);
      setActiveDates(new Set(Object.keys(byDate)));
    })();

    return () => {
      cancelled = true;
    };
  }, [entry?.runId]);

  // Unified standings — RunMemberStanding[] for both active and completed
  // runs (the caller builds the active one off categoryStandings).
  const summaryStandings = entry?.standings ?? [];
  // Per-category run winners — populated for completed runs only.
  const categoryWinners = entry?.categoryWinners ?? [];

  const enabledCount = [
    pack.steps_enabled,
    pack.workouts_enabled,
    pack.calories_enabled,
    pack.water_enabled,
  ].filter(Boolean).length;

  // Per-category winners for the selected day: settled days come from
  // daily_winners; an active run's still-unsettled today is computed live
  // (the member(s) at the max of each category column "won" provisionally).
  // Then merge all pack members with the day's scores and order by
  // categories-won desc, then name — a day has no overall points ranking.
  const allMemberScores = React.useMemo<
    (DayMemberScore & { hasNoData: boolean; categoriesWon: Category[] })[]
  >(() => {
    const winners = {} as Record<Category, string[]>;
    const settled = selectedDay ? dayWinners[selectedDay] : undefined;
    for (const c of CATEGORIES) {
      if (settled) {
        winners[c] = settled[c] ?? [];
      } else {
        let max = 0;
        for (const s of dayScores) {
          max = Math.max(max, dayCategoryValue(s, c));
        }
        winners[c] =
          max > 0
            ? dayScores
                .filter((s) => dayCategoryValue(s, c) === max)
                .map((s) => s.userId)
            : [];
      }
    }

    const scoredIds = new Set(dayScores.map((s) => s.userId));
    const withData = dayScores.map((s) => ({ ...s, hasNoData: false }));
    const noData: (DayMemberScore & { hasNoData: boolean })[] = [];
    memberNameMap.forEach((displayName, userId) => {
      if (!scoredIds.has(userId)) {
        noData.push({
          userId,
          displayName,
          stepsCount: 0,
          caloriesCount: 0,
          waterOzCount: 0,
          workoutCount: 0,
          stepsAchieved: false,
          caloriesAchieved: false,
          waterAchieved: false,
          workoutAchieved: false,
          manualStepsCount: 0,
          manualCaloriesCount: 0,
          hasNoData: true,
        });
      }
    });

    return [...withData, ...noData]
      .map((s) => ({
        ...s,
        categoriesWon: CATEGORIES.filter((c) => winners[c].includes(s.userId)),
      }))
      .sort((a, b) =>
        b.categoriesWon.length !== a.categoriesWon.length
          ? b.categoriesWon.length - a.categoriesWon.length
          : a.displayName.localeCompare(b.displayName),
      );
  }, [dayScores, memberNameMap, selectedDay, dayWinners]); // eslint-disable-line react-hooks/exhaustive-deps

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
              <Text style={wdS.emptyHint}>No wins yet</Text>
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
                      {formatName(
                        isMe && currentUser
                          ? currentUser.displayName
                          : (standing.displayName ?? null),
                        standing.rank,
                      )}
                    </Text>
                    <Text style={[wdS.sPts, isFirst && wdS.sPtsGold]}>
                      {standing.totalWins}{" "}
                      {standing.totalWins === 1 ? "win" : "wins"}
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          {/* Category champions — completed runs only (per-category run
              winners + days-won). Active runs carry no settled
              categoryWinners, so the section is omitted for them. */}
          {categoryWinners.length > 0 && (
            <View style={wdS.section}>
              <Text style={wdS.sectionLabel}>CATEGORY CHAMPIONS</Text>
              {CATEGORIES.map((category) => {
                const cw = categoryWinners.find((c) => c.category === category);
                if (!cw) return null;
                const names = cw.winnerUserIds.map((uid) =>
                  formatName(memberNameMap.get(uid) ?? null, 1),
                );
                const namesLabel =
                  names.length === 1
                    ? names[0]
                    : names.length === 2
                      ? `${names[0]} & ${names[1]}`
                      : `${names[0]} & ${names.length - 1} others`;
                return (
                  <View key={category} style={wdS.champRow}>
                    <Text style={wdS.champCategory}>
                      {CATEGORY_LABELS[category]}
                    </Text>
                    <View style={wdS.champWinner}>
                      <Crown size={14} color={colors.leader} strokeWidth={2} />
                      <Text style={wdS.champName} numberOfLines={1}>
                        {namesLabel}
                      </Text>
                    </View>
                    <Text style={wdS.champDays}>
                      {cw.totalDaysWon} {cw.totalDaysWon === 1 ? "day" : "days"}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

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
                  const today = packToday(pack.timezone ?? "UTC");
                  const isToday = day === today;
                  const isBeforeRunStart = day < entry!.startedAt.split("T")[0];
                  const isFuture = day > today;
                  const isDisabled = isBeforeRunStart || isFuture;
                  const hasActivity = activeDates.has(day);

                  return (
                    <TouchableOpacity
                      key={day}
                      style={[
                        wdS.dayBtn,
                        isSelected && wdS.dayBtnActive,
                        isDisabled && wdS.dayBtnDisabled,
                      ]}
                      onPress={() => !isDisabled && setSelectedDay(day)}
                      disabled={isDisabled}
                      activeOpacity={isDisabled ? 1 : 0.2}
                    >
                      <Text
                        style={[
                          wdS.dayBtnName,
                          isSelected && wdS.dayBtnNameActive,
                          isDisabled && wdS.dayBtnTextDisabled,
                        ]}
                      >
                        {dayName}
                      </Text>
                      <Text
                        style={[
                          wdS.dayBtnDate,
                          isSelected && wdS.dayBtnDateActive,
                          isDisabled && wdS.dayBtnTextDisabled,
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
                      {hasActivity && !isDisabled && (
                        <View style={wdS.activityBar} />
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
                ) : (
                  allMemberScores.map((score) => {
                    const isMe = score.userId === currentUserId;
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
                        style={[
                          wdS.memberCard,
                          isMe && wdS.memberCardMe,
                          score.hasNoData && wdS.memberCardEmpty,
                        ]}
                        onPress={() => toggleMember(score.userId)}
                        activeOpacity={0.75}
                      >
                        {/* Header row: name + the categories this member won
                            that day (badges) + chevron. A day has no overall
                            ranking under the categories model. hasNoData rows
                            render dimmed with no badges and no chevron. */}
                        <View style={wdS.memberHeaderRow}>
                          <Text
                            style={[wdS.dayName, isMe && wdS.dayNameMe]}
                            numberOfLines={1}
                          >
                            {formatName(
                              isMe && currentUser
                                ? currentUser.displayName
                                : score.displayName,
                            )}
                          </Text>
                          <View style={wdS.dayBadges}>
                            {score.categoriesWon.map((c) => (
                              <View key={c} style={wdS.dayBadge}>
                                <Crown
                                  size={11}
                                  color={colors.leader}
                                  strokeWidth={2}
                                />
                                <Text style={wdS.dayBadgeText}>
                                  {CATEGORY_LABELS[c]}
                                </Text>
                              </View>
                            ))}
                          </View>
                          {!score.hasNoData && (
                            <Ionicons
                              name={isExpanded ? "chevron-up" : "chevron-down"}
                              size={14}
                              color={C.textSecondary}
                            />
                          )}
                        </View>

                        {/* Expanded: goals summary + per-activity breakdown */}
                        {isExpanded && enabledCount > 0 && !score.hasNoData && (
                          <Text style={wdS.dayGoals}>
                            {doneCount}/{enabledCount} goals
                          </Text>
                        )}

                        {isExpanded &&
                          (score.hasNoData ? (
                            <Text style={wdS.noActivityText}>
                              No activity logged.
                            </Text>
                          ) : (
                            <View style={wdS.actList}>
                              {pack.steps_enabled && (
                                <View style={wdS.actRow}>
                                  <Text style={wdS.actLabel}>Steps</Text>
                                  <View style={wdS.actRight}>
                                    {score.manualStepsCount > 0 && <ManualBadge />}
                                    <Text
                                      style={[
                                        wdS.actValue,
                                        score.stepsAchieved && wdS.actValueDone,
                                      ]}
                                    >
                                      {score.stepsCount.toLocaleString()} /{" "}
                                      {(
                                        pack.step_target ?? 10000
                                      ).toLocaleString()}
                                    </Text>
                                    {score.stepsAchieved && (
                                      <Text style={wdS.actCheck}>✓</Text>
                                    )}
                                  </View>
                                </View>
                              )}
                              {pack.workouts_enabled && (
                                <View style={wdS.actRow}>
                                  <Text style={wdS.actLabel}>Workout</Text>
                                  <View style={wdS.actRight}>
                                    <Text
                                      style={[
                                        wdS.actValue,
                                        score.workoutAchieved &&
                                          wdS.actValueDone,
                                      ]}
                                    >
                                      {score.workoutCount} / 2
                                    </Text>
                                    {score.workoutAchieved && (
                                      <Text style={wdS.actCheck}>✓</Text>
                                    )}
                                  </View>
                                </View>
                              )}
                              {pack.calories_enabled && (
                                <View style={wdS.actRow}>
                                  <Text style={wdS.actLabel}>Calories</Text>
                                  <View style={wdS.actRight}>
                                    {score.manualCaloriesCount > 0 && <ManualBadge />}
                                    <Text
                                      style={[
                                        wdS.actValue,
                                        score.caloriesAchieved &&
                                          wdS.actValueDone,
                                      ]}
                                    >
                                      {score.caloriesCount.toLocaleString()} /{" "}
                                      {(
                                        pack.calorie_target ?? 500
                                      ).toLocaleString()}{" "}
                                      cal
                                    </Text>
                                    {score.caloriesAchieved && (
                                      <Text style={wdS.actCheck}>✓</Text>
                                    )}
                                  </View>
                                </View>
                              )}
                              {pack.water_enabled && (
                                <View style={wdS.actRow}>
                                  <Text style={wdS.actLabel}>Water</Text>
                                  <View style={wdS.actRight}>
                                    <Text
                                      style={[
                                        wdS.actValue,
                                        score.waterAchieved && wdS.actValueDone,
                                      ]}
                                    >
                                      {score.waterOzCount} /{" "}
                                      {pack.water_target_oz ?? 64} oz
                                    </Text>
                                    {score.waterAchieved && (
                                      <Text style={wdS.actCheck}>✓</Text>
                                    )}
                                  </View>
                                </View>
                              )}
                            </View>
                          ))}
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
  // Category Champions (completed runs)
  champRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 8,
  },
  champCategory: {
    width: 84,
    fontSize: 13,
    fontWeight: "600",
    color: C.textSecondary,
  },
  champWinner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  champName: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "600",
    color: C.textPrimary,
  },
  champDays: {
    fontSize: 12,
    fontWeight: "600",
    color: C.textTertiary,
  },
  // Daily-breakdown per-member category-won badges
  dayBadges: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  dayBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: C.surfaceRaised,
  },
  dayBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.leader,
  },
  // Day picker
  dayPickerRow: { flexDirection: "row", gap: 6, paddingBottom: 14 },
  dayBtn: {
    position: "relative",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.surfaceRaised,
    minWidth: 42,
    gap: 1,
  },
  dayBtnActive: { backgroundColor: C.accent },
  dayBtnDisabled: {
    opacity: 0.35,
    backgroundColor: "transparent",
  },
  dayBtnTextDisabled: {
    color: C.textTertiary,
  },
  activityBar: {
    position: "absolute",
    bottom: 4,
    left: 8,
    right: 8,
    height: 2,
    borderRadius: 1,
    backgroundColor: C.success,
  },
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
  // Dim treatment for hasNoData rows — reads as "muted but present"
  // (member is in the pack, just didn't log this day) rather than
  // "rendering broken." Pairs with em-dash + suppressed chevron.
  memberCardEmpty: {
    opacity: 0.6,
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
  dayName: { flexShrink: 1, fontSize: 14, fontWeight: "600", color: C.textPrimary },
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
  categoryStandings,
  pack,
  memberNameMap,
  isPro,
}: {
  packId: string;
  currentUserId: string | undefined;
  activeRun?: Run;
  categoryStandings: PackCategoryStandings | null;
  pack: Pack;
  memberNameMap: Map<string, string>;
  isPro: boolean;
}) {
  const router = useRouter();
  const { completedRuns, isLoading } = usePackRunHistory(packId);
  const [detailEntry, setDetailEntry] = useState<WeekDetailEntry | null>(null);

  const hasAnyHistory = !!activeRun || completedRuns.length > 0;

  // "week" / "month" — the run's competition period.
  const period = pack.competition_window === "monthly" ? "month" : "week";

  // "This Week" card leading copy, from the live category standings.
  const thisWeekLine = (() => {
    const ranked = categoryStandings?.rankedMembers ?? [];
    if (ranked.length === 0 || ranked.every((r) => r.totalWins === 0)) {
      return `No wins yet this ${period}`;
    }
    const topWins = ranked[0].totalWins;
    const leaders = ranked.filter((r) => r.totalWins === topWins);
    const winsLabel = `${topWins} ${topWins === 1 ? "win" : "wins"}`;
    if (leaders.some((r) => r.userId === currentUserId)) {
      return leaders.length > 1
        ? `Tied for the lead · ${winsLabel}`
        : `You're leading · ${winsLabel}`;
    }
    const leaderName = formatName(
      memberNameMap.get(ranked[0].userId) ?? null,
      1,
    );
    return `${leaderName} is leading · ${winsLabel}`;
  })();

  // Active-run CURRENT STANDINGS for WeekDetailSheet — RunMemberStanding[]
  // derived from the live category standings: displayName from the roster
  // map, dense competition rank by total wins (same pattern as
  // usePackRunHistory's completed-run standings).
  const activeStandings: RunMemberStanding[] = (() => {
    const sorted = (categoryStandings?.rankedMembers ?? [])
      .map((m) => ({
        userId: m.userId,
        displayName: memberNameMap.get(m.userId) ?? "Member",
        totalWins: m.totalWins,
      }))
      .sort((a, b) =>
        b.totalWins !== a.totalWins
          ? b.totalWins - a.totalWins
          : a.displayName.localeCompare(b.displayName),
      );
    let prevWins = -1;
    let prevRank = 0;
    return sorted.map((m, i) => {
      const rank = m.totalWins === prevWins ? prevRank : i + 1;
      prevWins = m.totalWins;
      prevRank = rank;
      return { ...m, rank };
    });
  })();

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
          <Text style={pbS.emptyTitle}>{den.history.empty.headline}</Text>
          <Text style={pbS.emptySubtitle}>{den.history.empty.body}</Text>
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
                  standings: activeStandings,
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
                  {thisWeekLine}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={C.textTertiary}
                />
              </View>
            </TouchableOpacity>
          )}

          {/* Completed weeks — free tier unlocks the FREE_HISTORY_WEEKS
              most recent (completedRuns is sorted end_date DESC by the
              server query); week N+1 onward render as locked Pro teasers. */}
          {completedRuns.map((run, idx) => {
            // Overall winner = the standings rank-1 group (standings is
            // rank-sorted; ties share rank 1). Empty standings = nobody
            // won any category-day this run.
            const leaders = run.standings.filter((s) => s.rank === 1);
            const completedLine = (() => {
              if (leaders.length === 0) return `No winner — quiet ${period}`;
              const topWins = leaders[0].totalWins;
              const winsLabel = `${topWins} ${topWins === 1 ? "win" : "wins"}`;
              if (leaders.length === 1) {
                const w = leaders[0];
                return w.userId === currentUserId
                  ? `You won the ${period} · ${winsLabel}`
                  : `${formatName(w.displayName, 1)} won the ${period} · ${winsLabel}`;
              }
              if (leaders.length === 2) {
                return `${formatName(leaders[0].displayName, 1)} & ${formatName(leaders[1].displayName, 1)} tied · ${winsLabel}`;
              }
              const others = leaders.length - 1;
              return `${formatName(leaders[0].displayName, 1)} & ${others} others tied · ${winsLabel}`;
            })();
            return isPro || idx < FREE_HISTORY_WEEKS ? (
              <TouchableOpacity
                key={run.runId}
                style={pbS.card}
                onPress={() =>
                  setDetailEntry({
                    runId: run.runId,
                    startedAt: run.startedAt,
                    endedAt: run.endedAt,
                    isActive: false,
                    standings: run.standings,
                    categoryWinners: run.categoryWinners,
                  })
                }
                activeOpacity={0.8}
              >
                <Text style={pbS.dateLabel}>
                  {formatRunRange(run.startedAt, run.endedAt)}
                </Text>
                <View style={pbS.completedBody}>
                  <Crown size={16} color={colors.leader} strokeWidth={2} />
                  <Text style={pbS.winnerName} numberOfLines={1}>
                    {completedLine}
                  </Text>
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
            );
          })}
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
  winnerName: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.leader },
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

type TabId = "compete" | "chat" | "history";

const TABS: { id: TabId; label: string }[] = [
  { id: "compete", label: "Compete" },
  { id: "chat", label: "Chat" },
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
// Chat Tab — unified timeline of human messages + activity events
// (FeedItemRow + ReactionPicker live in src/components; the inline
// EmojiPickerModal / ReactorListModal that lived here pre-C.4 were
// replaced by the unified ReactionPicker / ReactionPills.)
// ─────────────────────────────────────────────────────────────────────────────

// Centered time-cluster header. Inserted by ChatTab between consecutive
// timeline items when the gap is ≥ 30 minutes. Replaces per-message
// timestamps inside the rows.
function TimeClusterHeader({ isoString }: { isoString: string }) {
  const d = new Date(isoString);
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  let prefix: string;
  if (dDate === today) prefix = "Today";
  else if (dDate === today - 86400000) prefix = "Yesterday";
  else {
    const diffDays = Math.floor((today - dDate) / 86400000);
    if (diffDays > 0 && diffDays < 7) {
      prefix = d.toLocaleDateString([], { weekday: "short" });
    } else {
      prefix = d.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  }

  return (
    <View style={tchS.row}>
      <Text style={tchS.text}>
        {prefix} {time}
      </Text>
    </View>
  );
}

const tchS = StyleSheet.create({
  row: {
    paddingVertical: 16,
    alignItems: "center",
  },
  text: {
    fontSize: 12,
    color: "#8A8A8E",
    fontWeight: "500",
  },
});

// Settle window duration. Every onContentSizeChange within this window
// re-pins the chat ScrollView to the bottom — so async image / photo
// loads don't leave the viewport stranded at a stale fake-bottom from
// the first paint. Tunable: extend if slow networks leave images still
// loading past the cutoff.
const INITIAL_SETTLE_MS = 1500;

function ChatTab({
  packId,
  currentUserId,
}: {
  packId: string;
  currentUserId: string | undefined;
}) {
  // usePackTimeline owns sort order + chat_messages fetch + writes.
  // useActivityFeed remains the source of truth for activity-row reactions
  // (optimistic toggles update its state). For each activity TimelineItem we
  // prefer the live useActivityFeed item by id, falling back to the
  // timeline's snapshot if the id isn't in useActivityFeed's window.
  const {
    timeline,
    loading,
    sendMessage,
    editMessage,
    softDeleteMessage,
    toggleChatReaction,
  } = usePackTimeline(packId, currentUserId);
  const {
    items: activityItems,
    toggleReaction,
    removePhotoFromItem,
  } = useActivityFeed(packId, currentUserId);

  const scrollRef = useRef<ScrollView>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null,
  );
  const [actionMenuMessage, setActionMenuMessage] =
    useState<ChatMessage | null>(null);
  const [actionMenuAnchor, setActionMenuAnchor] =
    useState<AnchorPosition | null>(null);

  // ReactionPicker state — agnostic to target type. The picker fires
  // a single onToggle(emoji) callback; we route to either
  // toggleReaction (activity) or toggleChatReaction (chat) based on
  // the captured target kind.
  const [pickerTarget, setPickerTarget] = useState<
    | { kind: "activity"; id: string; existingReactions: string[] }
    | { kind: "message"; id: string; existingReactions: string[] }
    | null
  >(null);
  const [pickerAnchor, setPickerAnchor] = useState<AnchorPosition | null>(null);

  const handleActionMenuOpen = useCallback(
    (message: ChatMessage, anchor: AnchorPosition) => {
      setActionMenuMessage(message);
      setActionMenuAnchor(anchor);
    },
    [],
  );

  const closeActionMenu = useCallback(() => {
    setActionMenuMessage(null);
    setActionMenuAnchor(null);
  }, []);

  const handleOpenActivityPicker = useCallback(
    (item: FeedItem, anchor: AnchorPosition) => {
      const existing = item.reactions
        .filter((r) => r.user_id === currentUserId)
        .map((r) => r.reaction_type);
      setPickerTarget({ kind: "activity", id: item.id, existingReactions: existing });
      setPickerAnchor(anchor);
    },
    [currentUserId],
  );

  const handleOpenMessagePicker = useCallback(
    (messageId: string, anchor: AnchorPosition) => {
      const tlItem = timeline.find(
        (it) => it.kind === "message" && it.data.id === messageId,
      );
      const existing =
        tlItem?.kind === "message"
          ? tlItem.data.reactions
              .filter((r) => r.user_id === currentUserId)
              .map((r) => r.reaction_type)
          : [];
      setPickerTarget({ kind: "message", id: messageId, existingReactions: existing });
      setPickerAnchor(anchor);
    },
    [currentUserId, timeline],
  );

  const closePicker = useCallback(() => {
    setPickerTarget(null);
    setPickerAnchor(null);
  }, []);

  const handlePickerToggle = useCallback(
    (emoji: string) => {
      if (!pickerTarget) return;
      if (pickerTarget.kind === "activity") {
        toggleReaction(pickerTarget.id, emoji);
      } else {
        toggleChatReaction(pickerTarget.id, emoji);
      }
    },
    [pickerTarget, toggleReaction, toggleChatReaction],
  );

  // Auto-scroll bookkeeping — newest renders at the BOTTOM of the list.
  // - On initial settle window: re-pin to bottom on every onContentSizeChange
  //   so async image/photo loads (avatars, activity attachments) don't leave
  //   the viewport pinned at a fake mid-list "bottom" while content grows
  //   underneath. Window auto-closes after INITIAL_SETTLE_MS, OR earlier if
  //   the user manually scrolls.
  // - On own send: always scroll to bottom.
  // - On other-user send via realtime: scroll only if the user is already
  //   near the bottom (within 100pt). Don't yank them while they're reading.
  //
  // TODO(perf): ScrollView renders all 50 children synchronously, which is
  // fine at the current usePackTimeline.limit(50) cap. If the limit grows
  // past ~200, convert to FlatList for virtualization.

  // 0 = settle window has not opened yet (no content has rendered).
  // > 0 = timestamp at which the window closes. Compared against Date.now()
  // every time we check `isSettleWindowActive()`.
  const settleWindowEndAtRef = useRef(0);
  // Set true on the first user-initiated scroll. Exits the settle window
  // immediately so we stop fighting the user's intent.
  const userHasScrolledRef = useRef(false);
  // Timestamp of "ignore onScroll-as-user-scroll until at least this ms".
  // Set forward by every scrollToEndProgrammatic call. handleScroll checks
  // Date.now() < this value before tripping userHasScrolledRef.
  //
  // Why timestamp not boolean: RN's native bridge delivers the onScroll
  // event from a programmatic scroll a few ms after we kick it off (3ms
  // observed on iPhone). A boolean flag cleared via setTimeout(0) races
  // the bridge — the timer can fire BEFORE the bridge delivers onScroll,
  // letting our own scroll trip the user-scrolled flag and self-terminate
  // the settle window. A timestamp 200ms in the future is well above
  // bridge latency and below any plausible user reaction time.
  const programmaticUntilRef = useRef(0);

  const isNearBottomRef = useRef(true);
  const prevTimelineLengthRef = useRef(0);
  // Set true when the keyboard opens to defer the scroll-to-end until
  // onContentSizeChange fires (so we use the new contentSize, not the
  // stale one). A setTimeout-based scroll races the layout commit and
  // sometimes lands at the old end, leaving the last message far above
  // the input bar.
  const pendingKeyboardScrollRef = useRef(false);

  const isSettleWindowActive = () => {
    if (settleWindowEndAtRef.current === 0) return false;
    if (userHasScrolledRef.current) return false;
    return Date.now() < settleWindowEndAtRef.current;
  };

  // Wraps scrollToEnd so handleScroll can distinguish "we just scrolled"
  // from "the user scrolled." The 200ms suppression is well above the
  // observed 3ms RN bridge latency and well below user reaction time.
  const PROGRAMMATIC_SUPPRESS_MS = 200;
  const scrollToEndProgrammatic = (animated: boolean) => {
    programmaticUntilRef.current = Date.now() + PROGRAMMATIC_SUPPRESS_MS;
    scrollRef.current?.scrollToEnd({ animated });
  };

  const handleScroll = (e: {
    nativeEvent: {
      layoutMeasurement: { height: number };
      contentOffset: { y: number };
      contentSize: { height: number };
    };
  }) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    // Trip the user-scrolled flag only when the scroll event is NOT the
    // tail of one of our own programmatic scrollToEnd calls. The 200ms
    // suppression window absorbs RN bridge latency (observed 3ms but
    // budgeting headroom). Without this guard, our own programmatic
    // scrolls fire onScroll a few ms later and would self-terminate the
    // settle window before images settle.
    const isProgrammaticTail = Date.now() < programmaticUntilRef.current;
    if (!isProgrammaticTail && isSettleWindowActive()) {
      userHasScrolledRef.current = true;
    }
    const distanceFromBottom =
      contentSize.height - (layoutMeasurement.height + contentOffset.y);
    isNearBottomRef.current = distanceFromBottom < 100;
  };

  const handleContentSizeChange = (_width: number, _height: number) => {
    // Open the settle window the first time content actually exists. The
    // window stays open for INITIAL_SETTLE_MS, during which every
    // contentSize change re-pins to the bottom — so async image / photo
    // loads (avatars, activity attachments) don't leave the viewport
    // stranded at a stale "fake bottom" that was the bottom at T0 but
    // isn't the bottom by the time everything has rendered.
    if (settleWindowEndAtRef.current === 0 && timeline.length > 0) {
      settleWindowEndAtRef.current = Date.now() + INITIAL_SETTLE_MS;
      scrollToEndProgrammatic(false);
      return;
    }

    // While the settle window is active, every contentSize growth pins
    // back to bottom so the viewport tracks the real end as images settle.
    if (isSettleWindowActive()) {
      scrollToEndProgrammatic(false);
      return;
    }

    // After the settle window: keyboard-show paddingBottom growths still
    // need to re-pin so the last message lands flush above the input bar.
    if (pendingKeyboardScrollRef.current) {
      pendingKeyboardScrollRef.current = false;
      scrollToEndProgrammatic(true);
    }
  };

  // Auto-scroll on new arrivals: own messages always scroll; others' only
  // when the user is already near the bottom. Skipped until the settle
  // window has opened (timeline first rendered) so this doesn't fight
  // the initial pin-to-bottom logic in handleContentSizeChange.
  useEffect(() => {
    const grew = timeline.length > prevTimelineLengthRef.current;
    prevTimelineLengthRef.current = timeline.length;
    if (!grew) return;
    if (settleWindowEndAtRef.current === 0) return; // no content rendered yet
    const last = timeline[timeline.length - 1];
    const isOwn =
      last && last.kind === "message" && last.data.user_id === currentUserId;
    if (isOwn || isNearBottomRef.current) {
      scrollToEndProgrammatic(true);
    }
  }, [timeline, currentUserId]);

  // Track keyboard height so we can grow the message-list contentContainer
  // by the amount the keyboard + input bar would otherwise cover, then
  // scroll to the new end. This is the "messages push above keyboard"
  // behavior.
  //
  // CRITICAL: pendingKeyboardScrollRef is set SYNCHRONOUSLY inside the
  // listener (before setKeyboardHeight). If we set it in a useEffect on
  // [keyboardHeight] change, that effect races onContentSizeChange — the
  // native side might fire its callback before the JS effect runs, in
  // which case the pending flag is still false and the auto-scroll
  // silently fails. Setting it in the listener guarantees the flag is
  // true before React even schedules the re-render.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e) => {
      // Set the scroll-pending flag BEFORE setState so it's reliably
      // true by the time onContentSizeChange fires.
      if (isNearBottomRef.current) {
        pendingKeyboardScrollRef.current = true;
      }
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      // Clear pending in case onContentSizeChange never consumed it.
      pendingKeyboardScrollRef.current = false;
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Calculate ScrollView paddingBottom needed to land the last message's
  // text flush with the input bar's top edge when the keyboard is open.
  //
  // Geometry (screen coords, y-up from screen bottom):
  //   - chat slot bottom = top of bottom tab nav = tabNavHeight
  //   - input bar (KSV) is a flex sibling of the ScrollView inside the
  //     <View flex:1>, so it takes barHeight of layout space — meaning
  //     ScrollView's visible bottom is at tabNavHeight + barHeight
  //   - When keyboard opens, KSV translates the bar to y=keyboardHeight
  //     (flush with keyboard top, given offset.opened=tabNavHeight)
  //   - Bar top is then at y = keyboardHeight + barHeight
  //
  // When ScrollView is scrolled to end, the last row's bottom edge in
  // screen coords is at: ScrollView_visible_bottom + paddingBottom.
  // Inside the row, paddingVertical:10 puts the visible text 10pt above
  // row bottom. So:
  //   text_bottom_y = (tabNavHeight + barHeight) + paddingBottom + rowPad
  //
  // For text_bottom_y == bar_top_y (zero gap):
  //   (tabNavHeight + barHeight) + paddingBottom + rowPad = keyboardHeight + barHeight
  //   paddingBottom = keyboardHeight - tabNavHeight - rowPad
  //
  // Confirmed by [keyboard-heights] diagnostics that lib + RN agree on
  // keyboardHeight — no predictive-bar offset to compensate.
  const tabNavHeight = Platform.OS === "ios" ? 84 : 64;
  const rowVerticalPadding = 10; // matches ChatMessageRow's paddingVertical
  const breathingRoom = 12; // small gap between last message and input bar
  const dynamicPaddingBottom =
    keyboardHeight > 0
      ? Math.max(
          0,
          keyboardHeight - tabNavHeight - rowVerticalPadding + breathingRoom,
        )
      : 8;

  const handleSend = async (body: string, photoLocalUri?: string | null) => {
    // Let send failures propagate to ChatInputBar's handleSubmit catch —
    // that's what surfaces the error Alert AND preserves the composer's
    // text + photo so the user can retry. Swallowing the error here
    // (the prior shape) made `await onSend` always resolve, so the
    // composer cleared even on failure. Success path only.
    await sendMessage(body, photoLocalUri);
    // Newest renders at the bottom; jump there so the just-sent message
    // is visible. The useEffect above also catches this; calling here
    // makes the response feel snappier.
    scrollToEndProgrammatic(true);
  };

  const handleEdit = async (messageId: string, newBody: string) => {
    try {
      await editMessage(messageId, newBody);
      setEditingMessage(null);
    } catch (err) {
      Alert.alert(
        "Edit failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleDeleteRequest = (messageId: string) => {
    Alert.alert("Delete message?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await softDeleteMessage(messageId);
          } catch (err) {
            Alert.alert(
              "Delete failed",
              err instanceof Error ? err.message : String(err),
            );
          }
        },
      },
    ]);
  };

  const renderListContents = () => {
    if (loading) {
      return (
        <ActivityIndicator
          size="small"
          color={C.accent}
          style={{ marginTop: 48 }}
        />
      );
    }
    if (timeline.length === 0) {
      return (
        <View style={chatTabS.emptyContainer}>
          <Ionicons name="chatbubble-outline" size={48} color="#3A3A3C" />
          <Text style={chatTabS.emptyTitle}>{den.feed.empty.headline}</Text>
          <Text style={chatTabS.emptySub}>{den.feed.empty.body}</Text>
        </View>
      );
    }
    // Walk the timeline and inject:
    //   - time-cluster headers when the gap between consecutive items is
    //     ≥ 30 minutes
    //   - isGrouped flag on chat messages whose previous neighbor is a
    //     message from the same author within 5 minutes (any non-message
    //     item resets the grouping chain).
    const result: React.ReactNode[] = [];
    let prevSortKey: string | null = null;
    let prevMessageAuthorId: string | null = null;
    let prevMessageAt: number | null = null;

    for (const tlItem of timeline) {
      const itemAt = new Date(tlItem.sortKey).getTime();

      if (prevSortKey !== null) {
        const gapMs = itemAt - new Date(prevSortKey).getTime();
        if (gapMs >= 30 * 60 * 1000) {
          result.push(
            <TimeClusterHeader
              key={`tch-${tlItem.sortKey}-${result.length}`}
              isoString={tlItem.sortKey}
            />,
          );
        }
      }

      let isGrouped = false;
      if (tlItem.kind === "message") {
        if (
          prevMessageAuthorId === tlItem.data.user_id &&
          prevMessageAt !== null &&
          itemAt - prevMessageAt < 5 * 60 * 1000
        ) {
          isGrouped = true;
        }
        prevMessageAuthorId = tlItem.data.user_id;
        prevMessageAt = itemAt;
      } else {
        prevMessageAuthorId = null;
        prevMessageAt = null;
      }

      result.push(
        <TimelineRow
          key={
            tlItem.kind === "activity"
              ? `a-${tlItem.data.id}`
              : `m-${tlItem.data.id}`
          }
          item={tlItem}
          currentUserId={currentUserId}
          isGrouped={isGrouped}
          renderActivity={(feedItem) => {
            const live =
              activityItems.find((i) => i.id === feedItem.id) ?? feedItem;
            return (
              <FeedItemRow
                item={live}
                currentUserId={currentUserId}
                onToggleReaction={toggleReaction}
                onOpenPicker={handleOpenActivityPicker}
                removePhotoFromItem={removePhotoFromItem}
              />
            );
          }}
          onActionMenuOpen={handleActionMenuOpen}
          onOpenPicker={handleOpenMessagePicker}
          onToggleChatReaction={toggleChatReaction}
        />,
      );

      prevSortKey = tlItem.sortKey;
    }

    return result;
  };

  // KeyboardStickyView pins ChatInputBar above the keyboard. Tried the
  // library's KeyboardAvoidingView (which would shrink the message list
  // too), but it hid the input entirely when the keyboard opened.
  // KeyboardStickyView leaves a small cosmetic gap above the keyboard
  // but is otherwise the working state — input visible, tap-through
  // works, send and ⋮ fire on first tap.
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={
          timeline.length === 0 && !loading
            ? chatTabS.contentContainerEmpty
            : { paddingBottom: dynamicPaddingBottom }
        }
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
      >
        {renderListContents()}
      </ScrollView>
      {/* opened offset compensates for the bottom tab nav height (84pt
          iOS / 64pt Android — see app/(app)/_layout.tsx). KeyboardStickyView
          shifts by exactly -keyboardHeight; without this offset it
          overshoots by the tab nav height, leaving a visible gap above
          the keyboard. */}
      <KeyboardStickyView
        offset={{
          closed: 0,
          opened: Platform.OS === "ios" ? 84 : 64,
        }}
      >
        <ChatInputBar
          onSend={handleSend}
          onEdit={handleEdit}
          editingMessage={editingMessage}
          onCancelEdit={() => setEditingMessage(null)}
        />
      </KeyboardStickyView>
      <ReactionPicker
        visible={!!pickerTarget && !!pickerAnchor}
        onClose={closePicker}
        anchorPosition={pickerAnchor ?? { x: 0, y: 0, width: 0, height: 0 }}
        existingReactions={pickerTarget?.existingReactions ?? []}
        onToggle={handlePickerToggle}
      />
      <MessageActionMenu
        visible={!!actionMenuMessage && !!actionMenuAnchor}
        onClose={closeActionMenu}
        anchorPosition={actionMenuAnchor ?? { x: 0, y: 0, width: 0, height: 0 }}
        isOwn={actionMenuMessage?.user_id === currentUserId}
        onEdit={() => {
          if (actionMenuMessage) setEditingMessage(actionMenuMessage);
        }}
        onDelete={() => {
          if (actionMenuMessage) handleDeleteRequest(actionMenuMessage.id);
        }}
      />
    </View>
  );
}

const chatTabS = StyleSheet.create({
  // Used on the ScrollView's contentContainerStyle when timeline is empty,
  // so the empty state renders centered in the full visible area instead
  // of pinned to the top.
  contentContainerEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },
  emptyContainer: {
    paddingVertical: 32,
    paddingHorizontal: 32,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#FFFFFF",
    marginTop: 8,
  },
  emptySub: {
    fontSize: 14,
    color: "#8A8A8E",
    textAlign: "center",
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function PackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  // Pass 24-followup-3 verification round — used by handleBack below.
  const navigation = useNavigation();
  const user = useAuthStore((s) => s.user);
  useRefreshCurrentUserOnFocus();
  const { isPro } = useIsPro();
  const { data: packData, isLoading: packLoading, refetch: refetchPack } = usePack(id ?? null);
  const { syncNow } = useHealthKit(user?.id ?? null);

  // Categories-pivot standings (Stage 3d) — feeds PackGridView's GridEntry[].
  const { data: categoryStandings } = usePackCategoryStandings(
    packData?.pack.id ?? "",
    packData?.activeRun?.id ?? null,
    packData?.pack.timezone ?? "UTC",
    (packData?.members ?? []).map((m) => m.user_id),
  );

  const { width: screenWidth } = useWindowDimensions();
  const { top: topInset } = useSafeAreaInsets();
  const pageScrollRef = React.useRef<ScrollView>(null);
  const scrollX = React.useRef(new Animated.Value(0)).current;

  const TAB_ORDER: TabId[] = ["compete", "chat", "history"];

  const [scores, setScores] = useState<MemberScore[]>([]);
  const [scoresLoading, setScoresLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("compete");

  // Pack lifecycle state
  const [isCreator, setIsCreator] = useState(false);
  const [showPackMenu, setShowPackMenu] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTransferPicker, setShowTransferPicker] = useState(false);
  const [transferTarget, setTransferTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Pass 21c-followup: read-only modals (e.g., app/user/[id].tsx) signal
  // via consumeSuppressFlag() that no parent mutation occurred — skip the
  // tab-reset AND the refetch for one cycle. Default behavior on every
  // OTHER focus event (initial pack navigation, return from a mutating
  // modal like Pack Edit, swipe-back from another screen) is unchanged.
  //
  // The flag is consumed exactly ONCE per dismiss. We combine the two
  // focus side effects (tab-reset + refetch) into a single useFocusEffect
  // so a single consumeSuppressFlag() call gates both — splitting them
  // would have the first call drain the flag and the second see false,
  // breaking the suppression for whichever effect runs second.
  //
  // ⚠️ DO NOT simplify away the flag check here. The whole point is that
  // dismissing a read-only modal (chat avatar → profile, leaderboard
  // avatar → profile) should NOT reset the tab to Compete or refetch
  // pack data. Removing the gate regresses Pass 21c-followup.
  const consumeSuppressFlag = useConsumeSuppressFlag();
  useFocusEffect(
    useCallback(() => {
      if (consumeSuppressFlag()) return;
      // Reset to Compete tab + scroll pager to x=0
      setActiveTab("compete");
      pageScrollRef.current?.scrollTo({ x: 0, animated: false });
      // Refetch pack data so name/goal-target edits made via the Edit
      // Pack modal show immediately on dismissal.
      refetchPack();
    }, [refetchPack, consumeSuppressFlag]),
  );

  // Belt-and-suspenders: also snap the pager to x=0 on mount. The
  // useFocusEffect above runs on every focus, but on the very first
  // focus pageScrollRef.current can be null (the ref attaches after
  // layout), making its scrollTo a no-op. This effect runs once after
  // first commit, when the ref is guaranteed populated.
  useEffect(() => {
    pageScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, []);

  // Dismiss the keyboard whenever the user moves away from the Chat tab,
  // either by swipe or by tapping a different label. Without this, the
  // keyboard stays up while a different tab is showing, which feels
  // wrong (the input is no longer visible).
  useEffect(() => {
    if (activeTab !== "chat") {
      Keyboard.dismiss();
    }
  }, [activeTab]);

  // Determine if current user is the pack creator
  useEffect(() => {
    if (!user?.id || !id) return;
    canUserDeletePack(user.id, id)
      .then(setIsCreator)
      .catch(() => {});
  }, [user?.id, id]);

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

  // ── Fetch scores: today's detail rows ────────────────────────────────

  const fetchWeekly = useCallback(async (runId: string) => {
    // Pass F.1.b: wait for the pack's timezone to hydrate before issuing
    // the today-scoped query. Without this guard, the very first render's
    // closure captures packData=undefined → today defaults to UTC's date,
    // which mismatches the score_date written by sync functions using the
    // pack's actual timezone — scoreById then misses today's row.
    if (!packData?.pack.timezone) return;
    const today = packToday(packData.pack.timezone);

    // Today's daily detail rows (goal flags, counts, streak) — feeds the
    // PackGridView leaderboard via scores → scoreById → gridEntries.
    const todayResult = await supabase
      .from("daily_scores")
      .select(SCORE_SELECT)
      .eq("run_id", runId)
      .eq("score_date", today);

    if (todayResult.error) {
      console.error("[fetchWeekly] today query failed:", todayResult.error);
    }

    setScores(
      todayResult.data ? mapRows(todayResult.data as ScoreRow[], {}) : [],
    );
    setScoresLoading(false);
  }, [packData?.pack.timezone]);

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
    return subscribeToRunScores(runId, () => fetchWeekly(runId), "pack");
  }, [packData?.activeRun?.id, fetchWeekly]);

  // ── Refetch after any activity log (belt-and-suspenders alongside realtime) ──
  const logVersion = useScoreStore((s) => s.logVersion);
  useEffect(() => {
    if (logVersion > 0 && packData?.activeRun) {
      fetchWeekly(packData.activeRun.id);
    }
  }, [logVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleInvite = () => {
    if (!packData?.pack.invite_code) return;
    const memberLimit = isPro ? PRO_MEMBER_LIMIT : FREE_MEMBER_LIMIT;
    if (!isPro && (packData.memberCount ?? 0) >= memberLimit) {
      analytics.gateHit("member_limit");
      router.push("/paywall?trigger=member_limit");
      return;
    }
    setShowInviteSheet(true);
  };

  // ── Derived ───────────────────────────────────────────────────────────

  // Build a name map from packData.members — the pack_members→users join is
  // the reliable post-RLS-fix source of truth for display names.
  // At runtime PostgREST returns the key as "users" (table name), not "user".
  const memberNameMap = new Map<string, string>();
  const memberAvatarMap = new Map<string, string | null>();
  (packData?.members ?? []).forEach((m) => {
    const u = (
      m as unknown as {
        users: { display_name: string; avatar_url: string | null } | null;
      }
    ).users;
    if (u?.display_name) memberNameMap.set(m.user_id, u.display_name);
    memberAvatarMap.set(m.user_id, u?.avatar_url ?? null);
  });

  // Apply names and avatars to scores fetched today
  const namedScores: MemberScore[] = scores.map((s) => ({
    ...s,
    display_name: memberNameMap.get(s.user_id) ?? s.display_name,
    avatar_url: memberAvatarMap.get(s.user_id) ?? null,
  }));

  // Today's scores keyed by user — gridEntries reads streak_days from this.
  const scoreById = new Map(namedScores.map((s) => [s.user_id, s]));

  // ── Categories-pivot grid entries (Stage 3d) ──────────────────────────
  // PackGridView consumes a categories-shaped GridEntry[]. Build it from
  // usePack members + usePackCategoryStandings: total wins / wins-by-
  // category from rankedMembers, today's per-category values + leader
  // flags from todayByCategory, streak from today's daily_scores row.
  // Ranking is inlined: total_wins desc, streak_days desc, display_name
  // asc. Competition
  // ranks — genuine ties share a rank and the next rank skips (1,1,3,3).
  let gridEntries: GridEntry[] = [];
  if (categoryStandings) {
    const winsById = new Map(
      categoryStandings.memberWins.map((w) => [w.userId, w]),
    );
    gridEntries = (packData?.members ?? []).map((m) => {
      const wins = winsById.get(m.user_id);
      const today_values = {} as Record<Category, number>;
      const is_today_leader_in: Category[] = [];
      for (const category of CATEGORIES) {
        const standing = categoryStandings.todayByCategory[category];
        today_values[category] = standing.todayValuesByUser[m.user_id] ?? 0;
        if (standing.todayLeaderIds.includes(m.user_id)) {
          is_today_leader_in.push(category);
        }
      }
      return {
        user_id: m.user_id,
        display_name: memberNameMap.get(m.user_id) ?? "",
        avatarUrl: memberAvatarMap.get(m.user_id) ?? null,
        rank: 0,
        total_wins: wins?.totalWins ?? 0,
        wins_by_category:
          wins?.winsByCategory ??
          ({ steps: 0, workouts: 0, calories: 0, water: 0 } as Record<
            Category,
            number
          >),
        today_values,
        is_today_leader_in,
        streak_days: scoreById.get(m.user_id)?.streak_days ?? 0,
      };
    });

    gridEntries.sort((a, b) => {
      if (b.total_wins !== a.total_wins) return b.total_wins - a.total_wins;
      if (b.streak_days !== a.streak_days) return b.streak_days - a.streak_days;
      return a.display_name.localeCompare(b.display_name);
    });
    for (let i = 0; i < gridEntries.length; i++) {
      gridEntries[i].rank =
        i > 0 && gridEntries[i].total_wins === gridEntries[i - 1].total_wins
          ? gridEntries[i - 1].rank
          : i + 1;
    }
  }

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
          {/* Pack tab is `href: null` (hidden from tab bar). router.replace
              from inside it switches active tab but leaves the tab's nested
              state intact — so a later push reconstitutes the prior pack
              underneath. Imperative dispatch on the parent (Tabs) navigator
              with a FRESH key on the pack route forces React Navigation to
              discard cached nested state. Same-key reset only clears params,
              not the state restoration. Pattern is mirrored in the leave
              and delete handlers below. */}
          <Pressable
            onPress={() => {
              const parent = navigation.getParent();
              if (!parent) {
                router.replace("/(app)/home");
                return;
              }
              const pre = parent.getState();
              const homeIndex = pre.routes.findIndex((r) => r.name === "home");
              parent.dispatch(
                CommonActions.reset({
                  ...pre,
                  index: homeIndex >= 0 ? homeIndex : 0,
                  routes: pre.routes.map((r) =>
                    r.name === "pack"
                      ? {
                          name: "pack",
                          key: `pack-${Math.random().toString(36).slice(2)}`,
                        }
                      : r,
                  ),
                }),
              );
            }}
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
          <View style={s.headerActions}>
            <TouchableOpacity onPress={handleInvite} style={s.inviteBtn}>
              <Ionicons
                name="person-add-outline"
                size={20}
                color={C.textPrimary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowPackMenu(true)}
              style={s.inviteBtn}
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={20}
                color={C.textPrimary}
              />
            </TouchableOpacity>
          </View>
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
        // "handled" lets descendants like the chat send button + ⋮ icon
        // receive their first tap when the keyboard is open. Default
        // "never" would cause the pager (the outermost ScrollView ancestor
        // of every Pressable on the chat tab) to dismiss the keyboard
        // before the tap propagates, swallowing the action.
        keyboardShouldPersistTaps="handled"
      >
        {/* ── PAGE 0: COMPETE ────────────────────────────────────────── */}
        <ScrollView
          style={{ width: screenWidth }}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          {scoresLoading ? (
            <View style={s.loadingBox}>
              <ActivityIndicator size="small" color={C.textTertiary} />
            </View>
          ) : packData.activeRun ? (
            <PackGridView
              entries={gridEntries}
              pack={pack}
              activeRun={packData.activeRun}
              currentUserId={user?.id}
              onInvite={handleInvite}
            />
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* ── PAGE 1: CHAT ───────────────────────────────────────────── */}
        {/* ChatTab manages its own internal scroll + KeyboardAvoidingView,
            so the page slot is a flex column rather than a ScrollView. */}
        <View style={{ width: screenWidth, flex: 1 }}>
          <ChatTab packId={pack.id} currentUserId={user?.id} />
        </View>

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
            categoryStandings={categoryStandings}
            pack={pack}
            memberNameMap={memberNameMap}
            isPro={isPro}
          />
          <View style={{ height: 40 }} />
        </ScrollView>
      </ScrollView>

      {/* ── Pack action menu ─────────────────────────────────────────── */}
      <Modal
        visible={showPackMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPackMenu(false)}
      >
        <Pressable style={s.menuOverlay} onPress={() => setShowPackMenu(false)}>
          <View style={s.menuSheet}>
            <TouchableOpacity
              style={s.menuRow}
              onPress={() => {
                setShowPackMenu(false);
                setShowRules(true);
              }}
            >
              <Ionicons
                name="help-circle-outline"
                size={18}
                color={C.textSecondary}
              />
              <Text style={s.menuRowText}>How it works</Text>
            </TouchableOpacity>
            <View style={s.menuDivider} />
            {isCreator ? (
              <>
                <TouchableOpacity
                  style={s.menuRow}
                  onPress={() => {
                    setShowPackMenu(false);
                    router.push(`/(app)/pack/edit/${pack.id}` as any);
                  }}
                >
                  <Ionicons
                    name="create-outline"
                    size={18}
                    color={C.textSecondary}
                  />
                  <Text style={s.menuRowText}>{packEdit.menu.label}</Text>
                </TouchableOpacity>
                <View style={s.menuDivider} />
                <TouchableOpacity
                  style={s.menuRow}
                  onPress={() => {
                    setShowPackMenu(false);
                    setShowTransferPicker(true);
                  }}
                >
                  <Ionicons
                    name="person-add-outline"
                    size={18}
                    color={C.textSecondary}
                  />
                  <Text style={s.menuRowText}>Transfer Ownership</Text>
                </TouchableOpacity>
                <View style={s.menuDivider} />
                <TouchableOpacity
                  style={s.menuRow}
                  onPress={() => {
                    setShowPackMenu(false);
                    setShowDeleteConfirm(true);
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color={C.danger} />
                  <Text style={[s.menuRowText, s.menuRowTextDanger]}>
                    Delete Pack
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={s.menuRow}
                onPress={() => {
                  setShowPackMenu(false);
                  setShowLeaveConfirm(true);
                }}
              >
                <Ionicons name="exit-outline" size={18} color={C.danger} />
                <Text style={[s.menuRowText, s.menuRowTextDanger]}>
                  Leave Pack
                </Text>
              </TouchableOpacity>
            )}
            <View style={s.menuDivider} />
            <TouchableOpacity
              style={s.menuRow}
              onPress={() => setShowPackMenu(false)}
            >
              <Text style={s.menuRowText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* ── Rules / "How it works" sheet ──────────────────────────────── */}
      <RulesSheet
        visible={showRules}
        onClose={() => setShowRules(false)}
        pack={pack}
      />

      {/* ── Invite sheet ──────────────────────────────────────────────── */}
      <InviteSheet
        visible={showInviteSheet}
        onClose={() => setShowInviteSheet(false)}
        packName={pack.name}
        inviteCode={pack.invite_code}
        memberCount={packData.memberCount ?? 0}
        memberLimit={isPro ? PRO_MEMBER_LIMIT : FREE_MEMBER_LIMIT}
      />

      {/* ── Leave pack confirmation ───────────────────────────────────── */}
      <ConfirmDialog
        visible={showLeaveConfirm}
        title="Leave this pack?"
        message="You'll stop competing in this pack and no longer see this pack's feed. Your history stays if you rejoin later."
        confirmLabel="Leave"
        confirmDestructive
        onConfirm={async () => {
          if (!user?.id || !id) return;
          try {
            // Pass 9 funnel — capture pack_left properties BEFORE the leave,
            // since some queries (joined_at, points totals) require the
            // membership row that the leave call deactivates.
            const [memberRes, pointsRes] = await Promise.all([
              supabase
                .from("pack_members")
                .select("joined_at")
                .eq("pack_id", id)
                .eq("user_id", user.id)
                .maybeSingle(),
              supabase
                .from("daily_scores")
                .select("total_points, runs!inner(pack_id)")
                .eq("user_id", user.id)
                .eq("runs.pack_id", id),
            ]);
            const { count: memberCount } = await supabase
              .from("pack_members")
              .select("id", { count: "exact", head: true })
              .eq("pack_id", id)
              .eq("is_active", true);
            const joinedAt = memberRes.data?.joined_at as string | undefined;
            const daysInPack = joinedAt
              ? Math.max(0, Math.floor((Date.now() - new Date(joinedAt).getTime()) / 86400000))
              : 0;
            const pointsEarned = (pointsRes.data ?? []).reduce(
              (sum, row: { total_points: number | null }) => sum + (row.total_points ?? 0),
              0,
            );

            await leavePack(user.id, id);

            analytics.packLeft({
              pack_member_count_at_leave: memberCount ?? 0,
              days_in_pack: daysInPack,
              points_earned_in_pack: pointsEarned,
            });

            setShowLeaveConfirm(false);
            showToast({ message: "Left pack", kind: "success" });
            // See Back handler above for the why behind the fresh-key reset.
            const parent = navigation.getParent();
            if (!parent) {
              router.replace("/(app)/home");
              return;
            }
            const pre = parent.getState();
            const homeIndex = pre.routes.findIndex((r) => r.name === "home");
            parent.dispatch(
              CommonActions.reset({
                ...pre,
                index: homeIndex >= 0 ? homeIndex : 0,
                routes: pre.routes.map((r) =>
                  r.name === "pack"
                    ? {
                        name: "pack",
                        key: `pack-${Math.random().toString(36).slice(2)}`,
                      }
                    : r,
                ),
              }),
            );
          } catch (err: unknown) {
            setShowLeaveConfirm(false);
            const msg =
              err instanceof Error ? err.message : "Could not leave pack.";
            Alert.alert("Cannot leave", msg);
          }
        }}
        onCancel={() => setShowLeaveConfirm(false)}
      />

      {/* ── Delete pack confirmation ──────────────────────────────────── */}
      <ConfirmDialog
        visible={showDeleteConfirm}
        title="Delete this pack?"
        message="This permanently deletes the pack for everyone. All activity, wins, and photos will be lost. This cannot be undone."
        confirmLabel="Delete"
        confirmDestructive
        onConfirm={async () => {
          if (!user?.id || !id) return;
          try {
            // Pass 9 funnel — capture pack_deleted properties BEFORE the
            // cascade delete wipes the data sources. total_activities_in_pack
            // is a COUNT against activity_feed for this pack — cheap, but if
            // it ever becomes expensive on a busy pack, drop to null.
            const [packRes, memberCountRes, activityCountRes] = await Promise.all([
              supabase.from("packs").select("created_at").eq("id", id).maybeSingle(),
              supabase
                .from("pack_members")
                .select("id", { count: "exact", head: true })
                .eq("pack_id", id)
                .eq("is_active", true),
              supabase
                .from("activity_feed")
                .select("id", { count: "exact", head: true })
                .eq("pack_id", id),
            ]);
            const createdAt = packRes.data?.created_at as string | undefined;
            const daysExisted = createdAt
              ? Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000))
              : 0;

            await deletePack(id, user.id);

            analytics.packDeleted({
              pack_member_count_at_deletion: memberCountRes.count ?? 0,
              days_pack_existed: daysExisted,
              pack_was_owner: true,
              total_activities_in_pack: activityCountRes.count ?? null,
            });

            setShowDeleteConfirm(false);
            showToast({ message: "Pack deleted", kind: "success" });
            // See Back handler above for the why behind the fresh-key reset.
            const parent = navigation.getParent();
            if (!parent) {
              router.replace("/(app)/home");
              return;
            }
            const pre = parent.getState();
            const homeIndex = pre.routes.findIndex((r) => r.name === "home");
            parent.dispatch(
              CommonActions.reset({
                ...pre,
                index: homeIndex >= 0 ? homeIndex : 0,
                routes: pre.routes.map((r) =>
                  r.name === "pack"
                    ? {
                        name: "pack",
                        key: `pack-${Math.random().toString(36).slice(2)}`,
                      }
                    : r,
                ),
              }),
            );
          } catch (err: unknown) {
            setShowDeleteConfirm(false);
            const msg =
              err instanceof Error ? err.message : "Could not delete pack.";
            Alert.alert("Delete failed", msg);
          }
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* ── Transfer ownership — member picker ───────────────────────── */}
      <Modal
        visible={showTransferPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTransferPicker(false)}
      >
        <Pressable
          style={s.menuOverlay}
          onPress={() => setShowTransferPicker(false)}
        >
          <View style={[s.menuSheet, { paddingBottom: 24 }]}>
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: C.textSecondary,
                paddingHorizontal: 16,
                paddingBottom: 8,
              }}
            >
              Transfer ownership to…
            </Text>
            {(packData?.members ?? [])
              .filter((m) => m.user_id !== user?.id && m.is_active)
              .map((m) => {
                const name = memberNameMap.get(m.user_id) ?? "Member";
                return (
                  <TouchableOpacity
                    key={m.user_id}
                    style={s.menuRow}
                    onPress={() => {
                      setTransferTarget({ id: m.user_id, name });
                      setShowTransferPicker(false);
                    }}
                  >
                    <Ionicons
                      name="person-outline"
                      size={18}
                      color={C.textSecondary}
                    />
                    <Text style={s.menuRowText}>{name}</Text>
                  </TouchableOpacity>
                );
              })}
            <View style={s.menuDivider} />
            <TouchableOpacity
              style={s.menuRow}
              onPress={() => setShowTransferPicker(false)}
            >
              <Text style={s.menuRowText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* ── Transfer ownership — confirm ──────────────────────────────── */}
      <ConfirmDialog
        visible={transferTarget !== null}
        title="Transfer ownership?"
        message={t(den.transferConfirm, {
          name: transferTarget?.name ?? "This member",
        })}
        confirmLabel="Transfer"
        onConfirm={async () => {
          if (!user?.id || !id || !transferTarget) return;
          const target = transferTarget;
          setTransferTarget(null);
          try {
            await transferPackOwnership(id, target.id);
            setIsCreator(false);
            const actorName = packData?.pack
              ? (memberNameMap.get(user.id) ?? "Someone")
              : "Someone";
            await notifyUser(target.id, actorName, id, {
              kind: "ownership_transferred",
              newOwnerName: target.name,
            });
            showToast({ message: "Ownership transferred", kind: "success" });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Transfer failed.";
            Alert.alert("Transfer failed", msg);
          }
        }}
        onCancel={() => setTransferTarget(null)}
      />
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  menuSheet: {
    backgroundColor: C.surfaceRaised,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: C.border,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  menuRowText: {
    fontSize: 16,
    fontWeight: "500",
    color: C.textPrimary,
  },
  menuRowTextDanger: {
    color: C.danger,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
  },
});
