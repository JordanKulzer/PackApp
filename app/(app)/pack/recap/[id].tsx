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
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Defs, RadialGradient, Stop, Circle } from "react-native-svg";
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
  avatarUrl,
}: {
  name: string;
  size: number;
  bg: string;
  // When provided, frames the disc with a 4pt ring of the given color.
  // The 4pt border eats into the inner content area; on a 72pt disc that
  // leaves ~64pt of fill, still comfortable for the centered initial.
  ringColor?: string;
  // When provided, renders the user's profile photo clipped to the disc.
  // Falls back to the initial letter when null/undefined (or if the
  // photo fails to load — Image error states aren't surfaced here, but
  // the initial sits BEHIND the Image so a failed load shows the disc
  // fill, not a broken-image placeholder; pragmatic for this surface).
  avatarUrl?: string | null;
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
        // overflow:hidden clips the Image to the circular shape.
        // Without it the Image renders square over the disc.
        overflow: "hidden",
        ...(ringColor
          ? { borderWidth: 4, borderColor: ringColor }
          : null),
      }}
    >
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
        />
      ) : (
        <Text
          style={{
            fontSize: Math.round(size * 0.4),
            fontWeight: "700",
            color: "#FFFFFF",
          }}
        >
          {initial}
        </Text>
      )}
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
  // Continuous PULSE on the winner glow only — a clear swell-and-fade
  // with a perceptible beat (the prior "breathe" with a 12-20% amplitude
  // on a 5-7s cycle read as nearly static on device; a pulse with a
  // wider opacity dip + visible scale grow on a ~2.4s cycle reads as a
  // calm heartbeat). Multiplied against the entrance transforms so the
  // entrance plays out normally before the pulse takes over as the
  // steady-state loop.
  const pulse = useRef(new Animated.Value(0)).current;

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

  // Continuous pulse — only when the viewer is the overall winner.
  // ~2.4s full cycle (1.2s each half), sine-eased so the swell-and-ease
  // reads as a heartbeat rather than a hard on/off. Native driver so
  // the loop doesn't contend with the JS thread (it runs forever).
  useEffect(() => {
    if (viewerResult?.kind !== "overall-winner") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [viewerResult?.kind, pulse]);

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
  const heroAvatarUrl =
    viewerResult.kind === "quiet"
      ? winners[0]?.avatarUrl ?? null
      : viewerResult.standing?.avatarUrl ?? null;
  // Degenerate run (no category wins at all) → no winner to show.
  const showHeroAvatar = !(
    viewerResult.kind === "quiet" && winners.length === 0
  );

  const second = run.standings[1];
  const third = run.standings[2];
  const topWins = run.standings[0]?.totalWins ?? 0;

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content}>
      {/* Header — chevron-back + "Back" text + date label below.
          Matches pack/create.tsx's chevron + text pattern (white,
          flexDirection: row, gap 4) for cross-screen consistency. */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={s.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          <Text style={s.backText}>Back</Text>
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
                pointerEvents="none"
                style={[
                  s.goldBurst,
                  {
                    // Entrance opacity × pulse opacity swing.
                    // The gradient itself defines the visual softness;
                    // the View's opacity scales the whole halo. Pulse
                    // band 45→75% gives a clear dip-and-swell that
                    // reads as a heartbeat (the prior 80→100% breathe
                    // band was too tight to perceive on device).
                    opacity: Animated.multiply(
                      flourish,
                      pulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.45, 0.75],
                      }),
                    ),
                    transform: [
                      {
                        // Entrance scale × pulse scale swell
                        // (1.00 → 1.12 = 12% — a visible grow each
                        // beat, paired with the opacity dip so the
                        // pulse reads as both bigger and brighter at
                        // its peak).
                        scale: Animated.multiply(
                          flourish.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.4, 1],
                          }),
                          pulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.12],
                          }),
                        ),
                      },
                    ],
                  },
                ]}
              >
                {/* Real radial gradient — centre-bright gold, fading to
                    transparent at the bounding-box edge. SVG is sized
                    140 inside a 120 wrap (no overflow:hidden on the
                    wrap), so the falloff softly spills past the wrap
                    boundary instead of clipping. Stops are a reasonable
                    first pass; expect a visual tuning round on device. */}
                <Svg width={140} height={140}>
                  <Defs>
                    <RadialGradient
                      id="winnerGlow"
                      cx="50%"
                      cy="50%"
                      r="50%"
                      fx="50%"
                      fy="50%"
                    >
                      <Stop
                        offset="0%"
                        stopColor={colors.leader}
                        stopOpacity={0.55}
                      />
                      <Stop
                        offset="55%"
                        stopColor={colors.leader}
                        stopOpacity={0.18}
                      />
                      <Stop
                        offset="100%"
                        stopColor={colors.leader}
                        stopOpacity={0}
                      />
                    </RadialGradient>
                  </Defs>
                  <Circle cx="70" cy="70" r="70" fill="url(#winnerGlow)" />
                </Svg>
              </Animated.View>
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
                avatarUrl={heroAvatarUrl}
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
                <AvatarCircle
                  name={standing.displayName}
                  size={32}
                  bg={standing.rank === 1 ? colors.leader : colors.accent}
                  avatarUrl={standing.avatarUrl}
                />
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
                <AvatarCircle
                  name={zwm.displayName}
                  size={32}
                  bg={colors.accent}
                  avatarUrl={zwm.avatarUrl}
                />
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
    paddingBottom: 6,
    gap: 8,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 4,
    alignSelf: "flex-start",
  },
  backText: { fontSize: 16, color: "#FFFFFF", fontWeight: "400" },
  weekLabel: {
    fontSize: 13,
    color: "#9CA3AF",
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  // Hero — viewer-adaptive celebration block.
  hero: {
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 24,
    gap: 10,
  },
  // Winner wrap shrunk from 160 → 120: with the SVG radial gradient
  // replacing the flat-disc burst, the feathered halo reads softer-and-
  // larger than its pixel footprint, so the wrap can compress without
  // losing celebration weight. Non-winner views still override to the
  // tight 84 box via heroAvatarWrapTight (Pass 1, unchanged).
  heroAvatarWrap: {
    width: 120,
    height: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  heroAvatarWrapTight: {
    width: 84,
    height: 84,
  },
  // Centers the SVG radial-gradient layer behind the trophy + avatar.
  // The SVG (140×140) intentionally overflows the wrap (120×120) by
  // ~10pt on each side so the gradient's falloff fades softly past the
  // wrap boundary instead of clipping at the wrap edge. The wrap has
  // no overflow:hidden, so the spill renders. No backgroundColor here
  // — the gold comes from the SVG gradient stops.
  goldBurst: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
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
