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
import { useRouter } from "expo-router";
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
import {
  type MemberCategoryTrend,
  type PackTrendPoint,
} from "../hooks/usePackCategoryTrend";
import { type WinnersByCategoryByDate } from "../hooks/usePackDailyWinners";
import {
  PackTrendChart,
  type PackTrendSeries,
} from "./trends/PackTrendChart";
import {
  DailyWinnerStrip,
  type WinnerDay,
} from "./trends/DailyWinnerStrip";
import { PackDailyBars, type DailyBar } from "./trends/PackDailyBars";
import { MEMBER_PALETTE, stableColorForUser } from "../lib/memberPalette";

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
// Member palette + stable-color helper now live in src/lib/memberPalette.ts
// (shared with Home's mini-rings so a given user has the same identity
// color on every surface). The prior inline ALL_MODE_PALETTE has moved
// there as MEMBER_PALETTE; the dormant ChartView's colorByUser
// derivation below references MEMBER_PALETTE directly, and the live
// stableColorByUser is built via stableColorForUser.

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
  // Trend + winners data lifted to the parent (2026-06-01 loading-flow
  // fix). Both used to be fetched inside this component via
  // usePackCategoryTrend + usePackDailyWinners; that serialized them
  // AFTER the parent's loading gif cleared, producing a staggered paint
  // (cards instant → bars pop → winner dots pop). Now the parent fires
  // all 5 hooks concurrently and threads the results down. This
  // component stays presentational w.r.t. trend + winners.
  seriesByCategory: Record<Category, MemberCategoryTrend[]>;
  winnersByCategoryByDate: WinnersByCategoryByDate;
  // Combined loading flag — true while EITHER hook is still in flight.
  // Replaces the prior `isLoading` (trend only). The combined gate makes
  // the chartSlot wait for both, so the bars + winner dots appear
  // together (single visual pop) instead of bars-then-dots.
  chartLoading: boolean;
  // Trend error (winners doesn't surface one to this UI). Renamed from
  // the prior `error` for prop clarity.
  chartError: string | null;
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
  seriesByCategory,
  winnersByCategoryByDate,
  chartLoading,
  chartError,
}: PackCompeteViewProps) {
  // Profile-open navigation — same pattern PackGridView (line 340),
  // home.tsx (line 203), ChatMessageRow, and FeedItemRow already use.
  // packId carries pack context to the (future) Piece-3 pack-context
  // stats on the profile screen.
  const router = useRouter();
  const openMemberProfile = useCallback(
    (userId: string) => {
      router.push(`/user/${userId}?packId=${pack.id}` as any);
    },
    [router, pack.id],
  );

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

  // Trend data + winners are now lifted to the parent (2026-06-01) and
  // arrive as props (seriesByCategory, winnersByCategoryByDate). The
  // combined chartLoading / chartError props replace the prior in-line
  // isLoading / error from usePackCategoryTrend. See the chartSlot gate
  // below — it now waits for BOTH trend + winners so the bars and the
  // winner dots in the strip appear together (single paint) instead of
  // bars-then-dots.

  // Mode resolution: small packs default to All (all members visible
  // Mode resolution (All / Focus), the per-(user, pack) AsyncStorage
  // hydration useEffect, and the persisting setter were here. Moved
  // into ChartView (dormant) since they only feed chart-side branches.

  // Category leader / crown derivation moved into ChartView with the
  // rest of the chart-only state.

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
          MEMBER_PALETTE[p++ % MEMBER_PALETTE.length],
        );
      }
    }
    return map;
  }, [entries, currentUserId]);

  // Tap-to-isolate state was here. Removed in the 2026-05-30 bar-pivot
  // pass: isolate existed to manage line overlap on the chart, and the
  // chart is no longer mounted on this tab. Score-strip cards are now
  // non-interactive on tap (future: tap a card / bar → member detail
  // sheet, replacing the removed isolate gesture).

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

  // Stable palette-only color map for the BARS + WINNER-DOTS. NO
  // gold-overall-winner override, NO blue-self override — every
  // member, including the current user, gets a fixed palette slot.
  // Keyed by SORTED user_id (via stableColorForUser) so a member's
  // color is identical here, on Home's mini-rings, and across any
  // category-tab / sort-order shift on this surface. The prior
  // rank-index keying caused colors to reshuffle when standings
  // moved (a member overtaking another swapped both their colors);
  // the sorted-userId keying eliminates that drift entirely.
  // MEMBER_PALETTE excludes gold (#E3A000) and self-blue (#2F81F7)
  // so no member's stable color can collide with the reserved
  // identity colors. `resolvedColorByUser` (with overrides) is kept
  // for the dormant ChartView; do NOT swap them.
  const memberIds = entries.map((e) => e.user_id);
  const stableColorByUser = new Map<string, string>(
    memberIds.map((id) => [id, stableColorForUser(id, memberIds)]),
  );

  // chartSeries, hasAnyData (for the chart's load gate), chartWidth,
  // leaderWins, and crownUserId moved into ChartView. The bars use
  // dailyBars (built below) directly from seriesByCategory; the strip
  // uses days + winnersByCategoryByDate. Nothing chart-specific
  // remains in the parent's derivation chain.
  const hasAnyData = memberTrends.some((m) => m.points.length > 0);

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

  // Settled per-day winners — arrives as a prop now (lifted to the
  // parent so it fetches in parallel with the gif's own hooks).
  // Excludes today by design (computed through yesterday only); live
  // today is derived below from seriesByCategory.

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

  // Selected day — drives the strip's selection ring and (Step 2+) the
  // upcoming bar graph. Defaults to today-in-pack-tz; falls back to the
  // last day in `days` if today happens to fall outside the run window
  // (defensive — effectiveEndDate already clamps that case, but a
  // brand-new run with no settled days yet could in principle place
  // today outside the enumerated range). Initializer runs once on
  // mount; subsequent days/today changes don't auto-re-clamp — the
  // selector UX is fine without it for Step 1, and a true mid-session
  // day-rollover is rare. Revisit if needed in later steps.
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    days.some((d) => d.date === todayInPackTz)
      ? todayInPackTz
      : (days[days.length - 1]?.date ?? todayInPackTz),
  );

  // formatValue (chart y-axis number formatter) moved into ChartView.
  // PackDailyBars has its own internal value formatter.

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

  // Avatar map — entries already carry avatarUrl per member; build the
  // lookup once so PackDailyBars can render avatars on wide-slot
  // packs. Falls back to initials when the URL is null/undefined.
  const avatarById = new Map<string, string | null>(
    entries.map((e) => [e.user_id, e.avatarUrl]),
  );

  // Real bars for the selected (date, category) — the data-layer
  // transpose. Each member of memberTrends becomes a DailyBar whose
  // value is their point for selectedDate (0 if absent). Sorted
  // descending by value so the winner is leftmost; ties resolve in
  // stable map order. Falls back to a muted grey when a member is
  // missing from the resolved color map (defensive — every entry
  // should be present).
  const dailyBars: DailyBar[] = (() => {
    // Iterate the FULL active-member roster (entries), not just the
    // members who have a series in seriesByCategory. A member with no
    // daily_scores rows yet (brand-new member, or a pack where they
    // haven't opened the app since joining) is absent from
    // seriesByCategory but is still an active member — they belong
    // in the bars as a 0-height stub. Pre-build a value lookup per
    // member so the loop is O(N) on the roster, O(M) on the series.
    const valueByUser = new Map<string, number>();
    for (const m of seriesByCategory[selectedCategory] ?? []) {
      const pt = m.points.find((p) => p.date === selectedDate);
      if (pt) valueByUser.set(m.userId, pt.value);
    }
    return entries
      .map((e): DailyBar => ({
        userId: e.user_id,
        value: valueByUser.get(e.user_id) ?? 0,
        color: stableColorByUser.get(e.user_id) ?? colors.member,
        name: nameById.get(e.user_id) ?? "—",
        avatarUrl: avatarById.get(e.user_id) ?? undefined,
      }))
      .sort((a, b) => b.value - a.value);
  })();

  // Per-category unit suffix. Only water carries one in the current
  // category set; steps/workouts/calories are dimensionless integers
  // already conveyed by the bar height + value label.
  const unitSuffix: string | undefined =
    selectedCategory === "water" ? "oz" : undefined;

  // Empty-state copy for the all-zero case. Today gets the "yet today"
  // framing (it's still open); past days get a date-specific framing.
  // Date formatted "May 27" from the YYYY-MM-DD without locale parsing.
  const SHORT_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const formatShortDate = (date: string): string => {
    const [, m, d] = date.split("-").map(Number);
    return `${SHORT_MONTHS[(m ?? 1) - 1]} ${d}`;
  };
  const catWord = CATEGORY_LABELS[selectedCategory].toLowerCase();
  const isTodaySelected = selectedDate === todayInPackTz;
  const emptyLabel = isTodaySelected
    ? `No ${catWord} logged yet today`
    : `No ${catWord} logged on ${formatShortDate(selectedDate)}`;
  // Legend derivation (LegendItem type, chartColorByUser, legendItems
  // IIFE) moved into ChartView.

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

  // leaderId removed — the top score strip's PackMemberDisplay now
  // gets leaderId={undefined} so the leader's ring doesn't go gold.
  // Rank-1 standing signal stays in the cardRankLeader/cardWinsLeader
  // text styles.

  // All-zero-wins suppression: when EVERY member is at 0 total wins
  // (start-of-week / pre-rollover state), there's no meaningful rank
  // order — calling all three "1st" reads as a bug. Render "—" for
  // every card's rank ordinal in this state, and suppress the gold
  // cardRankLeader style (nobody leads at 0–0–0). The win-count "0"
  // under each name still renders. As soon as any member has ≥1
  // total_win, normal ordinals + gold-for-#1 return.
  const allZeroWins = entries.every((e) => (e.total_wins ?? 0) === 0);

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
          // isLeader gold treatment is suppressed in the all-zero
          // state — nobody leads when everyone is at 0 wins.
          const isLeader = !allZeroWins && entry.rank === 1;
          // Score-strip cards open the member's profile modal — same
          // /user/[id]?packId=... pattern PackGridView, Home,
          // ChatMessageRow, and FeedItemRow already use. (Replaces
          // the removed isolate gesture; same TODO from 2026-05-30
          // is now resolved.)
          return (
            <TouchableOpacity
              key={entry.user_id}
              style={[
                s.card,
                { width: cardWidth },
                isMe && s.cardSelf,
              ]}
              onPress={() => openMemberProfile(entry.user_id)}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text
                style={[
                  s.cardRank,
                  isLeader ? s.cardRankLeader : s.cardRankOther,
                ]}
                numberOfLines={1}
              >
                {allZeroWins ? "—" : ordinal(entry.rank)}
              </Text>
              <PackMemberDisplay
                userId={entry.user_id}
                displayName={entry.display_name}
                // progressPct={100} = full ring; identity-only (color
                // signal), NOT a progress meter. See header.
                progressPct={100}
                rank={4 /* >3 suppresses the built-in rank badge */}
                currentUserId={currentUserId}
                // leaderId intentionally undefined — `ringColor` below
                // provides the explicit palette color, so the leader/
                // self/member derivation isn't consulted for the ring.
                leaderId={undefined}
                // Stable palette color for the avatar ring — matches
                // the bars + dots + chip initials so the member's
                // identity reads consistently across the whole Compete
                // surface. The #1 standing signal stays on the rank
                // ordinal + wins-count text styles (s.cardRankLeader
                // / s.cardWinsLeader), independent of this ring color.
                ringColor={stableColorByUser.get(entry.user_id)}
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

      {/* ChartView (line chart + mode toggle + legend) retired from
          the free Compete tab in the 2026-05-30 bar-pivot. Kept dormant
          for the future premium Trends extraction. To revert, re-mount
          here: <ChartView entries={entries} currentUserId={currentUserId}
          selectedCategory={selectedCategory} memberTrends={memberTrends}
          pointsByUser={pointsByUser} colorByUser={colorByUser}
          resolvedColorByUser={resolvedColorByUser} nameById={nameById}
          overallWinnerId={overallWinnerId} pack={pack} activeRun={activeRun}
          effectiveEndDate={effectiveEndDate} availWidth={availWidth} />.
          The score strip's onPress isolate gesture is also gone — see
          TODO log 2026-05-30 for the future tap-to-member-detail
          replacement. */}

      {/* Data slot — strip selector + daily bars + caption. The
          loading gate (isLoading && !hasAnyData) was for the chart's
          cold-load spinner; the bars depend on the same data source so
          it still applies. */}
      <View style={s.chartSlot}>
        {chartError ? (
          <Text style={s.chartMsg}>Couldn&apos;t load trends</Text>
        ) : chartLoading && !hasAnyData ? (
          <ActivityIndicator
            color={C.textSecondary}
            style={{ marginTop: 24 }}
          />
        ) : (
          <>
            <DailyWinnerStrip
              days={days}
              nameByUser={nameById}
              colorByUser={stableColorByUser}
              categoryLabel={CATEGORY_LABELS[selectedCategory]}
              currentUserId={currentUserId}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />

            {/* Real bars for the selected (date, category). Reacts to
                both day-card taps in the strip above (selectedDate)
                and category-tab switches (selectedCategory). The chart
                + mode-toggle + legend below stay mounted in step 3 for
                an agreement check (winner-dot ↔ tallest-bar ↔ chart
                peak should all identify the same member on a given
                day). The chart unmounts in step 4. */}
            <View style={{ marginTop: 12 }}>
              <PackDailyBars
                bars={dailyBars}
                unitSuffix={unitSuffix}
                emptyLabel={emptyLabel}
                onBarPress={openMemberProfile}
              />
            </View>
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

// ─────────────────────────────────────────────────────────────────────────────
// ChartView (DORMANT) — line chart + mode toggle + legend.
//
// Retired from the free Compete tab in the 2026-05-30 bar-pivot pass.
// Kept here intact so the premium Trends extraction (or a future revert)
// can re-mount with one line: <ChartView entries={...} ... />.
//
// Differences vs the pre-pivot inline version:
//   • Tap-to-isolate is removed (no consumer left on the free tab).
//     chartSeries now branches only on mode (All / Focus) + the gold
//     overall-winner override. Restoring isolate would mean lifting
//     isolatedIds back into the parent (the cards' onPress is gone) —
//     intentionally not done here.
//   • Mode persistence (AsyncStorage `pack:compete_mode:${userId}:${packId}`)
//     is preserved verbatim so a revert restores per-pack mode memory.
// ─────────────────────────────────────────────────────────────────────────────

interface ChartViewProps {
  entries: GridEntry[];
  currentUserId: string | undefined;
  selectedCategory: Category;
  memberTrends: MemberCategoryTrend[];
  pointsByUser: Map<string, PackTrendPoint[]>;
  colorByUser: Map<string, string>;
  resolvedColorByUser: Map<string, string>;
  nameById: Map<string, string>;
  overallWinnerId: string | undefined;
  pack: Pack;
  activeRun: Run;
  effectiveEndDate: string;
  availWidth: number;
}

function ChartView({
  entries,
  currentUserId,
  selectedCategory,
  memberTrends,
  pointsByUser,
  colorByUser,
  resolvedColorByUser,
  nameById,
  overallWinnerId,
  pack,
  activeRun,
  effectiveEndDate,
  availWidth,
}: ChartViewProps) {
  // Mode resolution + persistence — mirrors the parent's pre-pivot
  // behavior verbatim. Adaptive default (small pack → All, big pack →
  // Focus) overridden by manual toggle. Per-(user, pack) AsyncStorage
  // memory so a manual choice doesn't bleed between packs.
  const adaptiveMode: "all" | "focus" =
    entries.length <= 5 ? "all" : "focus";
  const [modeOverride, setModeOverride] = useState<null | "all" | "focus">(
    null,
  );
  const hydrationKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = competeModeKey(currentUserId, pack.id);
    hydrationKeyRef.current = key;
    if (!key) {
      setModeOverride(null);
      return;
    }
    let cancelled = false;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (cancelled) return;
        if (hydrationKeyRef.current !== key) return;
        if (raw === "all" || raw === "focus") {
          setModeOverride(raw);
        } else {
          setModeOverride(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentUserId, pack.id]);
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

  // Category leader → crown overlay on the per-category leader's
  // latest point. Guarded so a leader with zero wins doesn't get
  // crowned.
  const categoryLeaderId = entries.reduce(
    (best, e) =>
      (e.wins_by_category[selectedCategory] ?? 0) >
      (best.wins_by_category[selectedCategory] ?? 0)
        ? e
        : best,
    entries[0] ?? null,
  )?.user_id;
  const leaderWins =
    entries.find((e) => e.user_id === categoryLeaderId)
      ?.wins_by_category[selectedCategory] ?? 0;
  const crownUserId = leaderWins > 0 ? categoryLeaderId : undefined;

  // Per-member chart series — gold for overall winner (override),
  // member stable color for you + category-leader in Focus, ghost for
  // everyone else in Focus, stable colors for everyone in All. Isolate
  // branch is gone; the dormant chart doesn't need it.
  const chartSeries: PackTrendSeries[] = entries.map((e) => {
    const points = pointsByUser.get(e.user_id) ?? [];
    const isYou = e.user_id === currentUserId;
    const isCategoryLeader = e.user_id === categoryLeaderId;
    const isOverallWinner = e.user_id === overallWinnerId;
    const stable = colorByUser.get(e.user_id) ?? GHOST_STROKE;

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
    return {
      userId: e.user_id,
      points,
      strokeColor: stable,
      strokeWidth: 1.8,
      emphasized: false,
    };
  });

  const hasAnyData = memberTrends.some((m) => m.points.length > 0);
  const chartWidth = availWidth;

  const formatValue =
    selectedCategory === "steps"
      ? (nVal: number) =>
          nVal >= 1000
            ? (nVal / 1000).toFixed(1).replace(/\.0$/, "") + "k"
            : String(Math.round(nVal))
      : (nVal: number) => String(Math.round(nVal));

  type LegendItem = {
    key: string;
    userId?: string;
    label: string;
    color: string;
    textColor?: string;
  };
  const chartColorByUser = new Map(
    chartSeries.map((cs) => [cs.userId, cs.strokeColor]),
  );
  const legendItems: LegendItem[] = (() => {
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
      items.push({
        key: "you",
        userId: currentUserId,
        label: nameById.get(currentUserId) ?? "Member",
        color: chartColorByUser.get(currentUserId) ?? colors.self,
        textColor: colors.self,
      });
    }
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

  // Reference resolvedColorByUser so the prop isn't "unused" — it's
  // here for future re-use (a revert might want to re-introduce
  // isolate or other per-card visual states that re-key on this).
  void resolvedColorByUser;

  return (
    <>
      {/* Mode segmented control */}
      <View style={s.modeRow}>
        <View />
        <View style={s.modeSegment}>
          <TouchableOpacity
            style={[s.modeSeg, mode === "focus" && s.modeSegActive]}
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
            style={[s.modeSeg, mode === "all" && s.modeSegActive]}
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

      {/* Legend */}
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

      {/* Chart */}
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
    </>
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
