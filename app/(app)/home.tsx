import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useAuthStore } from "../../src/stores/authStore";
import { packToday } from "../../src/lib/packDates";
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
import { useUnpostedWins, UnpostedWin } from "../../src/hooks/useUnpostedWins";
import { VictoryPostSheet } from "../../src/components/VictoryPostSheet";
import { FEATURE_FLAGS } from "../../src/lib/featureFlags";
import { PackLogo, PackWordmark } from "../../src/components/brand/PackLogo";
import { packs as packsCopy } from "../../src/constants/strings";
import { BrandColors } from "../../src/constants/brand";

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

interface HomeScore {
  user_id: string;
  display_name: string;
  weekly_points: number; // total accumulated this run — never daily
  avatar_url?: string | null;
  rank: number; // dense rank by weekly_points (1,1,3,3 style)
}

interface HomePackData {
  scores: HomeScore[]; // sorted by weekly_points desc
  runStart: string; // ISO date — for weekly max denominator
  runEnd: string;
  myTodayPoints: number; // current user's points logged today only (not weekly)
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

const MEMBER_RING_SIZE = 60;
const MEMBER_RING_STROKE = 5;

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
  currentUser: { id: string; displayName: string; avatarUrl: string | null } | null;
}) {
  const router = useRouter();
  const pct = miniRingPct(entry.weekly_points, maxPoints);
  const isMe = entry.user_id === currentUser?.id;
  const displayName =
    isMe && currentUser ? currentUser.displayName : entry.display_name;
  const avatarUrl =
    isMe && currentUser ? currentUser.avatarUrl : entry.avatar_url;
  return (
    <TouchableOpacity
      style={miniRingS.memberCard}
      onPress={() => {
        router.push(`/user/${entry.user_id}` as any);
      }}
      activeOpacity={0.7}
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
      />
      <Text style={miniRingS.memberPts} numberOfLines={1}>
        {entry.weekly_points} pts
      </Text>
    </TouchableOpacity>
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
    width: 88,
    gap: 4,
  },
  memberPts: {
    fontSize: 11,
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
          <Text style={emptyS.primaryBtnText}>{packsCopy.empty.primaryCta}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={emptyS.joinLink}
          onPress={onJoin}
          activeOpacity={0.7}
        >
          <Text style={emptyS.joinLinkText}>{packsCopy.empty.secondaryCta}</Text>
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
  unpostedWin,
  onWinPosted,
  onPress,
}: {
  pack: Pack;
  data: HomePackData | undefined;
  currentUserId: string | undefined;
  currentUserAuthId: string | undefined;
  unpostedWin: UnpostedWin | undefined;
  onWinPosted: () => void;
  onPress: () => void;
}) {
  const [victorySheetOpen, setVictorySheetOpen] = useState(false);
  const myOptimistic = useScoreStore((s) => s.myScores[pack.id]);

  const rawScores = data?.scores ?? [];

  // Apply optimistic weekly_points overlay so Home card matches Pack screen
  // immediately after logging, without waiting for fetchScores to complete.
  const scores = (() => {
    if (!myOptimistic || !currentUserId) return rawScores;
    const myIdx = rawScores.findIndex((s) => s.user_id === currentUserId);
    if (myIdx < 0) return rawScores;
    const patched = rawScores
      .map((s, i) => i === myIdx ? { ...s, weekly_points: myOptimistic.weekly_points } : s)
      .sort((a, b) => b.weekly_points - a.weekly_points);
    // Recompute dense ranks after re-sort
    let lastPts = -1, lastRank = 0;
    return patched.map((s, i) => {
      if (s.weekly_points !== lastPts) { lastRank = i + 1; lastPts = s.weekly_points; }
      return { ...s, rank: lastRank };
    });
  })();

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
    rawUrgency &&
    (rawUrgency.endsWith("h left") || rawUrgency === "Final day")
      ? rawUrgency
      : null;
  const hasActivity = scores.length > 0;

  // Daily delta footer: prefer the optimistic store (updates immediately on
  // log) over the DB-fetched value (cold-launch source of truth). Hide
  // entirely when zero — empty state shouldn't read as a celebratory delta.
  const todayPts = myOptimistic?.total_points ?? data?.myTodayPoints ?? 0;
  const showDelta = todayPts > 0;

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

      {/* Victory banner */}
      {unpostedWin && (
        <>
          <View style={card.victoryBanner}>
            <Text style={card.victoryBannerIcon}>🏆</Text>
            <Text style={card.victoryBannerText}>Yesterday's winner</Text>
            <TouchableOpacity
              style={card.victoryPostBtn}
              onPress={() => setVictorySheetOpen(true)}
              activeOpacity={0.8}
              hitSlop={6}
            >
              <Text style={card.victoryPostBtnText}>Post</Text>
            </TouchableOpacity>
          </View>
          <View style={card.victoryBannerDivider} />
        </>
      )}

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
          {showDelta && (
            <>
              <View style={card.divider} />
              <Text style={card.todayDelta}>+{todayPts} today</Text>
            </>
          )}
        </>
      ) : (
        <Text style={card.noActivity}>{packsCopy.packCard.quietWeek}</Text>
      )}

      {unpostedWin && victorySheetOpen && (
        <VictoryPostSheet
          feedItemId={unpostedWin.feedItemId}
          userId={currentUserAuthId ?? ""}
          packName={pack.name}
          winningPoints={unpostedWin.winningPoints}
          scoreDate={unpostedWin.scoreDate}
          visible={victorySheetOpen}
          onClose={() => setVictorySheetOpen(false)}
          onPosted={() => { setVictorySheetOpen(false); onWinPosted(); }}
        />
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
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const { wins: unpostedWins, refresh: refreshWins } = useUnpostedWins(
    FEATURE_FLAGS.dailyWinner ? user?.id : undefined,
  );

  const logVersion = useScoreStore((s) => s.logVersion);

  useFocusEffect(
    useCallback(() => {
      if (!FEATURE_FLAGS.dailyWinner) return;
      packs.forEach((pack) => {
        computeDailyWinnersForPack(pack.id).catch(() => {});
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

  useEffect(() => {
    if (packs.length > 0) fetchScores(packs);
  }, [packs]);

  // Re-fetch whenever the user logs an activity so home cards update immediately
  useEffect(() => {
    if (logVersion > 0 && packs.length > 0) fetchScores(packs);
  }, [logVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchScores = async (packList: Pack[]) => {
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

        // Fetch weekly scores + user info for all members in parallel
        const [scoresResult, usersResult] = await Promise.all([
          supabase
            .from("daily_scores")
            .select("user_id, total_points, score_date")
            .eq("run_id", run.id),
          supabase
            .from("users")
            .select("id, display_name, avatar_url")
            .in("id", memberIds),
        ]);

        // Aggregate weekly totals per user across all run dates, and extract
        // the current user's today-only points for the "+N today" footer
        // delta. Pack timezone resolves the right calendar day even if the
        // device clock differs.
        const today = packToday(pack.timezone ?? "UTC");
        const totals: Record<string, number> = {};
        let myTodayPoints = 0;
        (scoresResult.data ?? []).forEach((row) => {
          totals[row.user_id] = (totals[row.user_id] ?? 0) + row.total_points;
          if (row.user_id === user?.id && row.score_date === today) {
            myTodayPoints = row.total_points;
          }
        });

        // Build name/avatar maps
        const nameMap: Record<string, string> = {};
        const avatarMap: Record<string, string | null> = {};
        if (usersResult.error) {
          console.warn(
            "[fetchScores] Could not read display names — check RLS policy on users table:",
            usersResult.error,
          );
        } else {
          (usersResult.data ?? []).forEach((u) => {
            if (u.display_name) nameMap[u.id] = u.display_name;
            avatarMap[u.id] = u.avatar_url ?? null;
          });
        }

        // All active members, 0 pts for those who haven't logged yet
        const unsorted = memberIds.map((uid) => ({
          user_id: uid,
          weekly_points: totals[uid] ?? 0,
        }));

        // Sort: weekly_points DESC, display_name ASC (deterministic tie order)
        unsorted.sort((a, b) => {
          const ptsDiff = b.weekly_points - a.weekly_points;
          if (ptsDiff !== 0) return ptsDiff;
          return (nameMap[a.user_id] ?? "").localeCompare(nameMap[b.user_id] ?? "");
        });

        // Dense rank by weekly_points (1,1,3,3 style)
        let lastPts = -1;
        let lastRank = 0;
        const sorted: HomeScore[] = unsorted.map((entry, i) => {
          if (entry.weekly_points !== lastPts) {
            lastRank = i + 1;
            lastPts = entry.weekly_points;
          }
          return {
            user_id: entry.user_id,
            display_name: formatName(nameMap[entry.user_id], lastRank),
            weekly_points: entry.weekly_points,
            avatar_url: avatarMap[entry.user_id] ?? null,
            rank: lastRank,
          };
        });

        result[pack.id] = {
          scores: sorted,
          runStart: run.start_date,
          runEnd: run.end_date,
          myTodayPoints,
        };
      }),
    );

    setPackDataMap(result);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

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
            <Text style={styles.createButtonText}>{packsCopy.newPackShort}</Text>
          </TouchableOpacity>
        </View>
      </View>

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
        renderItem={({ item }) => (
          <DarkPackCard
            pack={item}
            data={packDataMap[item.id]}
            currentUserId={user?.id}
            currentUserAuthId={user?.id}
            unpostedWin={unpostedWins.find((w) => w.packId === item.id)}
            onWinPosted={refreshWins}
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
