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
  Dimensions,
} from "react-native";
import { colors } from "../../theme/colors";
import { DAY_CELL, dayCellStyles } from "./dayCellTokens";

const NO_DATA_COLOR = "#8B949E";
const TERTIARY_TEXT = "#484F58";
const SURFACE_RAISED = "#1C2333";
// Bright neutral for today's ring + date number. Deliberately NOT
// gold (winner) or blue (self) — those carry reserved meanings on
// this surface; today gets its own neutral high-contrast signal.
const TEXT_PRIMARY = "#E6EDF3";
// Self-identity blue, matches src/theme/colors.ts colors.self.
const SELF_RING_COLOR = "#2F81F7";

const CHIP_LARGE = 22;
const CHIP_SMALL = 17;
// Cell width is now computed per render from screen dimensions so 7
// days fit horizontally on the screen budget (weekly = no scroll;
// monthly = same cell width, scrolls). The gap comes from the shared
// dayCellTokens module so both day strips (this one + the Daily
// Breakdown picker) use the same value.
const CARD_GAP = DAY_CELL.cellGap;

export interface WinnerDay {
  date: string; // YYYY-MM-DD
  winnerUserIds: string[]; // settled winners (0, 1, or many for a tie)
  isToday: boolean;
  // True iff date > today-in-pack-tz. Drives the faint outline cell
  // treatment for days that haven't happened yet (no data, still
  // tappable so the user can preview the empty bar state).
  isFuture?: boolean;
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
  // Index of today's cell in `days`. When >= 0, the strip auto-scrolls
  // to center today on mount (the monthly focus — today lands in the
  // middle with past days scrollable to the left, future to the
  // right). Weekly packs (7 cells, no scroll) treat this as a no-op
  // since all cells already fit on screen. -1 (today outside run
  // window) skips the scroll entirely.
  todayIndex?: number;
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
  todayIndex,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);

  // Per-render cell sizing — 7 cells fit the screen budget for weekly
  // packs (no scroll); monthly packs use the same cell width and
  // overflow horizontally (scrolls). Recomputed each render so device
  // rotation / dimension changes pick up automatically.
  const screenAvailWidth = Dimensions.get("window").width - 32;
  const cellWidth = Math.floor(
    (screenAvailWidth - 6 * CARD_GAP) / 7,
  );
  const cellStride = cellWidth + CARD_GAP;

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
        // Auto-scroll to center today on mount. Fires on
        // content-size-change (RN's canonical "scroll after layout"
        // hook — runs once after cells measure, then no-ops on
        // identical content sizes). The math:
        //   • Today's cell left edge = todayIndex * cellStride.
        //   • Plus half cellWidth = today's center.
        //   • Minus half the visible viewport = scroll x that lands
        //     today in the middle.
        //   • Clamp to 0 so weekly packs (today fits without scrolling)
        //     don't try to scroll negative.
        // Skipped when todayIndex is missing / -1 (today outside run
        // window — defensive).
        onContentSizeChange={(contentWidth) => {
          if (typeof todayIndex !== "number" || todayIndex < 0) return;
          const center = todayIndex * cellStride + cellWidth / 2;
          const target = center - screenAvailWidth / 2;
          const maxScroll = Math.max(0, contentWidth - screenAvailWidth);
          const x = Math.max(0, Math.min(maxScroll, target));
          scrollRef.current?.scrollTo({ x, animated: false });
        }}
      >
        {days.map((d) => {
          const isSelected = !!selectedDate && d.date === selectedDate;
          const isFuture = !!d.isFuture;
          return (
            <TouchableOpacity
              key={d.date}
              style={[
                dayCellStyles.base,
                styles.cellExtras,
                { width: cellWidth },
                d.isToday
                  ? dayCellStyles.today
                  : isFuture
                    ? dayCellStyles.future
                    : null,
                isSelected && dayCellStyles.selected,
              ]}
              onPress={() => onSelectDate?.(d.date)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
            >
              <Text
                style={[
                  dayCellStyles.dateNum,
                  d.isToday && dayCellStyles.dateNumToday,
                  isFuture && dayCellStyles.dateNumFuture,
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
                  // Settled and future days share content semantics:
                  // SettledCell returns Dash on empty winnerUserIds,
                  // which is correct for both past-no-winner (rare)
                  // and future (always no winner). The cell-level
                  // styling (cardFuture vs default) carries the
                  // visual distinction.
                  <SettledCell
                    winnerUserIds={d.winnerUserIds}
                    nameByUser={nameByUser}
                    colorByUser={colorByUser}
                    currentUserId={currentUserId}
                  />
                )}
              </View>
              {d.isToday && (
                <Text style={styles.todayLabel} allowFontScaling={false}>
                  TODAY
                </Text>
              )}
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
  // Cell row layout. Width per cell is set inline (cellWidth — see
  // component body) so 7 cells fit the screen budget for weekly packs;
  // monthly uses the same width and overflows horizontally to scroll.
  row: {
    flexDirection: "row",
    gap: CARD_GAP,
    paddingBottom: 2,
  },
  // Strip-specific extras layered onto the shared `dayCellStyles.base`.
  // The cell-internal gap between dateNum / chipSlot / TODAY caption is
  // the strip's own vertical rhythm — the Daily Breakdown picker has a
  // different inner stack (dayName + dateNum + activityBar) and uses
  // its own gap, so this stays here rather than in the shared tokens.
  cellExtras: {
    gap: 4,
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
  // "TODAY" caption below today's chip slot — preserves today's
  // identity even when the selected-blue border overrides the white
  // ring (e.g. when the user taps today's cell). Tertiary letter
  // spacing matches the section title's voice.
  todayLabel: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: TEXT_PRIMARY,
  },
});
