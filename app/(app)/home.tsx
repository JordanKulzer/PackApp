import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../src/stores/authStore";
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
}

interface HomePackData {
  scores: HomeScore[]; // sorted by weekly_points desc
  runStart: string; // ISO date — for weekly max denominator
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
// Mini Rings Row — [#2][#1 elevated][#3] or solo/duo layouts
// Uses PackMemberDisplay for consistent ring/badge/name rendering with Pack screen.
// ─────────────────────────────────────────────────────────────────────────────

const STRIP_SIZE_CARD = 30;
const STRIP_SW_CARD = 3;
const STRIP_MAX_CARD = 5; // max visible strip rings before "+N" pill

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
  const top3 = scores.slice(0, 3);
  const rest = scores.slice(3); // ranks 4+
  const maxPoints = maxRunPointsForPeriod(pack, runStart, runEnd);
  const leaderId = scores[0]?.user_id;

  if (top3.length === 0) return null;

  // Podium order: [#2, #1, #3] — mirrors Pack screen layout at smaller scale
  const podium: Array<{ entry: HomeScore; rank: number } | null> = [
    top3[1] ? { entry: top3[1], rank: 2 } : null,
    { entry: top3[0], rank: 1 },
    top3[2] ? { entry: top3[2], rank: 3 } : null,
  ];

  const stripVisible = rest.slice(0, STRIP_MAX_CARD);
  const stripMore = rest.length - stripVisible.length;

