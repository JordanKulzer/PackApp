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
import { useRouter, useFocusEffect } from "expo-router";
import { useAuthStore } from "../../src/stores/authStore";
import { useConsumeSuppressFlag } from "../../src/context/ModalMutationContext";
import { useScoreStore } from "../../src/stores/scoreStore";
import { useUserPacks } from "../../src/hooks/usePack";
import { useIsPro } from "../../src/hooks/useIsPro";
import { supabase } from "../../src/lib/supabase";
import { formatName } from "../../src/lib/displayName";
import { PackMemberDisplay } from "../../src/components/PackMemberDisplay";
import {
  buildRankStatus,
  buildUrgencyHint,
} from "../../src/lib/competitionCopy";
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function maxRunPointsForPeriod(
  pack: Pack,
  runStart: string,
  runEnd: string,
): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.max(
    1,
    Math.round(
      (new Date(runEnd).getTime() - new Date(runStart).getTime()) / msPerDay,
    ),
  );
  let dailyMax = 0;
  if (pack.steps_enabled) dailyMax += 10;
  if (pack.workouts_enabled) dailyMax += 30; // up to 2 workouts × 15 pts
  if (pack.calories_enabled) dailyMax += 10;
  if (pack.water_enabled) dailyMax += 8;
  return dailyMax * days;
}

function miniRingPct(weeklyPoints: number, maxPoints: number): number {
  if (maxPoints === 0) return 0;
  return Math.min(100, Math.round((weeklyPoints / maxPoints) * 100));
}

