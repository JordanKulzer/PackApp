import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
  Easing,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CategoryIcon } from "../../../../src/components/CategoryIcon";
import { useAuthStore } from "../../../../src/stores/authStore";
import { supabase } from "../../../../src/lib/supabase";
import {
  usePackRunHistory,
  type CompletedRunHistory,
  type RunMemberStanding,
} from "../../../../src/hooks/usePackRunHistory";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
} from "../../../../src/lib/categories";
import { colors } from "../../../../src/theme/colors";
import { recap, den, t } from "../../../../src/constants/strings";
import { formatName, getInitial } from "../../../../src/lib/displayName";

// ── Viewer result ───────────────────────────────────────────────────────────
// Recap is shown to the whole pack when a run closes; the framing adapts to
// who is viewing. Derived from the resolved run + the current user's id.
type ViewerKind =
  | "overall-winner" // viewer is rank 1 (ties: every rank-1 member counts)
  | "podium" // viewer is rank 2 or 3
  | "category-champion" // not podium, but won >= 1 category
  | "quiet"; // none of the above, incl. viewer not in standings

interface ViewerResult {
  kind: ViewerKind;
  standing: RunMemberStanding | undefined; // viewer's standings row, if any
  categories: Category[]; // categories the viewer won (CATEGORIES order)
}

function computeViewerResult(
  run: CompletedRunHistory,
  userId: string | undefined,
): ViewerResult {
  const standing = userId
    ? run.standings.find((st) => st.userId === userId)
    : undefined;
  const categories = userId
    ? run.categoryWinners
        .filter((cw) => cw.winnerUserIds.includes(userId))
        .map((cw) => cw.category)
    : [];
  let kind: ViewerKind;
  if (standing && standing.rank === 1) {
    kind = "overall-winner";
  } else if (standing && (standing.rank === 2 || standing.rank === 3)) {
    kind = "podium";
  } else if (categories.length > 0) {
    kind = "category-champion";
  } else {
    kind = "quiet";
  }
  return { kind, standing, categories };
}

// ── Copy helpers ────────────────────────────────────────────────────────────

// "A" / "A & B" / "A & N others" — used for tied winners and category lists.
function joinLabels(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
  return `${labels[0]} & ${labels.length - 1} others`;
}

