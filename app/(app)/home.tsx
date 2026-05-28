import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { Crown } from "lucide-react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useAuthStore } from "../../src/stores/authStore";
import { useConsumeSuppressFlag } from "../../src/context/ModalMutationContext";
import { useScoreStore } from "../../src/stores/scoreStore";
import { useUserPacks } from "../../src/hooks/usePack";
import { useIsPro } from "../../src/hooks/useIsPro";
import {
  usePackCategoryStandings,
  buildPackCategoryStandings,
  type MemberWinsCount,
  type PackCategoryStandings,
  type DailyWinnerRow,
  type ScoreRow,
} from "../../src/hooks/usePackCategoryStandings";
import { packToday } from "../../src/lib/packDates";
import { fetchPreviousRunWinnerIds } from "../../src/hooks/usePackRunHistory";
import { supabase } from "../../src/lib/supabase";
import { formatName } from "../../src/lib/displayName";
import { PackMemberDisplay } from "../../src/components/PackMemberDisplay";
import type { Pack } from "../../src/types/database";
import { JoinPackModal } from "../../src/components/JoinPackModal";
import { colors } from "../../src/theme/colors";
import { analytics } from "../../src/lib/analytics";
import { useCurrentUser } from "../../src/context/CurrentUserContext";
import { useRefreshCurrentUserOnFocus } from "../../src/hooks/useRefreshCurrentUserOnFocus";
import { computeDailyWinnersForPack } from "../../src/lib/dailyWinners";
import {
  useUnpostedAchievements,
  UnpostedAchievement,
} from "../../src/hooks/useUnpostedAchievements";
import { VictoryPostSheet } from "../../src/components/VictoryPostSheet";
import {
  HomeAchievementBanner,
  isAchievementDismissed,
  markAchievementDismissed,
} from "../../src/components/HomeAchievementBanner";
import { FEATURE_FLAGS } from "../../src/lib/featureFlags";
import { PackLogo, PackWordmark } from "../../src/components/brand/PackLogo";
import { PackBrandLoadingState } from "../../src/components/PackBrandLoadingState";
import { packs as packsCopy } from "../../src/constants/strings";
import { BrandColors } from "../../src/constants/brand";
import { subscribeToRunScores } from "../../src/lib/realtimeSubscriptions";

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

