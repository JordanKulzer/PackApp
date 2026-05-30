// PackCompeteView — Step 3a shell of the Compete-tab redesign.
//
// What this step ships:
//   • A horizontally-scrollable score strip of all members (rank-sorted)
//     showing rank ordinal, identity ring, name, and total wins.
//   • A row of category tabs for the pack's enabled categories.
//   • An empty placeholder slot below the tabs where the trend chart
//     lands in Step 3b.
//
// What this step does NOT do (intentional):
//   • No chart, no usePackCategoryTrend, no PackTrendChart import.
//   • No mode toggle / isolate / interaction beyond tapping a tab.
//   • No deletion of PackGridView / RankRow / CategoryBar — those stay
//     in place for now as the revert safety net.
//
// The strip's avatar ring uses progressPct={100} (full circle) by
// design: the ring is identity-only here (you = blue, leader = gold,
// others = grey via PackMemberDisplay's existing getRingColor). It is
// NOT a progress signal. The wins-share % story belongs elsewhere if
// at all — Compete's old ringFillPct has a known monthly bug
// (hardcoded /7), which is why we deliberately don't reproduce it.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  type LayoutChangeEvent,
} from "react-native";
import type { Pack, Run } from "../types/database";
import { type GridEntry } from "./PackGridView";
import { Crown } from "lucide-react-native";
import { PackMemberDisplay } from "./PackMemberDisplay";
import { CategoryIcon } from "./CategoryIcon";
import {
  CATEGORY_LABELS,
  type Category,
} from "../lib/categories";
import { getEnabledCategories } from "../lib/packCategories";
import { packToday } from "../lib/packDates";
import { colors } from "../theme/colors";
import { formatName } from "../lib/displayName";
import { usePackCategoryTrend } from "../hooks/usePackCategoryTrend";
import { usePackDailyWinners } from "../hooks/usePackDailyWinners";
import {
  PackTrendChart,
  type PackTrendSeries,
} from "./trends/PackTrendChart";
import {
  DailyWinnerStrip,
  type WinnerDay,
} from "./trends/DailyWinnerStrip";

// Replicates the local C object pattern at the top of PackGridView —
// these are inlined per-file across the app rather than centralized as
// tokens (a known consolidation point, intentionally out of scope).
// AsyncStorage key for the per-(user, pack) compete-mode override.
// Mirrors the `pack:*` namespace + per-user keying used elsewhere
// (see useIsPro.ts's PRO_OVERRIDE_KEY for the same shape). null
// userId or packId → returns null so caller skips storage entirely.
function competeModeKey(
  userId: string | undefined,
  packId: string | undefined,
): string | null {
  if (!userId || !packId) return null;
  return `pack:compete_mode:${userId}:${packId}`;
}

// Strip card sizing. MIN_CARD keeps a comfortable touch target when a
// 10+ member pack overflows and scrolls; MAX_CARD prevents 2-3 member
// packs from stretching cards too wide and losing their card-like feel.
const CARD_GAP = 10;
const MIN_CARD = 80;
const MAX_CARD = 150;

// Chart line styling. GHOST is the muted treatment for non-emphasized
// members in Focus mode (you + leader bold, everyone else faint
// context). ALL_MODE_PALETTE colors are cycled across the "everyone
// else" set in All mode — i.e. members who are NOT you and NOT the
// category leader. "you" is always colors.self and the category leader
// is always colors.leader (gold) regardless of mode, so the self- and
// leader-identity colors stay consistent across the strip + chart.
// Gold (#E3A000) is intentionally NOT in this palette so the leader
// can't be visually duplicated by another member.
const GHOST_STROKE = "rgba(255,255,255,0.16)";
// Palette hues for non-winner, non-self members. Deliberately excludes
// gold (#E3A000 — reserved for the overall winner override) AND the
// self-blue (#2F81F7 — reserved for the current user). The previous
// amber/orange tones (#E0A52E, #F0997B) read as the winner gold under
// the dim chart background, making a regular member look crowned —
// hence the swap to greens/violets/magentas/reds that are obviously
// not gold.
const ALL_MODE_PALETTE = [
  "#22C55E", // green
  "#7F77DD", // blue-violet
  "#D4537E", // magenta
  "#1D9E75", // teal-green
  "#5DCAA5", // mint
  "#5AA9E6", // sky (distinct from self-blue)
  "#C77DFF", // lavender
  "#E2484A", // red
];

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: colors.self,
} as const;

interface PackCompeteViewProps {
  entries: GridEntry[]; // already rank-sorted by the parent
  pack: Pack;
  activeRun: Run;
  currentUserId: string | undefined;
  onInvite: () => void;
}

