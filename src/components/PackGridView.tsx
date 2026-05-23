import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
  Animated,
  Easing,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Crown } from "lucide-react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { PackMemberDisplay } from "./PackMemberDisplay";
import { showToast } from "../lib/toast";
import type { Pack, Run } from "../types/database";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_ICON,
  type Category,
} from "../lib/categories";
import { colors } from "../theme/colors";
import { den } from "../constants/strings";
import { formatName } from "../lib/displayName";

// Android requires this experimental flag for LayoutAnimation. iOS no-op.
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  streak: "#FF9500",
} as const;

// ── Local helpers ──────────────────────────────────────────────────────────

// Ring fill for the categories model. A member's ring shows their share of
// the daily category-contests won so far this run: total_wins / daysElapsed.
// total_wins spans all 4 categories, so a member sweeping every category
// every day can exceed 1.0 — the result is intentionally clamped to 100%.
// daysElapsed is 1-indexed (run start = day 1) and capped at 7 (weekly runs).
// The divisor floor of 1 covers the just-started / clock-skew edge case
// (a fresh run reads as an empty ring for a 0-win member, which is correct).
function ringFillPct(totalWins: number, run: Run): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const start = new Date(run.start_date + "T12:00:00").getTime();
  const rawDays = Math.floor((Date.now() - start) / msPerDay) + 1;
  const daysElapsed = Math.min(7, Math.max(1, rawDays));
  return Math.min(100, Math.max(0, (totalWins / daysElapsed) * 100));
}

// Renders the category icon from the centralized CATEGORY_ICON map
// (single source of truth in src/lib/categories.ts). Branches on the
// map's `lib` field to pick the right @expo/vector-icons family. Used
// inline on the member row's per-category wins line; intentionally
// small (default size 14, textSecondary) so it sits as supporting
// information next to its count, not as a focal point.
function CategoryIcon({
  category,
  size = 14,
  color,
}: {
  category: Category;
  size?: number;
  color: string;
}) {
  const meta = CATEGORY_ICON[category];
  if (meta.lib === "Ionicons") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <Ionicons name={meta.name as any} size={size} color={color} />;
  }
  return (
    <MaterialCommunityIcons
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      name={meta.name as any}
      size={size}
      color={color}
    />
  );
}