interface HomeMember {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

interface HomePackData {
  members: HomeMember[];
  runStart: string;
  runEnd: string;
  runId: string | null;
  // Pre-derived standings, hoisted from usePackCategoryStandings's
  // initial fetch. Seeded into the per-card hook via initialData so
  // rings paint correctly on the first frame instead of cascading in
  // after the card mounts and the hook cold-fetches. null when the
  // pack has no active run (matches the hook's runId-null branch).
  initialStandings: PackCategoryStandings | null;
  // Pre-fetched rank-1 winners of the pack's most recent completed
  // run — used to draw the crown overlay on the corresponding member
  // avatars. Pre-fetching here lets the gate (scoresLoaded) wait for
  // it so the crown paints correctly on first frame (no cascade).
  // Empty array for packs with no completed runs yet, or on fetch
  // error (safe degradation — card shows no crown).
  previousRunWinnerIds: string[];
}

// One mini-ring cell — a roster member joined with their wins standing.
interface MiniRingEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_wins: number;
  rank: number; // competition rank by total_wins (1,1,3,…)
  // True iff this member was in the rank-1 group of the most recent
  // COMPLETED run (last week for weekly packs, last month for monthly).
  // Matches the Compete tab's wonPreviousRun on GridEntry — one Crown
  // semantic across the app. Ties are first-class (multiple crowns
  // possible iff multiple members genuinely tied the previous run).
  wonPreviousRun: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Mini-ring fill for the categories model. Mirrors PackGridView's
// ringFillPct — intentionally duplicated rather than imported, to keep the
// two screens decoupled. A member's ring shows their share of the daily
// category-contests won so far this run: total_wins / daysElapsed. wins
// span all 4 categories, so the ratio can exceed 1.0 — clamped to 100%.
// daysElapsed is 1-indexed (run start = day 1), capped at 7 (weekly runs),
// divisor floored at 1 for the just-started / clock-skew edge case.
function winsRingPct(totalWins: number, runStart: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const start = new Date(runStart + "T12:00:00").getTime();
  const rawDays = Math.floor((Date.now() - start) / msPerDay) + 1;
  const daysElapsed = Math.min(7, Math.max(1, rawDays));
  return Math.min(100, Math.max(0, (totalWins / daysElapsed) * 100));
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini Rings Row — horizontal-scrolling list of all pack members.
// Replaced the prior layout cascade (top-3 + strip + overflow pill) with a
// uniform horizontal scroller (Pass 21a). Uses PackMemberDisplay for
// consistent ring/badge/name rendering with the Pack Detail screen.
// ─────────────────────────────────────────────────────────────────────────────

// Pass 25-followup-E.2.a-home-polish: avatar bump from 60 → 96 (stroke 5
// → 6) to consume the vertical space freed by collapsing the prior 4-line
// cell (avatar / rank-pill / name / pts) into a 3-line cell (avatar /
// name / `#N · pts` inline). Horizontal scroll absorbs the wider card;
// ~3 members visible per row at the new size.
const MEMBER_RING_SIZE = 96;
const MEMBER_RING_STROKE = 6;

// Per-member compact card. Tap navigates to the public user profile
// screen (Pass 21b). The privacy gate inside get_user_public_profile
// allows self-viewing, so a self-tap shows your own profile via the same
// route.
function MemberCard({
  entry,
  runStart,
  currentUserId,
  leaderId,
  currentUser,
  packId,
}: {
  entry: MiniRingEntry;
  runStart: string;
  currentUserId: string | undefined;
  leaderId: string | undefined;
  currentUser: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  // Threaded so the avatar-tap → /user/[id] carries pack context for the
  // public profile's pack-scoped Trends section.
  packId: string;
}) {
  const router = useRouter();
  const pct = winsRingPct(entry.total_wins, runStart);
  const isMe = entry.user_id === currentUser?.id;
  const displayName =
    isMe && currentUser ? currentUser.displayName : entry.display_name;
  const avatarUrl =
    isMe && currentUser ? currentUser.avatarUrl : entry.avatar_url;
  const nameColor = isMe ? colors.self : colors.member;
  // Rank badge overlays the avatar's top-left. Gold for #1, neutral for
  // everyone else — echoes the Compete tab's #N treatment, sized down
  // for the avatar overlay. PackMemberDisplay's built-in below-ring pill
  // stays suppressed (showRank={false}) — this overlay replaces it at a
  // new position.
  const isFirst = entry.rank === 1;
  return (
    <View style={miniRingS.memberCard}>
      <View style={miniRingS.avatarWrap}>
        <TouchableOpacity
          onPress={() => {
            router.push(`/user/${entry.user_id}?packId=${packId}` as any);
          }}
          activeOpacity={0.7}
          // Pass 25-followup-E.2.a-home-polish-3-fix: delay press-in capture
          // so the parent horizontal ScrollView's pan detector wins on
          // swipe gestures. Without this, the avatar TouchableOpacity locks
          // touches immediately and horizontal scroll fails until a long-
          // press first releases the touch. Genuine taps (~200-300ms total)
          // still fire on release; horizontal pan resolves before 150ms.
          delayPressIn={150}
        >
          <PackMemberDisplay
            userId={entry.user_id}
            displayName={displayName}
            progressPct={pct}
            rank={entry.rank}
            currentUserId={currentUserId}
            leaderId={leaderId}
            size={MEMBER_RING_SIZE}
            strokeWidth={MEMBER_RING_STROKE}
            avatarUrl={avatarUrl}
            showName={false}
            showRank={false}
          />
        </TouchableOpacity>
        <View
          pointerEvents="none"
          style={[miniRingS.rankBadge, isFirst && miniRingS.rankBadgeFirst]}
        >
          <Text
            style={[
              miniRingS.rankBadgeText,
              isFirst && miniRingS.rankBadgeTextFirst,
            ]}
          >
            #{entry.rank}
          </Text>
        </View>
      </View>
      <View style={miniRingS.nameLine}>
        {entry.wonPreviousRun && (
          <Crown
            size={12}
            color={colors.leader}
            strokeWidth={2}
            style={{ marginRight: 3 }}
          />
        )}
        <Text
          style={[miniRingS.memberName, { color: nameColor }]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
      </View>
      <Text style={miniRingS.memberMeta} numberOfLines={1}>
        {entry.total_wins} {entry.total_wins === 1 ? "win" : "wins"}
      </Text>
    </View>
  );
}

function MiniRings({
  members,
  rankedMembers,
  previousRunWinnerIds,
  runStart,
  currentUserId,
  packId,
}: {
  members: HomeMember[];
  rankedMembers: MemberWinsCount[];
  previousRunWinnerIds: string[];
  runStart: string;
  currentUserId: string | undefined;
  // Forwarded to each MemberCard so avatar-tap navigation includes
  // ?packId= for the public profile's pack-scoped Trends.
  packId: string;
}) {
  const { user: currentUser } = useCurrentUser();

  // rankedMembers is wins-desc; join each to its roster row for display.
  // Filtered to the current roster — the standings hook also counts
  // ex-members who won days, but those shouldn't appear as ghost avatars.
  // Competition ranks (1,1,3,…) by total_wins. Crown semantic = the
  // overall pack winner(s) of the PREVIOUS completed run — same as the
  // Compete tab. previousRunWinnerIds is the rank-1 group of
  // completedRuns[0] derived in DarkPackCard.
  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const rankedRoster = rankedMembers.filter((rm) => memberById.has(rm.userId));
  const winnerIdSet = new Set(previousRunWinnerIds);
  const entries: MiniRingEntry[] = [];
  for (let i = 0; i < rankedRoster.length; i++) {
    const rm = rankedRoster[i];
    const m = memberById.get(rm.userId)!;
    const rank =
      i > 0 && rankedRoster[i - 1].totalWins === rm.totalWins
        ? entries[i - 1].rank
        : i + 1;
    entries.push({
      user_id: rm.userId,
      display_name: m.display_name,
      avatar_url: m.avatar_url,
      total_wins: rm.totalWins,
      rank,
      wonPreviousRun: winnerIdSet.has(rm.userId),
    });
  }

  if (entries.length === 0) return null;

  // Gold ring identity goes to the top-of-list member, but only when there
  // are real wins (mirrors the crown + status-line "No wins yet").
  const leaderId =
    entries[0].total_wins > 0 ? entries[0].user_id : undefined;

  // Solo-pack: center a single card. ScrollView with one child left-aligns
  // and looks broken; the standalone <View> matches the prior solo layout
  // visually (no scroll affordance, just the centered ring).
  if (entries.length === 1) {
    return (
      <View style={miniRingS.wrapper}>
        <View style={miniRingS.solo}>
          <MemberCard
            entry={entries[0]}
            runStart={runStart}
            currentUserId={currentUserId}
            leaderId={leaderId}
            currentUser={currentUser}
            packId={packId}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={miniRingS.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={miniRingS.scrollContent}
      >
        {entries.map((entry) => (
          <MemberCard
            key={entry.user_id}
            entry={entry}
            runStart={runStart}
            currentUserId={currentUserId}
            leaderId={leaderId}
            currentUser={currentUser}
            packId={packId}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const miniRingS = StyleSheet.create({
  wrapper: { paddingVertical: 14 },
  solo: {
    alignItems: "center",
    paddingVertical: 4,
  },
  scrollContent: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 12,
    alignItems: "center",
  },
  memberCard: {
    alignItems: "center",
    // Width bumped 88 → 110 in Pass 25-followup-E.2.a-home-polish to
    // accommodate the 96pt ring + clear breathing for the name and meta
    // text below it.
    width: 110,
    gap: 6,
  },
  // Wrapper for the avatar + the absolutely-positioned rank badge. Width
  // matches the ring so the badge anchors to the ring's top-left corner
  // regardless of the card's overall `alignItems: "center"`.
  avatarWrap: {
    position: "relative",
    width: MEMBER_RING_SIZE,
    height: MEMBER_RING_SIZE,
  },
  // Rank badge — small pill sitting on the avatar's top-left curve.
  // Token family mirrors PackMemberDisplay's built-in badge (which the
  // card explicitly suppresses) so the overlay reads as native to the
  // app. Dark pill bg keeps the badge legible over any avatar photo.
  rankBadge: {
    position: "absolute",
    top: -2,
    left: -2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 0.5,
    backgroundColor: C.surface,
    borderColor: C.border,
  },
  rankBadgeFirst: {
    backgroundColor: colors.leaderBg,
    borderColor: colors.leaderBorder,
  },
  rankBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: C.textSecondary,
  },
  rankBadgeTextFirst: {
    color: colors.leader,
  },
  nameLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  memberName: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
  },
  memberMeta: {
    fontSize: 12,
    color: C.textSecondary,
    fontWeight: "500",
    textAlign: "center",
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

function PacksEmptyState({
  onCreate,
  onJoin,
}: {
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <View style={emptyS.container}>
      <View style={emptyS.brandMark}>
        <PackLogo size={56} variant="mono" tint={BrandColors.blue} />
      </View>

      <Text style={emptyS.title}>{packsCopy.empty.headline}</Text>
      <Text style={emptyS.subtitle}>{packsCopy.empty.body}</Text>

      <View style={emptyS.actions}>
        <TouchableOpacity
          style={emptyS.primaryBtn}
          onPress={onCreate}
          activeOpacity={0.8}
        >
          <Text style={emptyS.primaryBtnText}>
            {packsCopy.empty.primaryCta}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={emptyS.joinLink}
          onPress={onJoin}
          activeOpacity={0.7}
        >
          <Text style={emptyS.joinLinkText}>
            {packsCopy.empty.secondaryCta}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const emptyS = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingVertical: 32,
    gap: 10,
  },
  brandMark: {
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: C.textPrimary,
    marginTop: 8,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 14,
    color: C.textTertiary,
    textAlign: "center",
    lineHeight: 20,
  },
  actions: {
    alignItems: "center",
    gap: 16,
    marginTop: 12,
    width: "100%",
  },
  primaryBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    width: "100%",
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  joinLink: {
    paddingVertical: 4,
  },
  joinLinkText: {
    fontSize: 15,
    fontWeight: "600",
    color: C.accent,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Pack Card
// ─────────────────────────────────────────────────────────────────────────────

function DarkPackCard({
  pack,
  data,
  currentUserId,
  onPress,
}: {
  pack: Pack;
  data: HomePackData | undefined;
  currentUserId: string | undefined;
  onPress: () => void;
}) {
  // One card = one pack = one legal hook call. Standings load per-card;
  // the hook returns null while runId is null (no active run / not loaded).
  //
  // initialData: Home's fetchPackMembers pre-fetches the standings and
  // passes them down via data.initialStandings. The hook seeds its
  // initial useState from this and skips its first Effect-1 fetch — the
  // card paints correct rings on the first frame instead of cold-
  // fetching on mount. Realtime (Effect 2) is unchanged: any
  // daily_winners / daily_scores change bumps refetchKey and the hook
  // re-derives normally, overriding the seed.
  const { data: standings } = usePackCategoryStandings(
    pack.id,
    data?.runId ?? null,
    pack.timezone,
    (data?.members ?? []).map((m) => m.user_id),
    data?.initialStandings ?? null,
  );

  // Previous-run rank-1 winners — drives the crown overlay on member
  // cards. Pre-fetched by Home's fetchPackMembers via
  // fetchPreviousRunWinnerIds, passed down on data. Was previously a
  // per-card usePackRunHistory cold-fetch on mount; hoisting it
  // eliminates the crown cascade (the rings hoist already eliminated
  // the ring cascade). Mirrors the Compete tab's derivation
  // (pack/[id].tsx → wonPreviousRun on GridEntry) so the two surfaces
  // still agree.
  const previousRunWinnerIds = data?.previousRunWinnerIds ?? [];

  const members = data?.members ?? [];
  const hasActivity = members.length > 0;

  // Status line — inline category-wins copy derived from standings.
  const statusLine = (() => {
    if (!standings) return "";
    const ranked = standings.rankedMembers;
    if (ranked.length === 0 || ranked.every((r) => r.totalWins === 0)) {
      return "No wins yet";
    }
    const leaderWins = ranked[0].totalWins;
    const leaders = ranked.filter((r) => r.totalWins === leaderWins);
    const winsLabel = `${leaderWins} ${leaderWins === 1 ? "win" : "wins"}`;
    if (leaders.some((r) => r.userId === currentUserId)) {
      return leaders.length > 1
        ? `Tied for the lead · ${winsLabel}`
        : `You're leading · ${winsLabel}`;
    }
    const leaderName =
      members.find((m) => m.user_id === ranked[0].userId)?.display_name ??
      "Someone";
    return `${leaderName} leads · ${winsLabel}`;
  })();

  return (
    <TouchableOpacity
      style={card.container}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {/* Row 1 — Pack name + window badge */}
      <View style={card.topRow}>
        <Text style={card.packName} numberOfLines={1}>
          {pack.name}
        </Text>
        <View style={card.badge}>
          <Text style={card.badgeText}>
            {pack.competition_window === "weekly" ? "Weekly" : "Monthly"}
          </Text>
        </View>
      </View>

      {hasActivity && data ? (
        <>
          {/* Row 2 — Mini wins rings: visual competitive snapshot */}
          <MiniRings
            members={members}
            rankedMembers={standings?.rankedMembers ?? []}
            previousRunWinnerIds={previousRunWinnerIds}
            runStart={data.runStart}
            currentUserId={currentUserId}
            packId={pack.id}
          />

          {/* Row 3 — Status: where you stand in the wins race */}
          {statusLine !== "" && (
            <Text style={card.status}>{statusLine}</Text>
          )}
        </>
      ) : (
        <Text style={card.noActivity}>{packsCopy.packCard.quietWeek}</Text>
      )}
    </TouchableOpacity>
  );
}

const card = StyleSheet.create({
  container: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: C.border,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  packName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: C.textPrimary,
  },
  badge: {
    backgroundColor: C.surfaceRaised,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: C.textSecondary,
  },
  status: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: "500",
  },
  urgency: {
    fontSize: 11,
    color: C.textTertiary,
    fontWeight: "500",
    marginTop: 3,
  },
  noActivity: {
    fontSize: 13,
    color: C.textTertiary,
    marginTop: 8,
  },
  divider: {
    height: 0.5,
    backgroundColor: C.border,
    marginVertical: 10,
  },
  todayDelta: {
    fontSize: 13,
    fontWeight: "600",
    color: C.accent,
    textAlign: "left",
  },
  // Pass 25-followup-E.2.a-home-polish-3: inline delta row replaces the
  // polish-2 two-line treatment. "+N today" + separator + "M of N goals" +
  // dot row, all siblings on a single horizontal line. Reclaims one
  // vertical line per card; with multiple packs the score context for the
  // second card no longer falls below the fold.
  deltaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  deltaSeparator: {
    fontSize: 12,
    color: C.textSecondary,
  },
  goalCount: {
    fontSize: 12,
    color: C.textSecondary,
  },
  goalDots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginLeft: 6,
  },
  goalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  victoryBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  victoryBannerIcon: {
    fontSize: 16,
  },
  victoryBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: C.textPrimary,
  },
  victoryPostBtn: {
    backgroundColor: "#2563EB",
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  victoryPostBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFF",
  },
  victoryBannerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginBottom: 10,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  useRefreshCurrentUserOnFocus();
  const { packs, isLoading, refetch } = useUserPacks(user?.id ?? null);

  const { isPro, effectivePackLimit } = useIsPro();
  const [refreshing, setRefreshing] = useState(false);
  const [packDataMap, setPackDataMap] = useState<Record<string, HomePackData>>(
    {},
  );
  // Latches true after the first fetchScores completes. Stays true across
  // realtime and logVersion refetches — same latching pattern as
  // hasLoadedOnce. Now also drives the loading gate below: the branded
  // loading state holds until this is true, so the screen swaps once to
  // fully-populated cards instead of cascading quiet-week → real data.
  const [scoresLoaded, setScoresLoaded] = useState(false);

  // Branded loading gate — genuine first load only, and now holds until
  // BOTH the pack list (isLoading) AND every pack's fetchScores
  // (scoresLoaded) have resolved. useUserPacks flips isLoading true on
  // EVERY refetch (incl. the useFocusEffect refetch + pull-to-refresh), so
  // once the first load resolves hasLoadedOnce latches and subsequent
  // refetches render stale-but-present data instead of re-showing loading.
  const hasLoadedOnce = useRef(false);
  if (!isLoading && scoresLoaded) hasLoadedOnce.current = true;
  const showLoading = (isLoading || !scoresLoaded) && !hasLoadedOnce.current;
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  // Pass 25-followup-E.2.b.iii: useUnpostedAchievements returns ALL unposted
  // achievement kinds within the 2-day window. Two consumers split the
  // result here:
  //   - dailyWinnerAchievements → existing per-pack-card banner (gated by
  //     dailyWinner flag; still false / shelved).
  //   - bannerAchievements → new Home-level banner (gated by
  //     achievementPrompts flag; took_lead only for now).
  // Hook only fetches when EITHER flag is enabled — otherwise userId stays
  // undefined and the hook short-circuits.
  const achievementsEnabled =
    FEATURE_FLAGS.dailyWinner || FEATURE_FLAGS.achievementPrompts;
  const { achievements: unpostedAchievements, refresh: refreshAchievements } =
    useUnpostedAchievements(achievementsEnabled ? user?.id : undefined);

  // Banner consumer: filters to ['took_lead'] for E.2.b.iii (all_goals
  // defers to a future iteration). Dismissal state lives in AsyncStorage —
  // we async-load the set of dismissed feedItemIds once per session, then
  // exclude them from the queue. New dismissals from the X button also
  // update this set so the banner disappears immediately without waiting
  // for a refetch.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [achievementSheet, setAchievementSheet] =
    useState<UnpostedAchievement | null>(null);

  useEffect(() => {
    if (!FEATURE_FLAGS.achievementPrompts || unpostedAchievements.length === 0)
      return;
    let cancelled = false;
    (async () => {
      const candidates = unpostedAchievements.filter(
        (a) => a.kind === "took_lead",
      );
      const checks = await Promise.all(
        candidates.map(async (a) => ({
          a,
          dismissed: await isAchievementDismissed(a.feedItemId),
        })),
      );
      if (cancelled) return;
      setDismissedIds((prev) => {
        const next = new Set(prev);
        for (const { a, dismissed } of checks) {
          if (dismissed) next.add(a.feedItemId);
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [unpostedAchievements]);

  const bannerQueueHead = useMemo<UnpostedAchievement | null>(() => {
    if (!FEATURE_FLAGS.achievementPrompts) return null;
    return (
      unpostedAchievements.find(
        (a) => a.kind === "took_lead" && !dismissedIds.has(a.feedItemId),
      ) ?? null
    );
  }, [unpostedAchievements, dismissedIds]);

  const handleBannerDismiss = useCallback((feedItemId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(feedItemId);
      return next;
    });
    markAchievementDismissed(feedItemId).catch(() => {});
  }, []);

  const logVersion = useScoreStore((s) => s.logVersion);

  useFocusEffect(
    useCallback(() => {
      // Categories pivot: the daily-winners RPC runs unconditionally now
      // (no longer gated on FEATURE_FLAGS.dailyWinner). computeDailyWinnersForPack
      // throttles to one real RPC call per pack per day via AsyncStorage.
      packs.forEach((pack) => {
        computeDailyWinnersForPack(pack.id, pack.timezone).catch(() => {});
      });
    }, [packs]),
  );

  // Refetch the user's pack list when home regains focus, so edits or
  // pack creates/deletes from other screens show immediately on return.
  // Mirrors the useRefreshCurrentUserOnFocus pattern.
  //
  // Pass 21c-followup: read-only modals (e.g., app/user/[id].tsx) signal
  // via consumeSuppressFlag() that no parent mutation occurred — skip
  // the refetch for one cycle. Default behavior (no signal) unchanged.
  const consumeSuppressFlag = useConsumeSuppressFlag();
  useFocusEffect(
    useCallback(() => {
      if (consumeSuppressFlag()) return;
      refetch();
    }, [refetch, consumeSuppressFlag]),
  );

  const handleNewPack = () => {
    if (!isPro && packs.length >= effectivePackLimit) {
      analytics.gateHit("pack_limit");
      router.push("/paywall?trigger=pack_limit");
      return;
    }
    router.push("/(app)/pack/create");
  };

  // Zero-pack case: fetchScores never runs for an empty pack list, so
  // scoresLoaded would never latch and the loading gate would hang. Latch
  // it directly here once useUserPacks has resolved (!isLoading guards
  // against the initial empty-array render latching prematurely).
  useEffect(() => {
    if (packs.length > 0) fetchPackMembers(packs);
    else if (!isLoading) setScoresLoaded(true);
  }, [packs]);

  // Re-fetch whenever the user logs an activity so home cards update immediately
  useEffect(() => {
    if (logVersion > 0 && packs.length > 0) fetchPackMembers(packs);
  }, [logVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pass 25-followup-E.1-fix-3: realtime cross-device sync for home cards.
  // Mirrors Pack Detail's inline subscription pattern (one channel per
  // active run) but spans every pack the user is in, so other members'
  // score changes update Home live without pull-to-refresh.
  //
  // The logVersion useEffect above handles same-device immediate refresh
  // (instant feedback on the local user's logs, no realtime round-trip).
  // This effect handles cross-device — when another pack member logs,
  // their daily_scores row UPDATE fires postgres_changes here and we
  // refetch. Both paths converging on the same final state is fine; the
  // double-fire on the local user's own log is acceptable redundancy.
  //
  // Stable dep via packIdsKey (sorted+joined IDs) so re-renders without a
  // pack-list change don't thrash the subscriptions.
  const packIdsKey = useMemo(
    () =>
      packs
        .map((p) => p.id)
        .sort()
        .join(","),
    [packs],
  );
  useEffect(() => {
    if (packs.length === 0) return;
    let cancelled = false;
    let unsubscribes: Array<() => void> = [];

    (async () => {
      const { data: runs } = await supabase
        .from("runs")
        .select("id")
        .in(
          "pack_id",
          packs.map((p) => p.id),
        )
        .eq("status", "active");
      if (cancelled || !runs?.length) return;

      unsubscribes = runs.map((run) =>
        subscribeToRunScores(run.id, () => fetchPackMembers(packs), "home"),
      );
    })();

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [packIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPackMembers = async (packList: Pack[]) => {
    const result: Record<string, HomePackData> = {};

    await Promise.all(
      packList.map(async (pack) => {
        // Round 1: active run + pack roster.
        const [runResult, membersResult] = await Promise.all([
          supabase
            .from("runs")
            .select("id, start_date, end_date")
            .eq("pack_id", pack.id)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("pack_members")
            .select("user_id")
            .eq("pack_id", pack.id)
            .eq("is_active", true),
        ]);

        if (!runResult.data) return;
        const run = runResult.data;
        const memberIds = (membersResult.data ?? []).map((m) => m.user_id);
        if (memberIds.length === 0) return;

        // Round 2: user display data + pre-fetched standings data
        // (hoisted from usePackCategoryStandings's Effect 1). Runs in
        // parallel — both depend only on values resolved in Round 1
        // (memberIds, run.id, pack.timezone). The two standings queries
        // are the exact ones the hook would otherwise fire on card
        // mount; we run them here so scoresLoaded only latches after
        // every pack's ring data is in hand, and seed the per-card
        // hook via initialData so rings paint correctly on first
        // frame (no cascade). Realtime subscriptions stay in the hook.
        const today = packToday(pack.timezone);
        const [
          usersResult,
          winnersResult,
          scoresResult,
          previousRunWinnerIds,
        ] = await Promise.all([
          supabase
            .from("users")
            .select("id, display_name, avatar_url")
            .in("id", memberIds),
          supabase
            .from("daily_winners")
            .select("category, winner_user_ids")
            .eq("run_id", run.id)
            .neq("category", "legacy"),
          supabase
            .from("daily_scores")
            .select(
              "user_id, steps_count, workout_count, calories_count, water_oz_count",
            )
            .eq("run_id", run.id)
            .eq("score_date", today),
          // Crown hoist: rank-1 winners of the pack's most recent
          // completed run. Pure one-shot helper — no realtime to
          // preserve. Errors degrade safely to [] inside the helper.
          fetchPreviousRunWinnerIds(pack.id),
        ]);

        const nameMap: Record<string, string> = {};
        const avatarMap: Record<string, string | null> = {};
        if (usersResult.error) {
          console.warn(
            "[fetchPackMembers] Could not read display names — check RLS policy on users table:",
            usersResult.error,
          );
        } else {
          (usersResult.data ?? []).forEach((u) => {
            if (u.display_name) nameMap[u.id] = u.display_name;
            avatarMap[u.id] = u.avatar_url ?? null;
          });
        }

        const members: HomeMember[] = memberIds.map((uid) => ({
          user_id: uid,
          display_name: formatName(nameMap[uid]),
          avatar_url: avatarMap[uid] ?? null,
        }));

        // Derive standings via the same pure helper the hook uses —
        // single source of truth, no risk of the hoisted derivation
        // drifting from the per-card hook's. Errors on either query
        // fall back to null (the seed is best-effort; if it's null the
        // hook cold-fetches normally on mount, same as today).
        let initialStandings: PackCategoryStandings | null = null;
        if (!winnersResult.error && !scoresResult.error) {
          const winnerRows = (winnersResult.data ?? []) as DailyWinnerRow[];
          const scoreRows = (scoresResult.data ?? []) as ScoreRow[];
          initialStandings = buildPackCategoryStandings(
            winnerRows,
            scoreRows,
            memberIds,
          );
        } else {
          console.warn(
            "[fetchPackMembers] standings pre-fetch failed; card will cold-fetch on mount",
            winnersResult.error ?? scoresResult.error,
          );
        }

        result[pack.id] = {
          members,
          runStart: run.start_date,
          runEnd: run.end_date,
          runId: run.id,
          initialStandings,
          previousRunWinnerIds,
        };
      }),
    );

    setPackDataMap(result);
    setScoresLoaded(true);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <PackWordmark iconSize={28} />
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.joinButton}
            onPress={() => setJoinModalVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.joinButtonText}>{packsCopy.joinShort}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => handleNewPack()}
            activeOpacity={0.8}
          >
            <Text style={styles.createButtonText}>
              {packsCopy.newPackShort}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {showLoading ? (
        <PackBrandLoadingState />
      ) : (
        <FlatList
          data={packs}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={C.textTertiary}
            />
          }
          /* Pass 25-followup-E.2.b.iii: Home-level achievement banner sits
           above the pack cards via ListHeaderComponent. Renders only the
           queue head (single banner at a time per audit C.3). */
          ListHeaderComponent={
            FEATURE_FLAGS.achievementCelebrationSheet && bannerQueueHead ? (
              <HomeAchievementBanner
                achievement={bannerQueueHead}
                onTap={() => setAchievementSheet(bannerQueueHead)}
                onDismiss={() =>
                  handleBannerDismiss(bannerQueueHead.feedItemId)
                }
              />
            ) : null
          }
          renderItem={({ item }) => (
            <DarkPackCard
              pack={item}
              data={packDataMap[item.id]}
              currentUserId={user?.id}
              onPress={() => router.push(`/(app)/pack/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            <PacksEmptyState
              onCreate={() => handleNewPack()}
              onJoin={() => setJoinModalVisible(true)}
            />
          }
          contentContainerStyle={
            packs.length === 0 ? styles.emptyList : styles.list
          }
        />
      )}

      {/* Screen-level VictoryPostSheet for banner-triggered achievements.
          Separate from the per-pack-card daily_winner sheet (shelved).
          Pass C-revised: shelved behind achievementCelebrationSheet flag. */}
      {FEATURE_FLAGS.achievementCelebrationSheet &&
        achievementSheet &&
        user?.id && (
          <VictoryPostSheet
            visible={!!achievementSheet}
            onDismiss={() => setAchievementSheet(null)}
            onPosted={() => {
              setAchievementSheet(null);
              refreshAchievements();
            }}
            achievement={{
              kind: achievementSheet.kind,
              feedItemId: achievementSheet.feedItemId,
              userId: user.id,
              packId: achievementSheet.packId,
              packName: achievementSheet.packName,
              scoreDate: achievementSheet.scoreDate,
              pointsEarned: achievementSheet.pointsEarned,
              leadGap: achievementSheet.leadGap,
              opponentName: achievementSheet.opponentName,
            }}
          />
        )}

      <JoinPackModal
        visible={joinModalVisible}
        onClose={() => setJoinModalVisible(false)}
        onJoined={(packId) => {
          setJoinModalVisible(false);
          refetch();
          router.push(`/(app)/pack/${packId}`);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: C.bg,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: C.textPrimary,
  },
  headerButtons: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  joinButton: {
    backgroundColor: C.surfaceRaised,
    borderWidth: 0.5,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  joinButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.textPrimary,
  },
  createButton: {
    backgroundColor: C.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  createButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
  list: { paddingTop: 12, paddingBottom: 24 },
  emptyList: { flexGrow: 1 },
});
