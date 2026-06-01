// DailyWinnerStrip — horizontal scrollable row of day-cards, one per
// day in the active run. Replaces the prior fixed-tick chart-aligned
// strip (which crammed ~30 dots into the chart width on monthly packs).
//
// Each card carries the SAME winner semantics the prior strip encoded:
//   • settled day, 1 winner → SolidChip in winner's stable color
//   • settled day, 2 winners → two overlapping small chips
//   • settled day, 3+ winners → two small chips + "+N"
//   • zero day (no winner) → muted dash
//   • today, live leader → LiveChip (hollow + pulsing)
//   • today, no live leader → muted dash
//   • self winner → blue identity ring on the chip (per chip, including
//     tie sub-chips and live)
// Only the LAYOUT changed:
//   • Cards instead of fixed-x ticks. Date is the day-of-month number
//     ("30"), no weekday letter. Weekly + monthly use the same component.
//   • Today's card adopts the History day-picker's accent-bg highlight.
//   • ScrollView auto-positions to today (rightmost) on mount via
//     onContentSizeChange → scrollToEnd({ animated: false }).
//
// No chart-x-alignment math — the chart computes its own domain; this
// strip is independent. width, PAD_LEFT, PAD_RIGHT, xForIndex are gone.
//
// Reduce-motion: the LiveChip still respects AccessibilityInfo
// .isReduceMotionEnabled() (replaces the pulse with a steady 0.7
// opacity).

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Easing,
  AccessibilityInfo,
} from "react-native";
import { colors } from "../../theme/colors";

const NO_DATA_COLOR = "#8B949E";
const TERTIARY_TEXT = "#484F58";
const SURFACE_RAISED = "#1C2333";
const TEXT_SECONDARY = "#8B949E";
// Self-identity blue, matches src/theme/colors.ts colors.self.
const SELF_RING_COLOR = "#2F81F7";

const CHIP_LARGE = 22;
const CHIP_SMALL = 17;
const CARD_MIN_WIDTH = 48;
const CARD_GAP = 6;

export interface WinnerDay {
  date: string; // YYYY-MM-DD
  winnerUserIds: string[]; // settled winners (0, 1, or many for a tie)
  isToday: boolean;
  liveLeaderIds?: string[]; // for today only
}

interface Props {
  days: WinnerDay[];
  nameByUser: Map<string, string>;
  colorByUser: Map<string, string>;
  // Optional category label for the title row (e.g. "Steps"). Generic
  // "Daily winner" used when omitted.
  categoryLabel?: string;
  // When provided, any chip whose winner is the current user is drawn
  // with a thin blue identity ring so "that's me" reads at chip size.
  // Tie days only ring the tied sub-chip belonging to the current
  // user. If self is also the overall winner (gold-filled chip), the
  // blue ring stacks on top — gold fill + blue ring = "winner + you".
  currentUserId?: string;
  // Step 1 of the bar-pivot: the strip is now a tappable day selector.
  // When provided, the card whose date matches selectedDate renders with
  // a blue selection ring (cardSelected style) — distinct from cardToday
  // (indigo bg). The two coexist (different style properties): when
  // today IS selected, the card shows BOTH treatments stacked.
  // onSelectDate fires on card tap; consumer owns the selectedDate
  // state. Both props optional so existing callers that don't pass
  // them get unselectable strip (existing behavior).
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
}

// Day-of-month from a YYYY-MM-DD without locale parsing. No zero-pad —
// single-digit days read more naturally ("5" not "05"). Weekly +
// monthly both use this same one-format-fits-all date label.
function dayOfMonth(date: string): string {
  const [, , d] = date.split("-");
  return String(parseInt(d, 10));
}

function initialFor(userId: string, nameByUser: Map<string, string>): string {
  const name = nameByUser.get(userId) ?? "M";
  return (name[0] ?? "M").toUpperCase();
}