// pack enable-flags aren't keyed by Category — map explicitly. The exhaustive
// switch means adding a Category surfaces a compile error here.
function categoryEnabled(pack: Pack, category: Category): boolean {
  switch (category) {
    case "steps":
      return pack.steps_enabled;
    case "workouts":
      return pack.workouts_enabled;
    case "calories":
      return pack.calories_enabled;
    case "water":
      return pack.water_enabled;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface GridEntry {
  user_id: string;
  display_name: string;
  avatarUrl: string | null;
  rank: number;
  total_wins: number;
  wins_by_category: Record<Category, number>;
  today_values: Record<Category, number>;
  is_today_leader_in: Category[];
  streak_days: number;
}

interface RankGroup {
  rank: number;
  members: GridEntry[];
  isTied: boolean;
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

  // Group all entries by rank for the unified vertical list. Every member,
  // including rank 1, renders in this list. Members within a group are
  // sorted alphabetically (mirrors tie order).
  const rankGroups = useMemo<RankGroup[]>(() => {
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
        };
      });
  }, [entries]);

  // Solo-pack: replace the rank list entirely with an invite-first hero +
  // a non-competitive "your activity today" readout. Keeps the user's blue
  // self-accent (still identifies them) but drops rank/crown/gold treatment.
  if (totalMembers === 1) {
    return (
      <View style={s.container}>
        <SoloPackHero entry={entries[0]} pack={pack} onInvite={onInvite} />
      </View>
    );
  }

  // 2+ members: existing grouped rank-list layout. Unchanged.
  return (
    <View style={s.container}>
      {rankGroups.length > 0 && (
        <View style={s.listContainer}>
          {/* Fix 3: section header above the roster — left-aligned as a
              proper section title (not a column label trying to sit over
              the bare-number column). Wording stays dynamic on the
              pack's competition_window so a monthly pack never reads
              "weekly" (and vice-versa). */}
          <View style={s.sectionHeader}>
            <Text style={s.sectionHeaderText}>
              {pack.competition_window === "monthly"
                ? "Monthly stats"
                : "Weekly stats"}
            </Text>
          </View>
          {rankGroups.map((group, groupIdx) => (
            <View key={group.rank}>
              {groupIdx > 0 && <View style={s.groupDivider} />}
              <RankGroupHeader
                isTied={group.isTied}
                memberCount={group.members.length}
              />
              {group.members.map((entry) => (
                <View key={entry.user_id}>
                  <RankRow
                    entry={entry}
                    activeRun={activeRun}
                    currentUserId={currentUserId}
                    isExpanded={expandedUserId === entry.user_id}
                    onPress={() => toggleExpand(entry.user_id)}
                  />
                  {expandedUserId === entry.user_id && (
                    <RankRowExpanded
                      entry={entry}
                      entries={entries}
                      currentUserId={currentUserId}
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
// show "TIED · N way" (or just "TIED" for a 2-way tie).

function RankGroupHeader({
  isTied,
  memberCount,
}: {
  isTied: boolean;
  memberCount: number;
}) {
  // Solo rank = no header. The row's prominent #X cell carries the rank.
  if (!isTied) return null;
  const tieLabel = memberCount > 2 ? `TIED · ${memberCount} way` : "TIED";
  return (
    <View style={s.groupHeader}>
      <Text style={s.groupHeaderText}>{tieLabel}</Text>
    </View>
  );
}

// ── Rank row ───────────────────────────────────────────────────────────────
// Single member row. Layout: prominent #X cell, ring, crown+name / streak,
// wins count. Rank 1 gets a larger ring (80pt vs 70pt). A gold crown
// prefixes the name when the member leads any category TODAY. Self-row
// always gets a blue left accent bar; non-self rows get one only when
// expanded — gold for rank-1, blue for everyone else.

function RankRow({
  entry,
  activeRun,
  currentUserId,
  isExpanded,
  onPress,
}: {
  entry: GridEntry;
  activeRun: Run;
  currentUserId: string | undefined;
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
  // Fix 1: every row uses the same avatar size. The leader's visual
  // distinction now comes only from the gold ring color + the gold #1
  // rank text — not from a larger avatar — so the list reads as a
  // uniform roster instead of one outsized leader.
  const ringSize = 70;
  const ringStroke = 7;
  // Ring fill is the member's wins-share of the run so far (see ringFillPct).
  const pct = ringFillPct(entry.total_wins, activeRun);
  // Crown = leading any category today. One crown regardless of how many.
  const isTodayLeader = entry.is_today_leader_in.length > 0;
  const router = useRouter();
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
      <Text style={[s.rowRank, isLeader ? s.rowRankLeader : s.rowRankNormal]}>
        #{entry.rank}
      </Text>
      {/* Avatar is its own tap target — opens the public user profile
          (Pass 21b). Row body's onPress still toggles the per-category
          breakdown. React Native routes the avatar tap to this child
          handler; row body taps fall through to the parent. */}
      <TouchableOpacity
        style={s.rowAvatar}
        onPress={() => {
          router.push(`/user/${entry.user_id}` as any);
        }}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        <PackMemberDisplay
          userId={entry.user_id}
          displayName={entry.display_name}
          progressPct={pct}
          // rank > 3 suppresses PackMemberDisplay's built-in rank badge.
          // The row's #X cell carries the rank.
          rank={4}
          currentUserId={currentUserId}
          // Change 1: leader avatar uses the same neutral ring as every
          // other member. Gold #1 rank text + gold left accent bar still
          // identify the leader; this avatar ring no longer doubles up.
          leaderId={undefined}
          size={ringSize}
          strokeWidth={ringStroke}
          showName={false}
          avatarUrl={entry.avatarUrl}
        />
      </TouchableOpacity>
      <View style={s.rowCenter}>
        {/* Line 1: name (with the leader-only crown when the member is
            leading any category TODAY). */}
        <View style={s.rowNameLine}>
          {isTodayLeader && (
            <Crown
              size={14}
              color={colors.leader}
              strokeWidth={2}
              style={{ marginRight: 4 }}
            />
          )}
          <Text style={[s.rowName, isMe && s.nameSelf]} numberOfLines={1}>
            {formatName(entry.display_name)}
          </Text>
        </View>
        {/* Line 2: per-category win counts. All four categories shown
            (including zeros) so rows align consistently — BUT when the
            member has no wins at all (total_wins === 0), the four-zero
            row reads cold/empty, so Fix 4 swaps it for a single muted
            line. Icons come from CATEGORY_ICON (single source of
            truth); counts read straight off entry.wins_by_category. */}
        {entry.total_wins === 0 ? (
          <Text style={s.rowNoWins}>No category wins yet</Text>
        ) : (
          <View style={s.rowCategoryWins}>
            {CATEGORIES.map((category, i) => (
              <React.Fragment key={category}>
                {i > 0 && <Text style={s.rowCategorySep}>·</Text>}
                <View style={s.rowCategoryItem}>
                  <CategoryIcon
                    category={category}
                    size={14}
                    color={C.textSecondary}
                  />
                  <Text style={s.rowCategoryCount}>
                    {entry.wins_by_category[category] ?? 0}
                  </Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        )}
        {/* Line 3: streak — slightly de-emphasized supporting info.
            Non-flame glyph (MaterialCommunityIcons "lightning-bolt") so
            it never visually collides with the calories category icon
            (which is "fire" — the de-facto convention). */}
        {entry.streak_days > 0 && (
          <View style={s.rowStreakLine}>
            <MaterialCommunityIcons
              name="lightning-bolt"
              size={11}
              color={C.streak}
            />
            <Text style={s.rowStreak}>{entry.streak_days} day streak</Text>
          </View>
        )}
      </View>
      {/* Right: bare total — just the number. The section header above
          the list ("Weekly stats" / "Monthly stats") gives context. */}
      <Text style={s.rowWins}>{entry.total_wins}</Text>
    </TouchableOpacity>
  );
}

// ── Category bar (animated per-category comparison) ─────────────────────────
// One row in the expanded breakdown. The member's value is drawn as a bar
// scaled against TODAY's leading value for that category: the category
// leader gets a full gold bar, everyone else scales in blue. A category
// nobody has logged yet (leaderValue 0) shows an empty track.
// Animation mirrors the prior GoalRow pattern (350ms, JS-thread width).
function CategoryBar({
  category,
  memberValue,
  leaderValue,
  isLeader,
}: {
  category: Category;
  memberValue: number;
  leaderValue: number;
  isLeader: boolean;
}) {
  // Fill math UNCHANGED — leader fills 100% gold, chasing bars fill
  // memberValue / leaderValue. Only the displayed ratio TEXT changes
  // (Fix 3: leader bars no longer hide the denominator).
  const pct = isLeader
    ? 100
    : leaderValue > 0
      ? Math.min(100, (memberValue / leaderValue) * 100)
      : 0;
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animValue, {
      toValue: pct,
      duration: 350,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // width% interpolation requires JS thread
    }).start();
  }, [pct]); // eslint-disable-line react-hooks/exhaustive-deps

  const width = animValue.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });
  const suffix = category === "water" ? " oz" : "";

  // Fix 5: when nobody in the pack has logged this category today
  // (leaderValue 0), the prior "0 / 0" ratio read as meaningless.
  // Render a single muted line in place of the bar + ratio so the row
  // reads as "nothing happened here yet today" instead of "everyone
  // is at 0%."
  if (leaderValue === 0) {
    return (
      <View style={s.goalRow}>
        <Text style={s.goalLabel}>{CATEGORY_LABELS[category]}</Text>
        <Text style={s.goalEmpty}>No one's logged this yet today</Text>
      </View>
    );
  }

  return (
    <View style={s.goalRow}>
      <Text style={s.goalLabel}>{CATEGORY_LABELS[category]}</Text>
      <View style={[s.goalBarTrack, s.goalBarTrackFilled]}>
        <Animated.View
          style={[
            s.goalBarFill,
            { width, backgroundColor: isLeader ? colors.leader : C.accent },
          ]}
        />
      </View>
      {/* Tight "X / Y" fraction at the end of the row — one Text with
          a nested Text for the muted "/ Y{suffix}" remainder. Numerator
          gets the primary text color so the eye lands on the member's
          own value first. Uniform across all bars (leader bars render
          e.g. "786 / 786"); the gold bar fill is the only "leader"
          signal needed. */}
      <View style={s.goalRatioBlock}>
        <Text style={s.goalRatioText}>
          {memberValue}
          <Text style={s.goalRatioRest}>
            {" / "}
            {leaderValue}
            {suffix}
          </Text>
        </Text>
      </View>
    </View>
  );
}

// ── Inline expansion (per-category breakdown) ──────────────────────────────
// Renders below the corresponding row when expanded. One CategoryBar per
// category (all four, in CATEGORIES order), each scaled against today's
// leading value for that category. The self-row's accent bar continues
// through the expansion; a non-self rank-1 row gets the gold accent.

function RankRowExpanded({
  entry,
  entries,
  currentUserId,
}: {
  entry: GridEntry;
  entries: GridEntry[];
  currentUserId: string | undefined;
}) {
  const isMe = entry.user_id === currentUserId;
  const useLeaderAccent = !isMe && entry.rank === 1;

  // Today's leading value per category = the max today_values across every
  // member. Computed once here, then handed to each CategoryBar so a
  // member's bar scales against the live leader for that category.
  const leaderTodayValues = useMemo(() => {
    const out = {} as Record<Category, number>;
    for (const category of CATEGORIES) {
      out[category] = entries.reduce(
        (max, e) => Math.max(max, e.today_values[category] ?? 0),
        0,
      );
    }
    return out;
  }, [entries]);

  // Fix 2: first-name label for the left column header. formatName
  // normalizes capitalization; split on whitespace to take only the
  // first token so the label fits cleanly in the narrow header column.
  const firstName = formatName(entry.display_name).split(/\s+/)[0];

  return (
    <View
      style={[
        s.expanded,
        useLeaderAccent && { borderLeftColor: colors.leader },
      ]}
    >
      {/* Fix 1: section title. The audit confirmed this card is strictly
          today's data, so "Daily stats" is accurate. Pairs with the
          roster-level "Weekly stats" header to make the today-vs-week
          distinction legible. */}
      <Text style={s.expandedSectionTitle}>Daily stats</Text>

      {/* Single small right-aligned column label sitting over the
          ratio at the end of each bar row. One Text — not a grid; the
          prior aligned-grid attempt mashed the two labels together and
          starved the bar. Visible " / " separator echoes the "X / Y"
          fractions below; "Leader" (not "Pack Leader") keeps it short. */}
      <View style={s.expandedColHeader}>
        <Text style={s.expandedColHeaderText}>
          {firstName} / Today's Leader
        </Text>
      </View>

      {CATEGORIES.map((category) => (
        <CategoryBar
          key={category}
          category={category}
          memberValue={entry.today_values[category] ?? 0}
          leaderValue={leaderTodayValues[category]}
          isLeader={entry.is_today_leader_in.includes(category)}
        />
      ))}
    </View>
  );
}

// ── Solo-pack hero ─────────────────────────────────────────────────────────
// Renders when the pack has exactly one member (the current user). Replaces
// the competitive rank list with an invite-first card + a non-competitive
// one-line readout of today's category values. No rank/crown/ring — solo
// mode has no competition. The pill-styled invite code copies to clipboard.

function SoloPackHero({
  entry,
  pack,
  onInvite,
}: {
  entry: GridEntry;
  pack: Pack;
  onInvite: () => void;
}) {
  const inviteCode = pack.invite_code;

  // One readout line — "Steps: 8000 · Workouts: 1 · …" — over the pack's
  // enabled categories only. Water carries an "oz" suffix. When every
  // enabled category is still 0, show the empty-state copy instead.
  const enabledCategories = CATEGORIES.filter((c) => categoryEnabled(pack, c));
  const allZero = enabledCategories.every(
    (c) => (entry.today_values[c] ?? 0) === 0,
  );
  const soloLine = enabledCategories
    .map(
      (c) =>
        `${CATEGORY_LABELS[c]}: ${entry.today_values[c] ?? 0}${
          c === "water" ? " oz" : ""
        }`,
    )
    .join(" · ");

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

      {/* Solo mode has no competition — a plain values readout replaces the
          ranked self-row + per-category bars used in 2+ mode. */}
      <View style={s.soloTodayBox}>
        <Text style={s.soloTodayText}>
          {allZero ? "No activity yet today." : soloLine}
        </Text>
      </View>
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
  // Crown + name share one horizontal line within the column rowCenter.
  rowNameLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
    color: C.textPrimary,
    flexShrink: 1, // truncate (numberOfLines=1) rather than push the crown
  },
  // Line 2 of the row's middle column — per-category win counts.
  // All four items always rendered (including zeros) so rows align.
  rowCategoryWins: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  rowCategoryItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rowCategoryCount: {
    fontSize: 12,
    fontWeight: "500",
    color: C.textSecondary,
  },
  rowCategorySep: {
    fontSize: 12,
    color: C.textTertiary,
  },
  // Line 3 of the row's middle column — streak. Slightly de-emphasized
  // (smaller than the name + category-icon lines). Non-flame glyph so
  // it never collides with the calories category icon.
  rowStreakLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  rowStreak: {
    fontSize: 11,
    color: C.streak,
  },
  rowWins: {
    fontSize: 16,
    fontWeight: "600",
    color: C.textPrimary,
    marginLeft: 8,
  },
  // Fix 3: section header above the roster — replaces the prior
  // right-aligned column-label attempt (which never aligned cleanly
  // over the bare-number column). Left-aligned, weight + secondary
  // color match other section titles in the app.
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textSecondary,
  },
  // Fix 4: zero-state copy when a member has 0 wins in every category.
  // Replaces the four-zero icon row so the row doesn't read cold/empty.
  // Muted text, same vertical rhythm as the four-icon row it replaces.
  rowNoWins: {
    fontSize: 12,
    color: C.textTertiary,
    marginTop: 2,
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
  // Gray track always renders so the row's bar slot stays visually stable
  // at all completion levels. Fill width animates from 0% (invisible) to
  // its target on expand.
  goalBarTrackFilled: {
    backgroundColor: "#2C2C2E",
  },
  goalBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: C.accent,
  },
  // Compact ratio slot at the end of the bar row. `minWidth` (not a
  // fixed width) preserves column alignment across rows but lets the
  // bar track keep its full width — the prior fixed-width grid layout
  // starved the bar. Single child is right-aligned via alignItems.
  goalRatioBlock: {
    minWidth: 80,
    alignItems: "flex-end",
  },
  // One tight "X / Y" Text. Outer Text carries primary color (the
  // numerator); the nested Text below renders the "/ Y{suffix}"
  // remainder in tertiary so the eye lands on the member's own value
  // first. Rendering as nested Text — not three siblings — keeps the
  // fraction visually as one piece, with normal letter spacing.
  goalRatioText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.textPrimary,
  },
  goalRatioRest: {
    fontWeight: "400",
    color: C.textTertiary,
  },
  // Empty-state line replacing the bar + ratio when leaderValue is 0
  // (no one in the pack has logged this category today).
  goalEmpty: {
    flex: 1,
    marginLeft: 12,
    fontSize: 12,
    color: C.textTertiary,
  },
  // Section title inside the expanded card — pairs with the
  // roster-level "Weekly stats" header to make the today-vs-week
  // distinction legible.
  expandedSectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textSecondary,
    marginBottom: 8,
  },
  // Single small right-aligned column label above the bars, sitting
  // over the ratio at the end of each bar row. One Text — NOT a
  // grid; the prior aligned-grid attempt mashed the two labels and
  // starved the bar.
  expandedColHeader: {
    alignItems: "flex-end",
    paddingVertical: 4,
    marginBottom: 4,
  },
  expandedColHeaderText: {
    fontSize: 10,
    fontWeight: "700",
    color: C.textTertiary,
    letterSpacing: 0.5,
    textTransform: "uppercase",
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
  // Solo-mode today's-values readout — single line inside a surface card.
  soloTodayBox: {
    marginHorizontal: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: C.surface,
    borderRadius: 12,
  },
  soloTodayText: {
    fontSize: 14,
    color: C.textPrimary,
    lineHeight: 20,
  },
});