function ordinalPlace(rank: number): string {
  return rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}th`;
}

// Run-shape flavor for the hero subtitle, branched on the WINS margin
// (3g-core — the old points-margin logic is gone). A close finish is a
// 1-win gap; a runaway is a wide gap.
function pickFlavor(run: CompletedRunHistory): string {
  const st = run.standings;
  if (st.length <= 1) return recap.flavor.solo;
  if (st.filter((m) => m.rank === 1).length >= 2) return recap.flavor.tie;
  const margin = st[0].totalWins - st[1].totalWins;
  if (margin >= 4) return recap.flavor.runaway;
  if (margin <= 1) return recap.flavor.close;
  return recap.flavor.standard;
}

// Viewer-adaptive headline + subtitle. Branches on viewerResult first,
// then run-shape flavor for the subtitle.
function pickRecapHeadline(
  run: CompletedRunHistory,
  viewer: ViewerResult,
  period: string,
  winnerLabel: string,
): { headline: string; subtitle: string } {
  switch (viewer.kind) {
    case "overall-winner":
      return {
        headline: t(recap.headline.youWon, { period }),
        subtitle: pickFlavor(run),
      };
    case "podium":
      return {
        headline: t(recap.headline.youPodium, {
          place: ordinalPlace(viewer.standing?.rank ?? 0),
        }),
        subtitle: t(recap.headline.winnerWon, { winner: winnerLabel, period }),
      };
    case "category-champion":
      return {
        headline: t(recap.headline.youCategory, {
          categories: joinLabels(
            viewer.categories.map((c) => CATEGORY_LABELS[c]),
          ),
          period,
        }),
        subtitle: t(recap.headline.winnerWon, { winner: winnerLabel, period }),
      };
    case "quiet":
      return winnerLabel
        ? {
            headline: t(recap.headline.winnerWon, {
              winner: winnerLabel,
              period,
            }),
            subtitle: pickFlavor(run),
          }
        : { headline: t(recap.headline.quietRun, { period }), subtitle: "" };
  }
}

const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

function formatDateRange(startedAt: string, endedAt: string): string {
  const s = new Date(startedAt);
  const e = new Date(endedAt);
  return `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}`;
}

function AvatarCircle({
  name,
  size,
  bg,
}: {
  name: string;
  size: number;
  bg: string;
}) {
  const initial = getInitial(name);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: Math.round(size * 0.4),
          fontWeight: "700",
          color: "#FFFFFF",
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

export default function RecapScreen() {
  const { id: runId, packId } = useLocalSearchParams<{
    id: string;
    packId: string;
  }>();
  const router = useRouter();
  const userId = useAuthStore((st) => st.user?.id);
  const { completedRuns, isLoading } = usePackRunHistory(packId ?? "");
  // Celebration flourish — fires once when the viewer is the overall
  // winner. Built-in Animated only; no confetti dependency.
  const flourish = useRef(new Animated.Value(0)).current;

  // Recap copy needs "week"/"month" — CompletedRunHistory doesn't carry
  // the pack's competition_window, so fetch it directly. Defaults to
  // "week" until resolved (most packs are weekly; the flash is negligible).
  const [period, setPeriod] = useState<"week" | "month">("week");
  useEffect(() => {
    if (!packId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("packs")
        .select("competition_window")
        .eq("id", packId)
        .maybeSingle();
      if (!cancelled && data?.competition_window) {
        setPeriod(data.competition_window === "monthly" ? "month" : "week");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [packId]);

  const run = completedRuns.find((r) => r.runId === runId);
  const viewerResult = run ? computeViewerResult(run, userId) : null;

  useEffect(() => {
    if (viewerResult?.kind === "overall-winner") {
      Animated.timing(flourish, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [viewerResult?.kind, flourish]);

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!run || !viewerResult) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Recap not found</Text>
      </View>
    );
  }

  // The overall winner(s) — the rank-1 group (standings[0] is rank 1).
  const winners = run.standings.filter((st) => st.rank === 1);
  const winnerLabel = joinLabels(winners.map((w) => formatName(w.displayName)));
  const { headline, subtitle } = pickRecapHeadline(
    run,
    viewerResult,
    period,
    winnerLabel,
  );

  const nameOf = (uid: string): string =>
    run.standings.find((st) => st.userId === uid)?.displayName ?? "Member";

  // Hero avatar: the viewer for win/podium/category cases; the actual
  // winner for quiet. heroIsWinner → gold avatar + trophy.
  const isWinnerView = viewerResult.kind === "overall-winner";
  const heroIsWinner = isWinnerView || viewerResult.kind === "quiet";
  const heroName =
    viewerResult.kind === "quiet"
      ? winners[0]?.displayName ?? ""
      : viewerResult.standing?.displayName ?? "";
  // Degenerate run (no category wins at all) → no winner to show.
  const showHeroAvatar = !(
    viewerResult.kind === "quiet" && winners.length === 0
  );

  const second = run.standings[1];
  const third = run.standings[2];
  const topWins = run.standings[0]?.totalWins ?? 0;

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.weekLabel}>
          {period === "month" ? "Month" : "Week"} of{" "}
          {formatDateRange(run.startedAt, run.endedAt)}
        </Text>
      </View>

      {/* Hero — viewer-adaptive. Overall-winner gets the gold flourish. */}
      <View style={s.hero}>
        {showHeroAvatar && (
          <View style={s.heroAvatarWrap}>
            {isWinnerView && (
              <Animated.View
                style={[
                  s.goldBurst,
                  {
                    opacity: flourish.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 0.28],
                    }),
                    transform: [
                      {
                        scale: flourish.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.4, 1],
                        }),
                      },
                    ],
                  },
                ]}
              />
            )}
            <Animated.View
              style={[
                s.heroAvatarInner,
                isWinnerView && {
                  opacity: flourish,
                  transform: [
                    {
                      scale: flourish.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.7, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              {heroIsWinner && <Text style={s.trophy}>🏆</Text>}
              <AvatarCircle
                name={heroName}
                size={72}
                bg={heroIsWinner ? colors.leader : colors.accent}
              />
            </Animated.View>
          </View>
        )}
        <Text style={s.headlineText}>{headline}</Text>
        {subtitle ? (
          <Text style={s.headlineSubtitle}>{subtitle}</Text>
        ) : null}
      </View>

      {/* Category Champions — per-category run winners + days won. */}
      {run.categoryWinners.length > 0 && (
        <View style={s.card}>
          <Text style={s.sectionTitle}>CATEGORY CHAMPIONS</Text>
          {CATEGORIES.map((category) => {
            const cw = run.categoryWinners.find((c) => c.category === category);
            if (!cw) return null;
            const label = joinLabels(
              cw.winnerUserIds.map((uid) => formatName(nameOf(uid))),
            );
            const isMe = !!userId && cw.winnerUserIds.includes(userId);
            return (
              <View key={category} style={[s.champRow, isMe && s.rowMe]}>
                {/* Per-category icon (was a Crown). Crown is reserved for
                    overall winners now; this site labels WHICH category
                    was won. Neutral colors.member — the surrounding
                    CATEGORY CHAMPIONS header + gold isMe row treatment
                    still carry the winner semantics. */}
                <CategoryIcon
                  category={category}
                  size={15}
                  color={colors.member}
                />
                <Text style={s.champCategory}>
                  {CATEGORY_LABELS[category]}
                </Text>
                <Text style={s.champName} numberOfLines={1}>
                  {label}
                </Text>
                <Text style={s.champDays}>
                  {cw.totalDaysWon} {cw.totalDaysWon === 1 ? "day" : "days"}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Podium — #2 and #3 */}
      {second && third && (
        <View style={s.podium}>
          <View style={s.podiumSlot}>
            <AvatarCircle name={second.displayName} size={40} bg="#1F2937" />
            <Text style={s.podiumRank}>#2</Text>
            <Text style={s.podiumName} numberOfLines={1}>
              {formatName(second.displayName)}
            </Text>
            <Text style={s.podiumWins}>
              {second.totalWins} {second.totalWins === 1 ? "win" : "wins"}
            </Text>
          </View>
          <View style={s.podiumSlot}>
            <AvatarCircle name={third.displayName} size={40} bg="#1F2937" />
            <Text style={s.podiumRank}>#3</Text>
            <Text style={s.podiumName} numberOfLines={1}>
              {formatName(third.displayName)}
            </Text>
            <Text style={s.podiumWins}>
              {third.totalWins} {third.totalWins === 1 ? "win" : "wins"}
            </Text>
          </View>
        </View>
      )}

      {/* Full standings */}
      {run.standings.length > 0 && (
        <View style={s.card}>
          <Text style={s.sectionTitle}>
            {den.standings.title.toUpperCase()}
          </Text>
          {run.standings.map((standing) => {
            const barPct =
              topWins > 0
                ? Math.min(
                    100,
                    Math.round((standing.totalWins / topWins) * 100),
                  )
                : 0;
            const isMe = !!userId && standing.userId === userId;
            return (
              <View
                key={standing.userId}
                style={[s.standingRow, isMe && s.rowMe]}
              >
                <Text style={s.standingRank}>#{standing.rank}</Text>
                <View style={s.standingInfo}>
                  <View style={s.standingMeta}>
                    <Text style={s.standingName} numberOfLines={1}>
                      {formatName(standing.displayName, standing.rank)}
                    </Text>
                    <Text style={s.standingWins}>
                      {standing.totalWins}{" "}
                      {standing.totalWins === 1 ? "win" : "wins"}
                    </Text>
                  </View>
                  <View style={s.barTrack}>
                    <View
                      style={[
                        s.barFill,
                        {
                          width: `${barPct}%` as `${number}%`,
                          backgroundColor:
                            standing.rank === 1
                              ? colors.leader
                              : colors.accent,
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* CTA */}
      <TouchableOpacity
        style={s.ctaBtn}
        onPress={() => router.replace(`/(app)/pack/${packId}` as any)}
        activeOpacity={0.85}
      >
        <Text style={s.ctaText}>{recap.cta}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#0A0A0A" },
  content: { paddingBottom: 48 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A0A0A",
  },
  errorText: { color: "#9CA3AF", fontSize: 16 },
  header: {
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  backText: { color: "#9CA3AF", fontSize: 15, fontWeight: "500" },
  weekLabel: {
    fontSize: 13,
    color: "#9CA3AF",
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  // Hero — viewer-adaptive celebration block.
  hero: {
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 10,
  },
  heroAvatarWrap: {
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  // Soft radial gold glow behind the winner avatar — a plain View (no
  // confetti / blur dependency); opacity + scale animate in via `flourish`.
  goldBurst: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.leader,
  },
  heroAvatarInner: { alignItems: "center", gap: 6 },
  trophy: { fontSize: 44 },
  headlineText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  headlineSubtitle: {
    fontSize: 14,
    color: "#9CA3AF",
    textAlign: "center",
  },
  // Cards — Category Champions + Full standings.
  card: {
    backgroundColor: "#111827",
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.0,
    marginBottom: 12,
  },
  // Viewer's own row highlight (Category Champions + standings).
  rowMe: {
    backgroundColor: "rgba(47,129,247,0.10)",
    borderRadius: 8,
    marginHorizontal: -8,
    paddingHorizontal: 8,
  },
  // Category Champions rows
  champRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1F2937",
  },
  champCategory: {
    fontSize: 13,
    fontWeight: "600",
    color: "#9CA3AF",
    width: 76,
  },
  champName: { flex: 1, fontSize: 14, fontWeight: "600", color: "#FFFFFF" },
  champDays: { fontSize: 12, fontWeight: "600", color: "#9CA3AF" },
  // Podium
  podium: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 48,
    paddingVertical: 24,
  },
  podiumSlot: { alignItems: "center", gap: 6 },
  podiumRank: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  podiumName: {
    fontSize: 13,
    color: "#FFFFFF",
    fontWeight: "600",
    maxWidth: 88,
    textAlign: "center",
  },
  podiumWins: { fontSize: 12, color: "#9CA3AF" },
  // Full standings rows
  standingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1F2937",
  },
  standingRank: { fontSize: 13, color: "#9CA3AF", width: 28 },
  standingInfo: { flex: 1, gap: 6 },
  standingMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  standingName: {
    fontSize: 14,
    color: "#FFFFFF",
    fontWeight: "600",
    flex: 1,
  },
  standingWins: { fontSize: 14, color: "#FFFFFF", fontWeight: "700" },
  barTrack: {
    height: 3,
    backgroundColor: "#1F2937",
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: { height: 3, borderRadius: 2 },
  ctaBtn: {
    backgroundColor: colors.accent,
    marginHorizontal: 16,
    marginTop: 24,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  ctaText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
});
