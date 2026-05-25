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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
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
// Self-voice — paired with the youWon headline (the reader is the winner).
function pickFlavor(run: CompletedRunHistory): string {
  const st = run.standings;
  if (st.length <= 1) return recap.flavor.solo;
  if (st.filter((m) => m.rank === 1).length >= 2) return recap.flavor.tie;
  const margin = st[0].totalWins - st[1].totalWins;
  if (margin >= 4) return recap.flavor.runaway;
  if (margin <= 1) return recap.flavor.close;
  return recap.flavor.standard;
}

// Observer voice — paired with the winnerWon headline on the quiet run
// branch (a non-winner viewer reading about someone else's win; "you"
// would be wrong). Same wins-margin branching as pickFlavor; reads from
// recap.flavorObserver and interpolates {winner} / {period} via t().
function pickFlavorObserver(
  run: CompletedRunHistory,
  winner: string,
  period: string,
): string {
  const st = run.standings;
  let template: string;
  if (st.length <= 1) {
    template = recap.flavorObserver.solo;
  } else if (st.filter((m) => m.rank === 1).length >= 2) {
    template = recap.flavorObserver.tie;
  } else {
    const margin = st[0].totalWins - st[1].totalWins;
    if (margin >= 4) template = recap.flavorObserver.runaway;
    else if (margin <= 1) template = recap.flavorObserver.close;
    else template = recap.flavorObserver.standard;
  }
  return t(template, { winner, period });
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
            // Observer voice — the reader is NOT the winner here.
            // pickFlavor (self-voice) would render "you fought for every
            // category. And won." paired with a third-person headline.
            subtitle: pickFlavorObserver(run, winnerLabel, period),
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

// Non-winner ring palette — present-but-understated frames that give the
// hero avatar a sense of place without competing with the winner's gold
// burst. Refined hex values (not garish), keyed off ViewerResult:
//   - podium rank 2: refined silver
//   - podium rank 3: refined bronze
//   - category-champion / quiet: muted neutral
// The overall-winner kind returns undefined — the goldBurst glow IS the
// treatment, no ring needed.
const RING_SILVER = "#C7CFD8";
const RING_BRONZE = "#C58A4A";
const RING_MUTED = "#4B5563";

function ringColorForViewer(viewer: ViewerResult): string | undefined {
  if (viewer.kind === "overall-winner") return undefined;
  if (viewer.kind === "podium") {
    return viewer.standing?.rank === 2 ? RING_SILVER : RING_BRONZE;
  }
  // category-champion or quiet
  return RING_MUTED;
}

function AvatarCircle({
  name,
  size,
  bg,
  ringColor,
}: {
  name: string;
  size: number;
  bg: string;
  // When provided, frames the disc with a 4pt ring of the given color.
  // The 4pt border eats into the inner content area; on a 72pt disc that
  // leaves ~64pt of fill, still comfortable for the centered initial.
  ringColor?: string;
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
        ...(ringColor
          ? { borderWidth: 4, borderColor: ringColor }
          : null),
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
  const insets = useSafeAreaInsets();
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
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
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
          <View
            style={[
              s.heroAvatarWrap,
              !isWinnerView && s.heroAvatarWrapTight,
            ]}
          >
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
              {heroIsWinner && (
                <Ionicons
                  name="trophy"
                  size={34}
                  color={colors.leader}
                />
              )}
              <AvatarCircle
                name={heroName}
                size={72}
                bg={heroIsWinner ? colors.leader : colors.accent}
                ringColor={ringColorForViewer(viewerResult)}
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
                  {cw.championDaysWon}{" "}
                  {cw.championDaysWon === 1 ? "day" : "days"}
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

      {/* Full standings — every member, winners-first then zero-win
          members as equal rows. Zero-win members come from
          run.zeroWinMembers (the hook's pre-sorted active-roster list
          minus anyone with ≥1 win). They render as the SAME row
          component with 0 wins and an empty bar — NOT a demoted footer
          line. Matches the History tab's deliberate Stage B choice:
          every member is a full row; a dulled treatment reads as
          discouraging. Shared next-rank for the zero-win tie. */}
      {(run.standings.length > 0 || run.zeroWinMembers.length > 0) && (
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
          {run.zeroWinMembers.map((zwm) => {
            const isMe = !!userId && zwm.userId === userId;
            // All zero-win members share the next rank after the ranked
            // standings (e.g. ranked ends at #2 → zero-win tie at #3).
            // Empty standings (no winners at all) → zero-win tie at #1.
            const sharedRank = run.standings.length + 1;
            return (
              <View
                key={zwm.userId}
                style={[s.standingRow, isMe && s.rowMe]}
              >
                <Text style={s.standingRank}>#{sharedRank}</Text>
                <View style={s.standingInfo}>
                  <View style={s.standingMeta}>
                    <Text style={s.standingName} numberOfLines={1}>
                      {formatName(zwm.displayName, sharedRank)}
                    </Text>
                    <Text style={s.standingWins}>0 wins</Text>
                  </View>
                  <View style={s.barTrack}>
                    <View
                      style={[
                        s.barFill,
                        {
                          width: "0%" as `${number}%`,
                          backgroundColor: colors.accent,
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
  // paddingTop is set inline from useSafeAreaInsets — the prior hardcoded 60
  // didn't read the device's notch geometry and produced a dead-air gap on
  // non-notch / smaller-status-bar devices.
  header: {
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
  // Wrap is sized for the winner's goldBurst glow (160×160). Non-winner
  // views override to a tight ~avatar+12 box via heroAvatarWrapTight so
  // they don't inherit the giant empty halo the glow needs.
  heroAvatarWrap: {
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  heroAvatarWrapTight: {
    width: 84,
    height: 84,
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
  // Most-days-won rework: the day count is the meaningful metric now (not a
  // "days the category was contested" total), so it reads as content — same
  // weight as the name, white, slightly heavier — rather than as a trailing
  // label.
  champDays: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
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