// "1st / 2nd / 3rd / Nth" — small helper kept local since this is the
// only consumer. Standard English suffixes: 11/12/13 get "th", anything
// else uses the last-digit rule.
function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

export function PackCompeteView({
  entries,
  pack,
  activeRun,
  currentUserId,
  onInvite,
}: PackCompeteViewProps) {
  // Enabled categories drive the tab row. Memoised so the tab list
  // ref is stable across renders that don't change pack config.
  const enabledCategories = useMemo(
    () => getEnabledCategories(pack),
    [pack],
  );

  const [selectedCategory, setSelectedCategory] = useState<Category>(
    enabledCategories[0] ?? "steps",
  );

  // Strip width drives the per-card width: small packs get roomy cards
  // (cap MAX_CARD), big packs clamp to MIN_CARD and scroll. onLayout
  // populates the real measurement after first paint; we fall back to
  // the window width minus the container's 16px horizontal padding so
  // the very first render isn't degenerate (zero width → MIN_CARD).
  const [stripWidth, setStripWidth] = useState(0);
  const onStripLayout = (e: LayoutChangeEvent) => {
    setStripWidth(e.nativeEvent.layout.width);
  };
  const availWidth = stripWidth || Dimensions.get("window").width - 32;
  const n = entries.length;
  const rawCardWidth =
    n > 0 ? (availWidth - CARD_GAP * (n - 1)) / n : MIN_CARD;
  const cardWidth = Math.max(MIN_CARD, Math.min(MAX_CARD, rawCardWidth));

  // Trend data — fetched here (above the empty-entries return) per
  // rules-of-hooks. The hook short-circuits on null/falsy runId so an
  // empty/loading pack doesn't waste a fetch; activeRun is always
  // defined when we reach this component (the caller already gates on
  // packData.activeRun).
  const { seriesByCategory, isLoading, error } = usePackCategoryTrend({
    packId: pack.id,
    runId: activeRun.id,
  });

  // Mode resolution: small packs default to All (all members visible
  // in distinct colors), bigger packs default to Focus (you + winner
  // bold, others ghosted). A manual override via the segmented control
  // below takes precedence — null means "follow the adaptive default."
  // Persisted per (user, pack) in AsyncStorage so a manual choice on
  // pack X doesn't bleed into pack Y, and pack X reopens to the same
  // choice across app restarts.
  const adaptiveMode: "all" | "focus" =
    entries.length <= 5 ? "all" : "focus";
  const [modeOverride, setModeOverride] = useState<null | "all" | "focus">(
    null,
  );

  // Hydrate the override from storage on mount and whenever
  // (userId, packId) changes. Non-blocking — render proceeds with
  // modeOverride=null (adaptive default visible) and the stored
  // value, if any, lands as soon as the async read resolves. Race
  // guard: the cancelled flag prevents stale reads from a previous
  // pack from clobbering the current pack's override. The keyRef
  // also tracks which key the latest in-flight read is for, so when
  // packs switch mid-flight, the resolved value from the OLD key
  // won't apply to the NEW pack.
  const hydrationKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = competeModeKey(currentUserId, pack.id);
    hydrationKeyRef.current = key;
    if (!key) {
      // Logged-out / missing-pack: no key to hydrate against. Reset
      // override to null so the adaptive default applies in-session.
      setModeOverride(null);
      return;
    }
    let cancelled = false;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (cancelled) return;
        // Reject the read if the pack changed mid-flight — the key
        // ref will have moved on.
        if (hydrationKeyRef.current !== key) return;
        if (raw === "all" || raw === "focus") {
          // setModeOverride is used here for HYDRATION ONLY — does
          // not trigger a write back to storage (writes only happen
          // via setModeOverridePersist below, on user taps).
          setModeOverride(raw);
        } else {
          // No stored value yet → adaptive default applies.
          setModeOverride(null);
        }
      })
      .catch(() => {
        // Storage failure → fall back to adaptive default. Silent;
        // matches the .catch(() => {}) pattern from useIsPro.ts.
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, pack.id]);

  // User-driven toggle. Sets state AND persists fire-and-forget. Wraps
  // setModeOverride so the segmented-control onPress handlers below
  // just call this — the only "raw" setModeOverride call is the
  // hydration path above, which deliberately bypasses persistence to
  // avoid a write loop.
  const setModeOverridePersist = useCallback(
    (next: "all" | "focus") => {
      setModeOverride(next);
      const key = competeModeKey(currentUserId, pack.id);
      if (!key) return;
      AsyncStorage.setItem(key, next).catch(() => {});
    },
    [currentUserId, pack.id],
  );

  const mode = modeOverride ?? adaptiveMode;

  // Category leader = the member with the most wins in the currently
  // selected category. Drives the crown overlay (per-category signal).
  // Ties resolve to the first encountered (entries is rank-sorted by
  // overall total_wins, so this is a stable, sensible fallback).
  const categoryLeaderId = entries.reduce(
    (best, e) =>
      (e.wins_by_category[selectedCategory] ?? 0) >
      (best.wins_by_category[selectedCategory] ?? 0)
        ? e
        : best,
    entries[0] ?? null,
  )?.user_id;

  // Overall winner = the rank-1 entry, but ONLY when uncontested. A
  // tie for #1 means there's no single winner yet → nobody gold.
  // entries is already rank-sorted, so entries[0] is the candidate.
  // Gold line = the headline "winning the pack" signal; it stays put
  // across category tabs (unlike the crown, which moves per category).
  const overallWinnerId = (() => {
    if (entries.length === 0) return undefined;
    const top = entries[0];
    const tied = entries.some(
      (e) => e.user_id !== top.user_id && e.total_wins === top.total_wins,
    );
    return tied ? undefined : top.user_id;
  })();

  // Build the chart series from the FULL roster (not just members who
  // have rows) so even members with zero logged days appear in the
  // chart's resolved series (empty points → omitted by the chart's
  // empty-run case, but the series identity is consistent across
  // category switches).
  const memberTrends = seriesByCategory[selectedCategory] ?? [];
  const pointsByUser = new Map(
    memberTrends.map((m) => [m.userId, m.points]),
  );

  // Stable identity color per member: you = self/blue; everyone else
  // gets a fixed palette slot by their position in rank order. Computed
  // from entries + currentUserId ONLY — NEVER from category or leader —
  // so a member's line color stays put across category-tab switches.
  // (Previously the leader was recolored gold and palette assignment
  // shifted around them; tabbing the four categories made every line
  // reshuffle. Gold is now reserved exclusively for the crown overlay.)
  const colorByUser = useMemo(() => {
    const map = new Map<string, string>();
    let p = 0;
    for (const e of entries) {
      if (e.user_id === currentUserId) {
        map.set(e.user_id, colors.self);
      } else {
        map.set(
          e.user_id,
          ALL_MODE_PALETTE[p++ % ALL_MODE_PALETTE.length],
        );
      }
    }
    return map;
  }, [entries, currentUserId]);

  // Tap-to-isolate state (Step 4b). Holds ONLY explicitly-tapped OTHER
  // members — never the current user. "You" is always part of the
  // shown set when isolation is active (see isShown below). This keeps
  // the Set's meaning honest: "extra members the user pinned into
  // focus alongside themselves." Transient — resets on remount /
  // pack switch. NOT cleared on category-tab change: the user
  // isolated *people*, not a category view.
  const [isolatedIds, setIsolatedIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const toggleIsolate = useCallback(
    (userId: string) => {
      // Tap-own-card is a no-op: you are always shown when isolating,
      // so toggling yourself in/out makes no sense. Tap "Show all" to
      // exit isolation entirely.
      if (userId === currentUserId) return;
      setIsolatedIds((prev) => {
        const next = new Set(prev);
        if (next.has(userId)) {
          next.delete(userId);
        } else {
          next.add(userId);
        }
        return next;
      });
    },
    [currentUserId],
  );
  const isolateActive = isolatedIds.size > 0;
  // Effective shown set when isolation is active: you ∪ tapped. A card
  // is bold-bordered iff its line is bold on the chart — both branches
  // read this single predicate so the invariant can't drift.
  const isShown = (uid: string) =>
    uid === currentUserId || isolatedIds.has(uid);
  const cardIsShown = (uid: string) =>
    isolateActive ? isShown(uid) : false;

  // Resolved identity color per member — stable color PLUS the gold
  // override for the uncontested overall winner. Single source of
  // truth for the strip chips, the isolate-active chart branch, and
  // the legend dots, so the gold winner shows the same gold across
  // line + chip + legend dot. Explicitly NOT derived from
  // chartSeries.strokeColor (that contains GHOST_STROKE for ghosts).
  const resolvedColorByUser = new Map<string, string>(
    entries.map((e) => [
      e.user_id,
      e.user_id === overallWinnerId
        ? colors.leader
        : (colorByUser.get(e.user_id) ?? C.textSecondary),
    ]),
  );

  const chartSeries: PackTrendSeries[] = entries.map((e) => {
    const points = pointsByUser.get(e.user_id) ?? [];
    const isYou = e.user_id === currentUserId;
    const isCategoryLeader = e.user_id === categoryLeaderId;
    const isOverallWinner = e.user_id === overallWinnerId;
    const stable = colorByUser.get(e.user_id) ?? GHOST_STROKE;
    const resolved =
      resolvedColorByUser.get(e.user_id) ?? GHOST_STROKE;

    // ISOLATE OVERRIDE — takes precedence over mode + gold/winner
    // logic while any cards are isolated. Shown members (= you ∪
    // tapped) lift to their resolved identity color (gold stays gold
    // for the winner when they're among the shown); everyone else
    // goes ghost. "You" is implicitly in the shown set so your own
    // line never disappears mid-isolation — the honest read on
    // overlapping/tied lines without losing your own trajectory.
    if (isolateActive) {
      if (isShown(e.user_id)) {
        return {
          userId: e.user_id,
          points,
          strokeColor: resolved,
          strokeWidth: 2.5,
          emphasized: true,
        };
      }
      return {
        userId: e.user_id,
        points,
        strokeColor: GHOST_STROKE,
        strokeWidth: 1.5,
        emphasized: false,
      };
    }

    // Gold OVERRIDE — overall (uncontested rank-1) winner. Stable
    // across category tabs because it depends on total_wins, not on
    // selectedCategory. Takes precedence over the you-blue treatment
    // (if YOU are the winner, your line goes gold — matches the gold
    // ring on your strip card). The crown overlay (per-category) is a
    // separate signal that can coexist on this same line.
    if (isOverallWinner) {
      return {
        userId: e.user_id,
        points,
        strokeColor: colors.leader,
        strokeWidth: 2.5,
        emphasized: true,
      };
    }

    if (mode === "focus") {
      // Focus emphasis: you (blue) + category leader (their stable
      // color — the crown does the "leader" signal, not the color).
      // Everyone else stays grey. Up to three emphasized lines: the
      // gold-winner above, you, the category leader.
      if (isYou || isCategoryLeader) {
        return {
          userId: e.user_id,
          points,
          strokeColor: stable,
          strokeWidth: 2.5,
          emphasized: true,
        };
      }
      return {
        userId: e.user_id,
        points,
        strokeColor: GHOST_STROKE,
        strokeWidth: 1.5,
        emphasized: false,
      };
    }
    // All mode — equal-weight stable-colored lines.
    return {
      userId: e.user_id,
      points,
      strokeColor: stable,
      strokeWidth: 1.8,
      emphasized: false,
    };
  });

  const hasAnyData = memberTrends.some((m) => m.points.length > 0);
  const chartWidth = availWidth; // reuse the strip's measured width


  // Crown target — only when the category leader actually has ≥1 win
  // in the selected category. The reduce above resolves a fallback to
  // entries[0] when nobody has any wins; we don't want to crown that
  // person, so guard on real wins.
  const leaderWins =
    entries.find((e) => e.user_id === categoryLeaderId)
      ?.wins_by_category[selectedCategory] ?? 0;
  const crownUserId = leaderWins > 0 ? categoryLeaderId : undefined;

  // Effective end date — clamp pack-tz today between the run's start
  // and end so the chart spans only what's lived through, not an
  // empty future stretch. YYYY-MM-DD compares lexicographically, so
  // string min/max is correct (no parsing). Equivalent to
  // start + (currentDayOfRun.day - 1) days; chosen for simplicity
  // since packDates has no date-add helper. Reads pack.timezone, the
  // same source the standings query uses (pack/[id].tsx:2574,
  // usePackCategoryStandings.ts:224).
  const todayInPackTz = packToday(pack.timezone ?? "UTC");
  const effectiveEndDate =
    todayInPackTz < activeRun.start_date
      ? activeRun.start_date
      : todayInPackTz > activeRun.end_date
        ? activeRun.end_date
        : todayInPackTz;

  // Settled per-day winners — used by the DailyWinnerStrip. The hook
  // fetches the same daily_winners rows usePackCategoryStandings reads
  // but keeps the score_date dimension. Today is excluded from
  // daily_winners by design (computed through yesterday only) — live
  // today is derived below from seriesByCategory.
  const { winnersByCategoryByDate } = usePackDailyWinners({
    packId: pack.id,
    runId: activeRun.id,
  });

  // Today's live leader for the selected category — derived from
  // seriesByCategory (already-fetched by usePackCategoryTrend) so we
  // don't open a second usePackCategoryStandings subscription just to
  // read what we already have. The "leader" is everyone whose value
  // for today is the max; ties are first-class (same semantics the
  // standings hook's todayLeaderIds uses).
  const liveLeaderIds: string[] = (() => {
    const todayValues: { userId: string; value: number }[] = [];
    for (const m of memberTrends) {
      const todayPoint = m.points.find((p) => p.date === todayInPackTz);
      if (todayPoint && todayPoint.value > 0) {
        todayValues.push({ userId: m.userId, value: todayPoint.value });
      }
    }
    if (todayValues.length === 0) return [];
    const maxV = Math.max(...todayValues.map((t) => t.value));
    return todayValues.filter((t) => t.value === maxV).map((t) => t.userId);
  })();

  // Enumerate run start_date → effectiveEndDate inclusive, one entry
  // per day. Uses the noon-parse trick to avoid UTC-midnight shifts
  // (mirrors packDates.currentDayOfRun's approach — there's no
  // packDates date-add helper, so this is the minimum correct inline
  // walk). Each step formats back to YYYY-MM-DD via the same
  // y/m/d-padding pattern packDates.deviceLocalDateOffset uses.
  const days: WinnerDay[] = (() => {
    const out: WinnerDay[] = [];
    const winnersForCategory = winnersByCategoryByDate[selectedCategory];
    let cur = activeRun.start_date;
    // Hard cap to defend against a malformed run row (start > end);
    // a normal weekly/monthly run is well under 60 iterations.
    let guard = 0;
    while (cur <= effectiveEndDate && guard < 120) {
      const isToday = cur === todayInPackTz;
      out.push({
        date: cur,
        winnerUserIds: isToday
          ? []
          : (winnersForCategory.get(cur) ?? []),
        isToday,
        liveLeaderIds: isToday ? liveLeaderIds : undefined,
      });
      const d = new Date(cur + "T12:00:00");
      d.setDate(d.getDate() + 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      cur = `${y}-${m}-${dd}`;
      guard++;
    }
    return out;
  })();
  const formatValue =
    selectedCategory === "steps"
      ? (nVal: number) =>
          nVal >= 1000
            ? (nVal / 1000).toFixed(1).replace(/\.0$/, "") + "k"
            : String(Math.round(nVal))
      : (nVal: number) => String(Math.round(nVal));

  // Legend items — dot colors read directly from chartSeries / the
  // stable colorByUser map so they can't drift from rendered line
  // colors. `userId` (when present) lets the render attach a gold
  // crown next to the crowned member's row. In Focus mode the legend
  // collapses to "You / Leader · {name} / N others". Gold appears
  // ONLY as the crown overlay — legend dots use stable identity
  // colors so the dot ↔ line correspondence is unambiguous.
  const nameById = new Map(
    entries.map((e) => [e.user_id, formatName(e.display_name).split(/\s+/)[0]]),
  );
  type LegendItem = {
    key: string;
    userId?: string;
    label: string;
    color: string;
    // Optional override for the label text color. Used to mark the
    // current user's item in blue (colors.self) so the legend matches
    // the strip card's "real name, blue text" self treatment. Other
    // items omit this and fall back to the muted s.legendLabel color.
    textColor?: string;
  };
  // Resolve legend dot colors directly from chartSeries so the gold
  // override (overall winner) flows through Focus mode too — no
  // hardcoded blue/gold that could drift from what the lines actually
  // draw.
  const chartColorByUser = new Map(
    chartSeries.map((cs) => [cs.userId, cs.strokeColor]),
  );
  const legendItems: LegendItem[] = (() => {
    // ISOLATE branch — one item per SHOWN member (you ∪ tapped),
    // each at its resolved color; trailing "{k} hidden" with the
    // honest count (NOT entries.length - isolatedIds.size — that
    // counted you as hidden when you weren't). Mirrors chart output:
    // shown member ↔ legend item ↔ bold-bordered card.
    if (isolateActive) {
      const items: LegendItem[] = [];
      for (const e of entries) {
        if (isShown(e.user_id)) {
          const isYou = e.user_id === currentUserId;
          items.push({
            key: e.user_id,
            userId: e.user_id,
            label: nameById.get(e.user_id) ?? "Member",
            color:
              resolvedColorByUser.get(e.user_id) ?? GHOST_STROKE,
            textColor: isYou ? colors.self : undefined,
          });
        }
      }
      const shownCount = entries.filter((e) => isShown(e.user_id)).length;
      const hidden = entries.length - shownCount;
      if (hidden > 0) {
        items.push({
          key: "hidden",
          label: `${hidden} hidden`,
          color: GHOST_STROKE,
        });
      }
      return items;
    }
    if (mode === "all") {
      return chartSeries.map((cs) => ({
        key: cs.userId,
        userId: cs.userId,
        label: nameById.get(cs.userId) ?? "Member",
        color: cs.strokeColor,
        textColor:
          cs.userId === currentUserId ? colors.self : undefined,
      }));
    }
    // Focus mode
    const items: LegendItem[] = [];
    const youInPack = currentUserId
      ? entries.some((e) => e.user_id === currentUserId)
      : false;
    const youAreCategoryLeader =
      !!currentUserId && currentUserId === categoryLeaderId;
    const youAreOverallWinner =
      !!currentUserId && currentUserId === overallWinnerId;
    if (youInPack && currentUserId) {
      // Real first name (no "You") + blue text — same identity rule the
      // strip card uses. The crown next to the name (when you're the
      // category leader) replaces the prior "(leading)" suffix.
      items.push({
        key: "you",
        userId: currentUserId,
        label: nameById.get(currentUserId) ?? "Member",
        color: chartColorByUser.get(currentUserId) ?? colors.self,
        textColor: colors.self,
      });
    }
    // Separate "Winner · X" row when the overall winner is neither
    // YOU nor the category leader — otherwise gold would only show
    // up under "{N} others" with a ghost dot. Skipped when no
    // uncontested winner exists.
    if (
      overallWinnerId &&
      !youAreOverallWinner &&
      overallWinnerId !== categoryLeaderId
    ) {
      const winnerName = nameById.get(overallWinnerId) ?? "Member";
      items.push({
        key: "winner",
        userId: overallWinnerId,
        label: `Winner · ${winnerName}`,
        color: chartColorByUser.get(overallWinnerId) ?? colors.leader,
      });
    }
    if (!youAreCategoryLeader && categoryLeaderId) {
      const leaderName = nameById.get(categoryLeaderId) ?? "Member";
      items.push({
        key: "leader",
        userId: categoryLeaderId,
        label: `Leader · ${leaderName}`,
        color:
          chartColorByUser.get(categoryLeaderId) ?? GHOST_STROKE,
      });
    }
    // "Others" count: everyone NOT already represented above.
    let accountedFor = 0;
    if (youInPack) accountedFor++;
    if (
      overallWinnerId &&
      !youAreOverallWinner &&
      overallWinnerId !== categoryLeaderId
    ) {
      accountedFor++;
    }
    if (categoryLeaderId && !youAreCategoryLeader) accountedFor++;
    const otherCount = entries.length - accountedFor;
    if (otherCount > 0) {
      items.push({
        key: "others",
        label: `${otherCount} ${otherCount === 1 ? "other" : "others"}`,
        color: GHOST_STROKE,
      });
    }
    return items;
  })();

  // Per-category win caption — "{Category} wins · Name n · ..." sorted
  // desc by that category's win count. Members with 0 are included so
  // the full picture shows; if everyone is at 0 we show "None yet"
  // instead of a bare label. Lets the user reconstruct strip totals
  // by tabbing the four categories.
  const captionParts = [...entries]
    .map((e) => ({
      name: nameById.get(e.user_id) ?? "Member",
      n: e.wins_by_category[selectedCategory] ?? 0,
    }))
    .sort((a, b) => b.n - a.n);
  const allZero = captionParts.every((p) => p.n === 0);
  const captionLine = allZero
    ? `${CATEGORY_LABELS[selectedCategory]} wins · None yet`
    : `${CATEGORY_LABELS[selectedCategory]} wins · ${captionParts
        .map((p) => `${p.name} ${p.n}`)
        .join(" · ")}`;

  // Empty roster — render the invite affordance only. SoloPackHero
  // (the 1-member case in PackGridView) deliberately NOT reused here;
  // a solo pack now flows through the standard strip + tabs path with
  // a single card, which is fine for 3a. The "0 members" case is the
  // only one that genuinely has nothing to draw.
  if (entries.length === 0) {
    return (
      <View style={s.container}>
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>Invite your pack</Text>
          <Text style={s.emptyBody}>
            Add at least one more member to start the competition.
          </Text>
          <TouchableOpacity
            style={s.inviteBtn}
            onPress={onInvite}
            activeOpacity={0.8}
          >
            <Text style={s.inviteBtnText}>Invite</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const leaderId = entries[0].user_id;

  return (
    <View style={s.container}>
      {/* ── Score strip — all members, rank order, horizontal scroll ──
          flexGrow:1 + justifyContent:"center" so a small pack centers
          rather than left-aligning with dead space; an overflowing pack
          ignores the centering (content already exceeds the box) and
          scrolls normally. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={onStripLayout}
        contentContainerStyle={s.stripContent}
      >
        {entries.map((entry) => {
          const isMe = entry.user_id === currentUserId;
          const isLeader = entry.rank === 1;
          // Bold border iff this card's line is bold on the chart.
          // cardIsShown handles the "you-always-shown-while-
          // isolating" rule, so YOUR card gets the same bold border
          // as any isolated peer — no more "bordered card, ghost
          // line" mismatch. Resting state (nothing isolated): no
          // bold borders anywhere; the "you" signal is the quiet
          // tint + blue name.
          const showBoldBorder = cardIsShown(entry.user_id);
          const boldBorderColor = resolvedColorByUser.get(entry.user_id);
          return (
            <TouchableOpacity
              key={entry.user_id}
              style={[
                s.card,
                { width: cardWidth },
                isMe && s.cardSelf,
                showBoldBorder && {
                  borderColor: boldBorderColor,
                  borderWidth: 2,
                  backgroundColor: C.surfaceRaised,
                },
              ]}
              onPress={() => toggleIsolate(entry.user_id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: showBoldBorder }}
            >
              <Text
                style={[
                  s.cardRank,
                  isLeader ? s.cardRankLeader : s.cardRankOther,
                ]}
                numberOfLines={1}
              >
                {ordinal(entry.rank)}
              </Text>
              <PackMemberDisplay
                userId={entry.user_id}
                displayName={entry.display_name}
                // progressPct={100} = full ring; identity-only (color
                // signal), NOT a progress meter. See header.
                progressPct={100}
                rank={4 /* >3 suppresses the built-in rank badge */}
                currentUserId={currentUserId}
                leaderId={leaderId}
                size={44}
                strokeWidth={3}
                showName={false}
                showRank={false}
                avatarUrl={entry.avatarUrl}
              />
              <Text
                style={[
                  s.cardName,
                  { maxWidth: cardWidth - 8 },
                  isMe && s.cardNameSelf,
                ]}
                numberOfLines={1}
              >
                {formatName(entry.display_name)}
              </Text>
              <Text
                style={[
                  s.cardWins,
                  isLeader ? s.cardWinsLeader : s.cardWinsOther,
                ]}
              >
                {entry.total_wins}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Category tabs — enabled only, in CATEGORIES order, single
          line. Horizontal ScrollView so 4+ pills (or longer labels in a
          future locale) overflow on one line instead of wrapping. With
          today's 4 short English labels, they fit without scrolling. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.tabRow}
      >
        {enabledCategories.map((cat) => {
          const isActive = cat === selectedCategory;
          return (
            <TouchableOpacity
              key={cat}
              style={[s.tab, isActive && s.tabActive]}
              onPress={() => setSelectedCategory(cat)}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <CategoryIcon
                category={cat}
                size={14}
                color={isActive ? C.accent : C.textSecondary}
              />
              <Text
                style={[s.tabLabel, isActive && s.tabLabelActive]}
              >
                {CATEGORY_LABELS[cat]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Mode segmented control — sets which chart treatment to
          use. Subtle by design: small, muted unless interacted with.
          When isolation is active, a "Show all" clear button appears
          on the left and the segmented control stays on the right.
          Selection reflects the EFFECTIVE mode (adaptive default OR
          override). No persistence yet (4c). */}
      <View style={s.modeRow}>
        {isolateActive ? (
          <TouchableOpacity
            onPress={() => setIsolatedIds(new Set())}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={s.clearText}>Show all</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}
        <View style={s.modeSegment}>
          <TouchableOpacity
            style={[
              s.modeSeg,
              mode === "focus" && s.modeSegActive,
            ]}
            onPress={() => setModeOverridePersist("focus")}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === "focus" }}
          >
            <Text
              style={[
                s.modeSegLabel,
                mode === "focus" && s.modeSegLabelActive,
              ]}
            >
              You vs leader
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              s.modeSeg,
              mode === "all" && s.modeSegActive,
            ]}
            onPress={() => setModeOverridePersist("all")}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === "all" }}
          >
            <Text
              style={[
                s.modeSegLabel,
                mode === "all" && s.modeSegLabelActive,
              ]}
            >
              All
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Chart slot — per-member daily trend for the selected
          category. The loading gate (isLoading && !hasAnyData) shows
          the spinner ONLY on the cold first load; subsequent realtime
          refetches keep the chart visible with the prior data, so the
          UI doesn't flash a spinner on every daily_scores tick. */}
      <View style={s.chartSlot}>
        {error ? (
          <Text style={s.chartMsg}>Couldn&apos;t load trends</Text>
        ) : isLoading && !hasAnyData ? (
          <ActivityIndicator
            color={C.textSecondary}
            style={{ marginTop: 24 }}
          />
        ) : (
          <>
            {/* Legend ABOVE the chart (3f) so the color/crown legend is
                visible before scanning the lines. Caption stays below
                the chart. Final vertical order: tabs → legend → chart
                → caption. */}
            {hasAnyData && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.legendRow}
              >
                {legendItems.map((item) => {
                  const isCrowned =
                    !!crownUserId && item.userId === crownUserId;
                  return (
                    <View key={item.key} style={s.legendItem}>
                      <View
                        style={[
                          s.legendDot,
                          { backgroundColor: item.color },
                        ]}
                      />
                      <Text
                        style={[
                          s.legendLabel,
                          item.textColor && { color: item.textColor },
                        ]}
                      >
                        {item.label}
                      </Text>
                      {isCrowned && (
                        <Crown
                          size={12}
                          color={colors.leader}
                          strokeWidth={2}
                        />
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}
            <PackTrendChart
              series={chartSeries}
              runStart={activeRun.start_date}
              runEnd={effectiveEndDate}
              width={chartWidth}
              height={240}
              transitionKey={selectedCategory}
              formatValue={formatValue}
              crownUserId={crownUserId}
            />
            <DailyWinnerStrip
              days={days}
              nameByUser={nameById}
              colorByUser={resolvedColorByUser}
              width={chartWidth}
              categoryLabel={CATEGORY_LABELS[selectedCategory]}
              currentUserId={currentUserId}
            />
            {hasAnyData && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.captionRow}
              >
                <Text style={s.captionText}>{captionLine}</Text>
              </ScrollView>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // paddingTop gives the score strip breathing room below the
  // InScreenTabBar so the top of the cards (including their isolate
  // 2px border + raised bg) isn't clipped against the tabs.
  container: { paddingTop: 12, paddingHorizontal: 16, gap: 16 },

  // ── Score strip ──
  // paddingVertical 6 (was 4) gives the raised/bordered card states
  // a touch more vertical headroom inside the scroll viewport.
  stripContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 6,
    gap: CARD_GAP,
  },
  card: {
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
    gap: 4,
  },
  // Quiet self marker — faint tint, NO border. The bold border is now
  // reserved exclusively for the isolate "shown" state so bordered
  // cards always correspond to bold lines on the chart. The self
  // signal lives in the name color (s.cardNameSelf) + this tint.
  cardSelf: {
    backgroundColor: colors.selfBgDim,
  },
  cardRank: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  cardRankLeader: { color: colors.leader },
  cardRankOther: { color: C.textSecondary },
  cardName: {
    fontSize: 11,
    color: C.textSecondary,
    maxWidth: 64,
  },
  cardNameSelf: { color: colors.self, fontWeight: "600" },
  cardWins: { fontSize: 16, fontWeight: "700" },
  cardWinsLeader: { color: colors.leader },
  cardWinsOther: { color: C.textPrimary },

  // ── Category tabs ──
  tabRow: {
    flexDirection: "row",
    gap: 8,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  tabActive: {
    borderColor: C.accent,
    backgroundColor: C.surfaceRaised,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textSecondary,
  },
  tabLabelActive: { color: C.textPrimary },

  // ── Mode segmented control (Step 4a) ──
  // Subtle right-aligned pill pair. Borrows the tab pill's shape so it
  // reads as part of the same control family without competing for
  // attention. Active segment uses colors.self for chrome, matching
  // the category tabs' active state.
  modeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  clearText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.accent,
  },
  modeSegment: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: C.border,
    overflow: "hidden",
  },
  modeSeg: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  modeSegActive: {
    backgroundColor: C.surfaceRaised,
  },
  modeSegLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: C.textSecondary,
  },
  modeSegLabelActive: {
    color: C.accent,
  },

  // ── Chart slot (Step 3b — trend chart mounts here). minHeight
  // accommodates legend (~28) + chart (240) + strip (~60) + caption
  // (~22) so layout doesn't jump between loading and loaded states.
  chartSlot: { minHeight: 350 },
  chartMsg: {
    marginTop: 24,
    textAlign: "center",
    fontSize: 13,
    color: C.textSecondary,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 8,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 12,
    color: C.textSecondary,
  },
  captionRow: {
    paddingTop: 6,
  },
  captionText: {
    fontSize: 12,
    color: C.textSecondary,
  },

  // ── Empty state ──
  emptyBox: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
    gap: 8,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textPrimary,
  },
  emptyBody: {
    fontSize: 13,
    color: C.textSecondary,
    textAlign: "center",
  },
  inviteBtn: {
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.accent,
  },
  inviteBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#000",
  },
});