// One settled chip — solid bg, dark initial. Sized large (single) or
// small (member of a tie pair). `isSelf` adds a thin blue identity
// ring around the chip without changing the fill (so the winner color
// language is preserved for everyone else, AND a self-+-overall-winner
// shows gold fill + blue ring). Logic unchanged from the prior strip.
function SolidChip({
  initial,
  color,
  size,
  isSelf,
}: {
  initial: string;
  color: string;
  size: number;
  isSelf?: boolean;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: isSelf ? 1.5 : 0,
        borderColor: isSelf ? SELF_RING_COLOR : undefined,
      }}
    >
      <Text
        style={{
          fontSize: size <= 17 ? 9 : 11,
          fontWeight: "700",
          color: "#0B0F14",
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

// Today's live chip — hollow ring + colored initial, pulses on opacity.
// Reduce-motion gets a steady 0.7 opacity instead. When `isSelf`, the
// hollow ring is drawn in the self-blue regardless of the resolved
// color, so a live self-leader chip reads as "yours + live" without
// the gold/blue ambiguity of a winner-color ring on a self chip.
// Logic unchanged from the prior strip.
function LiveChip({
  initial,
  color,
  isSelf,
}: {
  initial: string;
  color: string;
  isSelf?: boolean;
}) {
  const anim = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (!cancelled) setReduceMotion(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(0.7);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 0.45,
          duration: 1000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, reduceMotion]);

  const ringColor = isSelf ? SELF_RING_COLOR : color;
  return (
    <Animated.View
      style={{
        opacity: anim,
        width: CHIP_LARGE,
        height: CHIP_LARGE,
        borderRadius: CHIP_LARGE / 2,
        borderWidth: 1.5,
        borderColor: ringColor,
        backgroundColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: "700",
          color: ringColor,
        }}
      >
        {initial}
      </Text>
    </Animated.View>
  );
}

// Empty / today-with-no-leader cell content. Logic unchanged.
function Dash({ live }: { live?: boolean }) {
  return (
    <Text
      style={{
        fontSize: 16,
        color: live ? NO_DATA_COLOR : TERTIARY_TEXT,
      }}
    >
      ·
    </Text>
  );
}

// Settled-day cell: 1 winner → large solid chip in the winner's color;
// 2+ winners → one neutral "=N" tie chip (scales cleanly to any tied
// count: =2 / =3 / =4 / =5+). Empty → dash. The "=N" reads as "tied,"
// not "×N" (which could be misread as a multiplier). The detail of
// WHO tied is intentionally omitted at chip size — a future tap-to-
// expand can surface the tied members.
function SettledCell({
  winnerUserIds,
  nameByUser,
  colorByUser,
  currentUserId,
}: {
  winnerUserIds: string[];
  nameByUser: Map<string, string>;
  colorByUser: Map<string, string>;
  currentUserId?: string;
}) {
  if (winnerUserIds.length === 0) return <Dash />;
  if (winnerUserIds.length === 1) {
    const uid = winnerUserIds[0];
    return (
      <SolidChip
        initial={initialFor(uid, nameByUser)}
        color={colorByUser.get(uid) ?? NO_DATA_COLOR}
        size={CHIP_LARGE}
        isSelf={!!currentUserId && uid === currentUserId}
      />
    );
  }
  // Tie chip — single neutral pill, same diameter as a single-winner
  // chip. SURFACE_RAISED fill + muted-text "=N" so it's visibly
  // distinct from colored single-winner chips (no member color leaks
  // in; ties have no single owner to color by).
  return (
    <View
      style={{
        width: CHIP_LARGE,
        height: CHIP_LARGE,
        borderRadius: CHIP_LARGE / 2,
        backgroundColor: SURFACE_RAISED,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: TERTIARY_TEXT,
      }}
    >
      <Text
        style={{
          fontSize: 10,
          fontWeight: "700",
          color: NO_DATA_COLOR,
        }}
        allowFontScaling={false}
      >
        ={winnerUserIds.length}
      </Text>
    </View>
  );
}

export function DailyWinnerStrip({
  days,
  nameByUser,
  colorByUser,
  categoryLabel,
  currentUserId,
  selectedDate,
  onSelectDate,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);

  if (days.length === 0) {
    return null;
  }

  const title = categoryLabel
    ? `DAILY ${categoryLabel.toUpperCase()} WINNER`
    : "DAILY WINNER";

  return (
    <View>
      <Text style={styles.title}>{title}</Text>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        // Auto-position to today (the rightmost card) on mount. Firing on
        // content-size-change is the canonical "scroll to end after
        // layout" pattern — runs once after the cards measure their
        // intrinsic widths, then no-ops on subsequent identical sizes.
        // `animated: false` so the user doesn't see the scroll animation
        // when the strip first appears.
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: false })
        }
      >
        {days.map((d) => {
          const isSelected = !!selectedDate && d.date === selectedDate;
          return (
            <TouchableOpacity
              key={d.date}
              style={[
                styles.card,
                d.isToday && styles.cardToday,
                isSelected && styles.cardSelected,
              ]}
              onPress={() => onSelectDate?.(d.date)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
            >
              <Text
                style={[
                  styles.dateNum,
                  d.isToday && styles.dateNumToday,
                ]}
              >
                {dayOfMonth(d.date)}
              </Text>
              <View style={styles.chipSlot}>
                {d.isToday ? (
                  d.liveLeaderIds && d.liveLeaderIds.length > 0 ? (
                    <LiveChip
                      initial={initialFor(d.liveLeaderIds[0], nameByUser)}
                      color={
                        colorByUser.get(d.liveLeaderIds[0]) ?? NO_DATA_COLOR
                      }
                      isSelf={
                        !!currentUserId &&
                        d.liveLeaderIds[0] === currentUserId
                      }
                    />
                  ) : (
                    <Dash live />
                  )
                ) : (
                  <SettledCell
                    winnerUserIds={d.winnerUserIds}
                    nameByUser={nameByUser}
                    colorByUser={colorByUser}
                    currentUserId={currentUserId}
                  />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: NO_DATA_COLOR,
    marginBottom: 6,
  },
  // Mirrors the History day-picker's row styling
  // (pack/[id].tsx:1083-1114) — same gap, same card padding/bg/radius,
  // same minWidth — so the two surfaces feel consistent.
  row: {
    flexDirection: "row",
    gap: CARD_GAP,
    paddingBottom: 2,
  },
  card: {
    minWidth: CARD_MIN_WIDTH,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: SURFACE_RAISED,
    alignItems: "center",
    gap: 4,
  },
  cardToday: {
    // Indigo today-highlight (colors.todayHighlight) — deliberately NOT
    // colors.accent (#2563EB) which is too close to colors.self
    // (#2F81F7), the self-ring color. A self-as-live-leader chip on top
    // of this card needs the ring to read clearly.
    backgroundColor: colors.todayHighlight,
  },
  // Selected-day ring — applied on the tapped card. Uses different style
  // properties (border) than cardToday (background), so the two stack
  // cleanly when today IS the selected day: indigo bg + blue ring.
  cardSelected: {
    borderWidth: 1.5,
    borderColor: colors.self,
  },
  dateNum: {
    fontSize: 14,
    fontWeight: "700",
    color: TEXT_SECONDARY,
  },
  dateNumToday: {
    color: "#FFFFFF",
  },
  // Vertical slot for the winner chip / dash. Fixed height so cards
  // align across the row regardless of which cell type renders
  // (LiveChip + SettledCell are both CHIP_LARGE-tall; Dash is shorter
  // but centered in the slot).
  chipSlot: {
    height: CHIP_LARGE + 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