  return (
    <View style={miniRingS.wrapper}>
      {/* Podium: [#2] [#1 elevated] [#3] */}
      <View style={miniRingS.row}>
        {podium.map((slot, pos) => {
          if (!slot) {
            return <View key={`ph-${pos}`} style={{ width: 56 }} />;
          }
          const { entry, rank } = slot;
          const isFirst = rank === 1;
          const size = isFirst ? 52 : 38;
          const sw = isFirst ? 5 : 4;
          const pct = miniRingPct(entry.weekly_points, maxPoints);
          return (
            <View
              key={entry.user_id}
              style={[
                { width: size + 12, alignItems: "center" },
                isFirst && miniRingS.elevated,
              ]}
            >
              <PackMemberDisplay
                userId={entry.user_id}
                displayName={entry.display_name}
                progressPct={pct}
                rank={rank}
                currentUserId={currentUserId}
                leaderId={leaderId}
                size={size}
                strokeWidth={sw}
              />
            </View>
          );
        })}
      </View>

      {/* Strip: ranks 4+ as a compact horizontal row */}
      {stripVisible.length > 0 && (
        <View style={miniRingS.strip}>
          {stripVisible.map((entry, i) => {
            const rank = i + 4;
            const pct = miniRingPct(entry.weekly_points, maxPoints);
            return (
              <PackMemberDisplay
                key={entry.user_id}
                userId={entry.user_id}
                displayName={entry.display_name}
                progressPct={pct}
                rank={rank}
                currentUserId={currentUserId}
                leaderId={leaderId}
                size={STRIP_SIZE_CARD}
                strokeWidth={STRIP_SW_CARD}
                showName={false}
              />
            );
          })}
          {stripMore > 0 && (
            <View style={miniRingS.morePill}>
              <Text style={miniRingS.morePillText}>+{stripMore}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const miniRingS = StyleSheet.create({
  wrapper: { paddingVertical: 14 },
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 12,
  },
  elevated: { marginBottom: 10 },
  strip: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: 10,
    marginTop: 10,
  },
  morePill: {
    backgroundColor: C.surfaceRaised,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 0.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  morePillText: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textSecondary,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty state illustration — three ghost rings in podium layout
// ─────────────────────────────────────────────────────────────────────────────

function EmptyRingsIllustration() {
  const slots: Array<{ size: number; sw: number; elevated: boolean }> = [
    { size: 44, sw: 4, elevated: false }, // #2 left
    { size: 60, sw: 5, elevated: true }, // #1 center
    { size: 44, sw: 4, elevated: false }, // #3 right
  ];

  return (
    <View style={ghostRing.row}>
      {slots.map(({ size, sw, elevated }, i) => {
        const radius = (size - sw) / 2;
        const avatarR = radius * 0.52;
        return (
          <View
            key={i}
            style={[ghostRing.slot, elevated && ghostRing.elevated]}
          >
            <Svg width={size} height={size}>
              {/* Track ring */}
              <Circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="#252E3D"
                strokeWidth={sw}
                fill="none"
              />
              {/* Avatar placeholder disc */}
              <Circle cx={size / 2} cy={size / 2} r={avatarR} fill="#1A2232" />
            </Svg>
          </View>
        );
      })}
    </View>
  );
}

const ghostRing = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 14,
    marginBottom: 8,
  },
  slot: { alignItems: "center" },
  elevated: { marginBottom: 14 },
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
      <EmptyRingsIllustration />

      <Text style={emptyS.title}>No packs yet</Text>
      <Text style={emptyS.subtitle}>
        Create a pack or join one with an invite code
      </Text>

      <View style={emptyS.actions}>
        <TouchableOpacity
          style={emptyS.primaryBtn}
          onPress={onCreate}
          activeOpacity={0.8}
        >
          <Text style={emptyS.primaryBtnText}>Create your first pack</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={emptyS.joinLink}
          onPress={onJoin}
          activeOpacity={0.7}
        >
          <Text style={emptyS.joinLinkText}>Join with invite code →</Text>
        </TouchableOpacity>

        {/* TODO: "See how Pack works" → open onboarding walkthrough (v2) */}
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
  const myOptimistic = useScoreStore((s) => s.myScores[pack.id]);

  const rawScores = data?.scores ?? [];

  // Apply optimistic weekly_points overlay so Home card matches Pack screen
  // immediately after logging, without waiting for fetchScores to complete.
  const scores = (() => {
    if (!myOptimistic || !currentUserId) return rawScores;
    const myIdx = rawScores.findIndex((s) => s.user_id === currentUserId);
    if (myIdx < 0) return rawScores;
    const patched = rawScores.map((s, i) =>
      i === myIdx ? { ...s, weekly_points: myOptimistic.weekly_points } : s,
    );
    return patched.sort((a, b) => b.weekly_points - a.weekly_points);
  })();

  const myIndex = scores.findIndex((s) => s.user_id === currentUserId);
  const myScore = myIndex >= 0 ? scores[myIndex] : null;
  const statusLine = buildRankStatus(scores, currentUserId);
  const urgency = data
    ? buildUrgencyHint(scores, currentUserId, packDailyMax(pack), data.runEnd)
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

          {/* Row 4 — Your weekly total (only when user has scored) */}
          {myScore && (
            <>
              <View style={card.divider} />
              <View style={card.myRow}>
                <Text style={card.myName}>You</Text>
                <Text style={card.myPts}>{myScore.weekly_points} pts</Text>
              </View>
            </>
          )}
        </>
      ) : (
        <Text style={card.noActivity}>No activity yet this week</Text>
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
  myRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  myName: {
    fontSize: 13,
    fontWeight: "600",
    color: C.accent,
  },
  myPts: {
    fontSize: 13,
    fontWeight: "700",
    color: C.textPrimary,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { packs, isLoading, refetch } = useUserPacks(user?.id ?? null);
  const { isPro, effectivePackLimit } = useIsPro();
  const [refreshing, setRefreshing] = useState(false);
  const [packDataMap, setPackDataMap] = useState<Record<string, HomePackData>>(
    {},
  );
  const [joinModalVisible, setJoinModalVisible] = useState(false);

  const logVersion = useScoreStore((s) => s.logVersion);

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
        // Fetch the active run with date range (needed for weekly max denominator)
        const { data: run } = await supabase
          .from("runs")
          .select("id, start_date, end_date")
          .eq("pack_id", pack.id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!run) return;

        // Weekly totals: all daily_scores for this run, no date filter
        const { data: allScores } = await supabase
          .from("daily_scores")
          .select("user_id, total_points")
          .eq("run_id", run.id);

        if (!allScores || allScores.length === 0) return;

        // Aggregate per user across all run dates
        const totals: Record<string, number> = {};
        allScores.forEach((row) => {
          totals[row.user_id] = (totals[row.user_id] ?? 0) + row.total_points;
        });

        // Resolve display names
        const userIds = Object.keys(totals);
        const nameMap: Record<string, string> = {};
        const { data: userRows, error: usersError } = await supabase
          .from("users")
          .select("id, display_name")
          .in("id", userIds);

        if (usersError) {
          console.warn(
            "[fetchScores] Could not read display names — check RLS policy on users table:",
            usersError,
          );
        } else if (userRows) {
          userRows.forEach((u) => {
            if (u.display_name) nameMap[u.id] = u.display_name;
          });
        }

        const sorted: HomeScore[] = Object.entries(totals)
          .map(([user_id, weekly_points]) => ({ user_id, weekly_points }))
          .sort((a, b) => b.weekly_points - a.weekly_points)
          .map((entry, i) => ({
            user_id: entry.user_id,
            display_name: formatName(nameMap[entry.user_id], i + 1),
            weekly_points: entry.weekly_points,
          }));

        result[pack.id] = {
          scores: sorted,
          runStart: run.start_date,
          runEnd: run.end_date,
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
        <Text style={styles.title}>Packs</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.joinButton}
            onPress={() => setJoinModalVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.joinButtonText}>Join</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => handleNewPack()}
            activeOpacity={0.8}
          >
            <Text style={styles.createButtonText}>+ New Pack</Text>
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