function packDailyMax(pack: Pack): number {
  let max = 0;
  if (pack.steps_enabled) max += 10;
  if (pack.workouts_enabled) max += 15;
  if (pack.calories_enabled) max += 10;
  if (pack.water_enabled) max += 8;
  return max;
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
  maxPoints,
  currentUserId,
  leaderId,
  currentUser,
}: {
  entry: HomeScore;
  maxPoints: number;
  currentUserId: string | undefined;
  leaderId: string | undefined;
  currentUser: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
}) {
  const router = useRouter();
  const pct = miniRingPct(entry.weekly_points, maxPoints);
  const isMe = entry.user_id === currentUser?.id;
  const displayName =
    isMe && currentUser ? currentUser.displayName : entry.display_name;
  const avatarUrl =
    isMe && currentUser ? currentUser.avatarUrl : entry.avatar_url;
  // Pass 25-followup-E.2.a-home-polish: narrowed tap region. Only the
  // avatar (PackMemberDisplay) is wrapped in a Pressable → profile.
  // Name + meta lines fall through to the card-level TouchableOpacity →
  // Pack Detail. Was: entire cell wrapped → profile (overrode card tap).
  const isLeader = entry.rank === 1;
  const nameColor = isMe ? colors.self : colors.member;
  return (
    <View style={miniRingS.memberCard}>
      <TouchableOpacity
        onPress={() => {
          router.push(`/user/${entry.user_id}` as any);
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
      <Text
        style={[miniRingS.memberName, { color: nameColor }]}
        numberOfLines={1}
      >
        {displayName}
      </Text>
      <Text style={miniRingS.memberMeta} numberOfLines={1}>
        <Text
          style={{
            color: isLeader ? colors.leader : nameColor,
            fontWeight: "700",
          }}
        >
          #{entry.rank}
        </Text>
        {` · ${entry.weekly_points} pts`}
      </Text>
    </View>
  );
}

function MiniRings({
  scores,
  pack,
  runStart,
  runEnd,
  currentUserId,
}: {
  scores: HomeScore[];
  pack: Pack;
  runStart: string;
  runEnd: string;
  currentUserId: string | undefined;
}) {
  const { user: currentUser } = useCurrentUser();
  const maxPoints = maxRunPointsForPeriod(pack, runStart, runEnd);

  // Sort: pts desc, alpha within same-pts groups (deterministic tie order).
  // The optimistic-update overlay in DarkPackCard recomputes ranks after
  // re-sort; MemberCard reads entry.rank directly, so the gold-leader and
  // top-3 badges stay correct after a self-log without a full refetch.
  const sorted = [...scores].sort((a, b) =>
    b.weekly_points !== a.weekly_points
      ? b.weekly_points - a.weekly_points
      : a.display_name.localeCompare(b.display_name),
  );

  if (sorted.length === 0) return null;

  const leaderId = sorted[0].user_id;

  // Solo-pack: center a single card. ScrollView with one child left-aligns
  // and looks broken; the standalone <View> matches the prior solo layout
  // visually (no scroll affordance, just the centered ring).
  if (sorted.length === 1) {
    return (
      <View style={miniRingS.wrapper}>
        <View style={miniRingS.solo}>
          <MemberCard
            entry={sorted[0]}
            maxPoints={maxPoints}
            currentUserId={currentUserId}
            leaderId={leaderId}
            currentUser={currentUser}
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
        {sorted.map((entry) => (
          <MemberCard
            key={entry.user_id}
            entry={entry}
            maxPoints={maxPoints}
            currentUserId={currentUserId}
            leaderId={leaderId}
            currentUser={currentUser}
          />
        ))}
      </ScrollView>
      {/* Right-edge gradient overlay removed in Pass 25-followup-E.2.a-
          home-polish-3-fix: it faded over the last avatar when scrolled to
          the end. The 2.5-avatar partial visibility at initial scroll
          position is the natural mobile convention for "scroll for more"
          (App Store, Spotify, Apple Music etc.) — works without chrome. */}
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
  memberName: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
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
  currentUserAuthId,
  onPress,
}: {
  pack: Pack;
  data: HomePackData | undefined;
  currentUserId: string | undefined;
  currentUserAuthId: string | undefined;
  onPress: () => void;
}) {
  const rawScores = data?.scores ?? [];

  // Optimistic overlay dropped (Stage 3e-prep) — DarkPackCard reads straight
  // from the data prop now. 3e-core rebuilds this card on the categories model.
  const scores = rawScores;

  const statusLine = buildRankStatus(scores, currentUserId);
  const rawUrgency = data
    ? buildUrgencyHint(scores, currentUserId, packDailyMax(pack), data.runEnd)
    : null;
  // Pass 21a-polish: keep only time-pressure hints, drop competitive filler
  // ("can still catch up", "One strong day…"). End-of-day pressure has real
  // utility; competitive filler doesn't carry weight at this surface.
  // KEEP IN SYNC with src/lib/competitionCopy.ts buildUrgencyHint time outputs.
  // Brittle string-match — see backlog: refactor buildUrgencyHint to return
  // a typed result { kind: 'time_pressure' | 'competitive_filler', text }
  // when that helper gets revisited for voice work.
  const urgency =
    rawUrgency && (rawUrgency.endsWith("h left") || rawUrgency === "Final day")
      ? rawUrgency
      : null;
  const hasActivity = scores.length > 0;

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
          {/* Row 2 — Mini weekly rings: visual competitive snapshot */}
          <MiniRings
            scores={scores}
            pack={pack}
            runStart={data.runStart}
            runEnd={data.runEnd}
            currentUserId={currentUserId}
          />

          {/* Row 3 — Status: where you stand in the weekly race */}
          <Text style={card.status}>{statusLine}</Text>
          {urgency && <Text style={card.urgency}>{urgency}</Text>}

          {/* Row 4 — Today's points delta (hidden when 0) */}
          {/* TODO(voice review): "+{N} today" placeholder copy. */}
          {/* Delta row (Pass 25-followup-E.2.a-home-polish-3): inline single-
              line layout. "+N today" + separator + "M of N goals" + tiny dot
              row, all siblings sharing one flexbox row. Replaces the polish-2
              two-line treatment that wasted horizontal real estate on the
              right half of each line. Conditional separator + goal section
              when at least one goal is enabled; otherwise the row collapses
              to just "+N today". Entire row hidden when showDelta === false. */}
          {showDelta &&
            (() => {
              const segments = [
                {
                  key: "steps",
                  enabled: pack.steps_enabled,
                  hit: data.myAchievements.steps,
                },
                {
                  key: "workout",
                  enabled: pack.workouts_enabled,
                  hit: data.myAchievements.workout,
                },
                {
                  key: "calories",
                  enabled: pack.calories_enabled,
                  hit: data.myAchievements.calories,
                },
                {
                  key: "water",
                  enabled: pack.water_enabled,
                  hit: data.myAchievements.water,
                },
              ].filter((s) => s.enabled);
              const hitCount = segments.filter((s) => s.hit).length;
              return (
                <>
                  <View style={card.divider} />
                  <View style={card.deltaRow}>
                    <Text style={card.todayDelta}>+{todayPts} today</Text>
                    {segments.length > 0 && (
                      <>
                        <Text style={card.deltaSeparator}> · </Text>
                        <Text style={card.goalCount}>
                          {hitCount} of {segments.length} goals
                        </Text>
                        <View style={card.goalDots}>
                          {segments.map((s) => (
                            <View
                              key={s.key}
                              style={[
                                card.goalDot,
                                {
                                  backgroundColor: s.hit ? C.success : C.border,
                                },
                              ]}
                            />
                          ))}
                        </View>
                      </>
                    )}
                  </View>
                </>
              );
            })()}
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
        // Fetch active run + all active pack members in parallel
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

        // Resolve display name + avatar for every active member. The
        // categories-model standings are loaded per-card by 3e-core via
        // usePackCategoryStandings — this layer only builds the roster.
        const usersResult = await supabase
          .from("users")
          .select("id, display_name, avatar_url")
          .in("id", memberIds);

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

        result[pack.id] = {
          members,
          runStart: run.start_date,
          runEnd: run.end_date,
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
              currentUserAuthId={user?.id}
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
