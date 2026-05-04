import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { PackMemberDisplay } from "./PackMemberDisplay";
import { POINTS, WORKOUT_MAX_DAILY } from "../lib/scoring";
import { showToast } from "../lib/toast";
import type { Pack, Run } from "../types/database";
import { colors } from "../theme/colors";
import { activity, den, t } from "../constants/strings";
import { formatName } from "../lib/displayName";

// Android requires this experimental flag for LayoutAnimation. iOS no-op.
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: colors.self,
  streak: "#FF9500",
} as const;

// ── Local helpers ──────────────────────────────────────────────────────────
// Inlined from pack/[id].tsx so the grid is a self-contained component.
// Mirrors the math used by the existing podium rings.

function maxPossiblePointsForPack(pack: Pack): number {
  let pts = 0;
  if (pack.steps_enabled) pts += POINTS.steps;
  if (pack.workouts_enabled) pts += POINTS.workout * WORKOUT_MAX_DAILY;
  if (pack.calories_enabled) pts += POINTS.calories;
  if (pack.water_enabled) pts += POINTS.water;
  return pts;
}

function maxRunPoints(pack: Pack, run: Run): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const total =
    Math.round(
      (new Date(run.end_date + "T12:00:00").getTime() -
        new Date(run.start_date + "T12:00:00").getTime()) /
        msPerDay,
    ) + 1;
  return maxPossiblePointsForPack(pack) * Math.max(1, total);
}

function ringPct(weeklyPoints: number, pack: Pack, run: Run): number {
  const max = maxRunPoints(pack, run);
  if (max === 0) return 0;
  return Math.min(100, Math.round((weeklyPoints / max) * 100));
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface GridEntry {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
  weekly_points: number;
  rank: number;
  streak_days: number;
  // Fields below are consumed by the inline RankRowExpanded breakdown.
  // Source: MemberScore (rankWithTiebreakers output) — already present.
  streak_multiplier: number;
  steps_achieved: boolean;
  workout_achieved: boolean;
  calories_achieved: boolean;
  water_achieved: boolean;
  steps_count: number;
  calories_count: number;
  water_oz_count: number;
  workout_count: number;
}

interface RankGroup {
  rank: number;
  members: GridEntry[];
  isTied: boolean;
  pointsBehindLeader: number;
}

interface Props {
  entries: GridEntry[];
  pack: Pack;
  activeRun: Run;
  currentUserId: string | undefined;
  onInvite: () => void;
}

// ── Main component ─────────────────────────────────────────────────────────

export function PackGridView({
  entries,
  pack,
  activeRun,
  currentUserId,
  onInvite,
}: Props) {
  // Single-expand: at most one row open at a time. Toggle via tap.
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const toggleExpand = useCallback((userId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedUserId((cur) => (cur === userId ? null : userId));
  }, []);
  const totalMembers = entries.length;
  const leaderId = useMemo(
    () => entries.find((e) => e.rank === 1)?.user_id,
    [entries],
  );

  // Group all entries by rank for the unified vertical list. Phase 2.0
  // removed the FeaturedTile/FeaturedSplit hero block — every member,
  // including rank 1, renders in this list.
  // pointsBehindLeader = leader's pts (entries[0]) − this group's pts.
  // Members within a group are sorted alphabetically (mirrors tie order).
  const rankGroups = useMemo<RankGroup[]>(() => {
    const leaderPoints =
      entries.length > 0 ? entries[0].weekly_points : 0;
    const grouped: Record<number, GridEntry[]> = {};
    entries.forEach((entry) => {
      if (!grouped[entry.rank]) grouped[entry.rank] = [];
      grouped[entry.rank].push(entry);
    });
    return Object.keys(grouped)
      .map(Number)
      .sort((a, b) => a - b)
      .map((rank) => {
        const members = grouped[rank].sort((a, b) =>
          a.display_name
            .toLowerCase()
            .localeCompare(b.display_name.toLowerCase()),
        );
        return {
          rank,
          members,
          isTied: members.length > 1,
          pointsBehindLeader: leaderPoints - members[0].weekly_points,
        };
      });
  }, [entries]);

  // Solo-pack: replace the rank list entirely with an invite-first hero +
  // a non-competitive "your activity today" readout. Keeps the user's blue
  // self-accent (still identifies them) but drops rank/crown/gold treatment.
  if (totalMembers === 1) {
    return (
      <View style={s.container}>
        <SoloPackHero
          entry={entries[0]}
          pack={pack}
          activeRun={activeRun}
          currentUserId={currentUserId}
          onInvite={onInvite}
        />
      </View>
    );
  }

  // 2+ members: existing grouped rank-list layout. Unchanged.
  return (
    <View style={s.container}>
      {rankGroups.length > 0 && (
        <View style={s.listContainer}>
          {rankGroups.map((group, groupIdx) => (
            <View key={group.rank}>
              {groupIdx > 0 && <View style={s.groupDivider} />}
              <RankGroupHeader
                isTied={group.isTied}
                memberCount={group.members.length}
                pointsBehindLeader={group.pointsBehindLeader}
              />
              {group.members.map((entry) => (
                <View key={entry.user_id}>
                  <RankRow
                    entry={entry}
                    pack={pack}
                    activeRun={activeRun}
                    currentUserId={currentUserId}
                    leaderId={leaderId}
                    isExpanded={expandedUserId === entry.user_id}
                    onPress={() => toggleExpand(entry.user_id)}
                  />
                  {expandedUserId === entry.user_id && (
                    <RankRowExpanded
                      entry={entry}
                      currentUserId={currentUserId}
                      pack={pack}
                    />
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Rank group header ──────────────────────────────────────────────────────
// Renders above each group of rows ONLY when the group is tied. Solo ranks
// have no header — the row's own #X cell speaks for itself. Tied groups
// show "TIED · N way" on the left and "{gap} pts behind" on the right when
// not the leader group.

function RankGroupHeader({
  isTied,
  memberCount,
  pointsBehindLeader,
}: {
  isTied: boolean;
  memberCount: number;
  pointsBehindLeader: number;
}) {
  // Solo rank = no header. The row's prominent #X cell carries the rank.
  if (!isTied) return null;
  const tieLabel =
    memberCount > 2 ? `TIED · ${memberCount} way` : "TIED";
  return (
    <View style={s.groupHeader}>
      <Text style={s.groupHeaderText}>{tieLabel}</Text>
      {pointsBehindLeader > 0 && (
        <Text style={s.groupHeaderGap}>{pointsBehindLeader} pts behind</Text>
      )}
    </View>
  );
}

// ── Rank row ───────────────────────────────────────────────────────────────
// Single member row. Layout: prominent #X cell, ring, name+streak, pts.
// Rank 1 gets a larger ring (80pt vs 70pt) and a 👑 prefix on the name.
// Self-row always gets a blue left accent bar; non-self rows get one only
// when expanded — gold for rank-1, blue for everyone else.

function RankRow({
  entry,
  pack,
  activeRun,
  currentUserId,
  leaderId,
  isExpanded,
  onPress,
}: {
  entry: GridEntry;
  pack: Pack;
  activeRun: Run;
  currentUserId: string | undefined;
  leaderId: string | undefined;
  isExpanded: boolean;
  onPress: () => void;
}) {
  const isMe = entry.user_id === currentUserId;
  const isLeader = entry.rank === 1;
  // Bar visibility: self always; otherwise only when expanded.
  // Bar color: blue for self (always wins) and for non-leader expanded;
  // gold only when expanded AND rank === 1 AND not self.
  const showBar = isMe || isExpanded;
  const useLeaderBarColor = !isMe && isLeader && isExpanded;
  const ringSize = isLeader ? 80 : 70;
  const ringStroke = isLeader ? 8 : 7;
  const pct = ringPct(entry.weekly_points, pack, activeRun);
  return (
    <TouchableOpacity
      style={[
        s.row,
        showBar && s.rowAccentBar,
        showBar && useLeaderBarColor && { borderLeftColor: colors.leader },
      ]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <Text
        style={[s.rowRank, isLeader ? s.rowRankLeader : s.rowRankNormal]}
      >
        #{entry.rank}
      </Text>
      <View style={s.rowAvatar}>
        <PackMemberDisplay
          userId={entry.user_id}
          displayName={entry.display_name}
          progressPct={pct}
          // rank > 3 suppresses PackMemberDisplay's built-in rank badge.
          // The row's #X cell carries the rank.
          rank={4}
          currentUserId={currentUserId}
          leaderId={leaderId}
          size={ringSize}
          strokeWidth={ringStroke}
          showName={false}
          avatarUrl={entry.avatar_url}
        />
      </View>
      <View style={s.rowCenter}>
        <Text style={[s.rowName, isMe && s.nameSelf]} numberOfLines={1}>
          {isLeader && "👑 "}
          {formatName(entry.display_name)}
        </Text>
        {entry.streak_days > 0 && (
          <Text style={s.rowStreak}>🔥 {entry.streak_days}</Text>
        )}
      </View>
      <Text style={s.rowPts}>{entry.weekly_points} pts</Text>
    </TouchableOpacity>
  );
}

// ── Inline expansion (per-member goal breakdown) ───────────────────────────
// Renders below the corresponding row when expanded. Shows streak header (if
// any), then one row per goal the pack tracks. Self-row's accent bar extends
// through the expansion via `isMe`.

function RankRowExpanded({
  entry,
  currentUserId,
  pack,
}: {
  entry: GridEntry;
  currentUserId: string | undefined;
  pack: Pack;
}) {
  const isMe = entry.user_id === currentUserId;
  const useLeaderAccent = !isMe && entry.rank === 1;
  const multiplier = entry.streak_multiplier ?? 1;
  const showStreak = entry.streak_days > 0;

  type Goal = {
    label: string;
    pct: number; // 0-100, capped
    ratio: string;
  };
  const goals: Goal[] = [];
  let earnedSum = 0;

  if (pack.steps_enabled) {
    const pct =
      pack.step_target > 0
        ? Math.min(100, (entry.steps_count / pack.step_target) * 100)
        : 0;
    goals.push({
      label: "Steps",
      pct,
      ratio: `${entry.steps_count.toLocaleString()} / ${pack.step_target.toLocaleString()}`,
    });
    if (entry.steps_achieved) earnedSum += POINTS.steps * multiplier;
  }
  if (pack.workouts_enabled) {
    const cappedCount = Math.min(entry.workout_count, WORKOUT_MAX_DAILY);
    goals.push({
      label: "Workout",
      pct: (cappedCount / WORKOUT_MAX_DAILY) * 100,
      ratio: `${entry.workout_count} / ${WORKOUT_MAX_DAILY}`,
    });
    if (entry.workout_count > 0) {
      earnedSum += POINTS.workout * cappedCount * multiplier;
    }
  }
  if (pack.calories_enabled) {
    const pct =
      pack.calorie_target > 0
        ? Math.min(100, (entry.calories_count / pack.calorie_target) * 100)
        : 0;
    goals.push({
      label: "Calories",
      pct,
      ratio: `${entry.calories_count} / ${pack.calorie_target}`,
    });
    if (entry.calories_achieved) earnedSum += POINTS.calories * multiplier;
  }
  if (pack.water_enabled) {
    const pct =
      pack.water_target_oz > 0
        ? Math.min(100, (entry.water_oz_count / pack.water_target_oz) * 100)
        : 0;
    goals.push({
      label: "Water",
      pct,
      ratio: `${entry.water_oz_count} / ${pack.water_target_oz} oz`,
    });
    if (entry.water_achieved) earnedSum += POINTS.water * multiplier;
  }

  const totalEarned = Math.round(earnedSum);

  return (
    <View
      style={[
        s.expanded,
        useLeaderAccent && { borderLeftColor: colors.leader },
      ]}
    >
      {showStreak && (
        <Text style={s.expandedStreak}>
          {entry.streak_days === 1
            ? activity.streak.day
            : t(activity.streak.days, { count: entry.streak_days })}
          {" · "}
          {t(activity.streak.multiplier, { multiplier })}
        </Text>
      )}
      {goals.map((g) => (
        <View key={g.label} style={s.goalRow}>
          <Text style={s.goalLabel}>{g.label}</Text>
          <View
            style={[s.goalBarTrack, g.pct > 0 && s.goalBarTrackFilled]}
          >
            {g.pct > 0 && (
              <View style={[s.goalBarFill, { width: `${g.pct}%` }]} />
            )}
          </View>
          <Text style={s.goalRatio}>{g.ratio}</Text>
        </View>
      ))}
      {totalEarned > 0 && (
        <Text style={s.totalEarned}>+{totalEarned} pts today</Text>
      )}
    </View>
  );
}

// ── Solo-pack hero ─────────────────────────────────────────────────────────
// Renders when the pack has exactly one member (the current user). Replaces
// the competitive rank list with an invite-first card + a non-competitive
// "your activity today" readout. The pill-styled invite code reuses the
// pack-level Share flow on tap (no separate clipboard dependency wired up).

function SoloPackHero({
  entry,
  pack,
  activeRun,
  currentUserId,
  onInvite,
}: {
  entry: GridEntry;
  pack: Pack;
  activeRun: Run;
  currentUserId: string | undefined;
  onInvite: () => void;
}) {
  const inviteCode = pack.invite_code;
  const pct = ringPct(entry.weekly_points, pack, activeRun);
  return (
    <>
      <View style={s.heroCard}>
        <Text style={s.heroTitle}>{den.solo.heroTitle}</Text>
        <Text style={s.heroSubtitle}>{den.solo.heroSubtitle}</Text>
        <TouchableOpacity
          style={s.heroCta}
          onPress={onInvite}
          activeOpacity={0.85}
        >
          <Text style={s.heroCtaText}>+ Invite Friends</Text>
        </TouchableOpacity>
        {inviteCode ? (
          <>
            <Text style={s.heroSecondary}>Or share your code:</Text>
            <TouchableOpacity
              style={s.heroCodePill}
              onPress={async () => {
                await Clipboard.setStringAsync(inviteCode);
                showToast({ message: "Code copied", kind: "success" });
              }}
              activeOpacity={0.7}
            >
              <Text style={s.heroCodeText}>{inviteCode}</Text>
              <Ionicons
                name="copy-outline"
                size={16}
                color="#8A8A8E"
                style={{ marginLeft: 12 }}
              />
            </TouchableOpacity>
          </>
        ) : null}
      </View>

      <Text style={s.soloSectionHeader}>{den.todaysHunt.title}</Text>

      {/* Self-row: blue accent bar stays (still "you"), but no rank cell,
          no crown, and the ring color falls back to self-blue (not gold)
          by passing leaderId={undefined}. */}
      <View style={[s.row, s.rowAccentBar]}>
        <View style={s.rowAvatar}>
          <PackMemberDisplay
            userId={entry.user_id}
            displayName={entry.display_name}
            progressPct={pct}
            // rank > 3 suppresses the built-in rank badge.
            rank={4}
            currentUserId={currentUserId}
            leaderId={undefined}
            size={70}
            strokeWidth={7}
            showName={false}
            avatarUrl={entry.avatar_url}
          />
        </View>
        <View style={s.rowCenter}>
          <Text style={[s.rowName, s.nameSelf]} numberOfLines={1}>
            {formatName(entry.display_name)}
          </Text>
          {entry.streak_days > 0 && (
            <Text style={s.rowStreak}>🔥 {entry.streak_days}</Text>
          )}
        </View>
        <Text style={s.rowPts}>{entry.weekly_points} pts</Text>
      </View>

      {/* Always-visible goal breakdown — no expansion needed in solo mode. */}
      <RankRowExpanded entry={entry} currentUserId={currentUserId} pack={pack} />
    </>
  );
}

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
  },

  // ── Vertical list of rank groups ──
  // Top padding gives breathing room below the tabs since the hero
  // featured-tile block was removed in Phase 2.0.
  listContainer: {
    paddingTop: 24,
  },

  // Hairline above each group header (suppressed for the first group).
  groupDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#2C2C2E",
    marginHorizontal: 16,
    marginTop: 16,
  },
  // Rank group header — rendered above each group of rows. Top padding is
  // smaller than before (24 → 12) because groupDivider+marginTop now provides
  // the visual gap from above.
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  // Tied-group label, e.g. "TIED · 3 way".
  groupHeaderText: {
    fontSize: 13,
    color: C.textSecondary,
  },
  // Display-name color override applied to the current user's name in any
  // row context.
  nameSelf: {
    color: C.accent,
  },
  groupHeaderGap: {
    fontSize: 12,
    color: C.textSecondary,
    marginLeft: "auto",
  },

  // Member row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 16,
  },
  // 3pt accent left bar (color set inline on the parent: blue for
  // self/non-leader-expanded, gold for non-self leader expanded).
  // paddingLeft drops 16 → 13 so the rendered content stays in the same
  // horizontal position.
  rowAccentBar: {
    paddingLeft: 13,
    borderLeftWidth: 3,
    borderLeftColor: C.accent,
  },
  // Prominent rank cell on the left edge of every row.
  rowRank: {
    width: 48,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  rowRankLeader: {
    color: colors.leader,
  },
  rowRankNormal: {
    color: C.textSecondary,
  },
  rowAvatar: {
    marginRight: 14,
  },
  rowCenter: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
    color: C.textPrimary,
  },
  rowStreak: {
    fontSize: 12,
    color: C.streak,
  },
  rowPts: {
    fontSize: 16,
    fontWeight: "600",
    color: C.accent,
    marginLeft: 8,
  },

  // ── Inline expansion (per-member goal breakdown) ──
  // Renders only when expanded, so the accent bar is unconditionally on —
  // it visually continues the rowAccentBar above into the expansion below.
  expanded: {
    paddingVertical: 12,
    paddingLeft: 13,
    paddingRight: 16,
    borderLeftWidth: 3,
    borderLeftColor: C.accent,
  },
  expandedStreak: {
    fontSize: 13,
    color: C.streak,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2C2C2E",
    marginBottom: 10,
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  goalLabel: {
    width: 80,
    fontSize: 14,
    color: C.textPrimary,
  },
  goalBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 12,
    overflow: "hidden",
  },
  // Gray track only renders when there's progress to fill it. At 0% the
  // space is preserved but the track is transparent.
  goalBarTrackFilled: {
    backgroundColor: "#2C2C2E",
  },
  goalBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: C.accent,
  },
  goalRatio: {
    minWidth: 80,
    fontSize: 12,
    color: C.textSecondary,
    textAlign: "right",
  },
  totalEarned: {
    fontSize: 13,
    fontWeight: "600",
    color: C.accent,
    paddingTop: 8,
  },

  // ── Solo-pack hero ──
  heroCard: {
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 32,
    paddingHorizontal: 20,
    backgroundColor: "#1C1C1E",
    borderRadius: 16,
    alignItems: "center",
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    color: "#8A8A8E",
    marginBottom: 24,
    textAlign: "center",
  },
  heroCta: {
    alignSelf: "stretch",
    paddingVertical: 14,
    backgroundColor: "#0A84FF",
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 16,
  },
  heroCtaText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  heroSecondary: {
    fontSize: 13,
    color: "#8A8A8E",
    marginBottom: 8,
  },
  heroCodePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#2C2C2E",
    borderRadius: 8,
  },
  heroCodeText: {
    fontSize: 16,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: "#FFFFFF",
    letterSpacing: 1,
  },
  soloSectionHeader: {
    fontSize: 13,
    fontWeight: "600",
    color: "#8A8A8E",
    paddingHorizontal: 16,
    paddingTop: 32,
    paddingBottom: 12,
  },
});
