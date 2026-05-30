// DailyWinnerStrip — pure presentational row of per-day winner chips
// aligned to the chart's x columns. Settled days show a colored chip
// with the winner's initial; tied days stack two chips with a "+N" if
// there are 3+; zero-winner days show a muted dash; today renders a
// hollow pulsing chip for the live leader.
//
// Layout uses absolute positioning to match the chart's tick math
// exactly: tick d sits at xLeft + d/(totalDays-1) * chartWidth, with
// xLeft = 36 (chart y-axis pad) and right pad = 12. Cell centers land
// on those tick positions so the chip lines up directly under the
// chart's data point for that day. No flex-justify approximation —
// that would offset centers by half a cell width.
//
// Reduce-motion: a steady-opacity treatment replaces the pulse loop
// when the OS setting is on; the hollow style alone still distinguishes
// live from settled.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  AccessibilityInfo,
} from "react-native";

// Layout mirrors PackTrendChart's plot bounds — keep these in sync
// with that file's PADDING_LEFT / PADDING_RIGHT (36 / 12).
const PAD_LEFT = 36;
const PAD_RIGHT = 12;
const CELL_W = 36;
const CHIP_LARGE = 22;
const CHIP_SMALL = 17;
const STRIP_HEIGHT = 50;
const NO_DATA_COLOR = "#8B949E";
const TERTIARY_TEXT = "#484F58";
// Self-identity blue, matches src/theme/colors.ts colors.self. Inlined
// here per the local-C convention used across this codebase rather
// than importing the token (the rest of this file is also literal-
// color presentational).
const SELF_RING_COLOR = "#2F81F7";

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
  width: number;
  // Optional category label for the title row (e.g. "Steps"). Generic
  // "Daily winner" used when omitted.
  categoryLabel?: string;
  // When provided, any chip whose winner is the current user is drawn
  // with a thin blue identity ring so "that's me" reads at chip size.
  // Tie days only ring the tied sub-chip belonging to the current
  // user. If self is also the overall winner (gold-filled chip), the
  // blue ring stacks on top — gold fill + blue ring = "winner + you".
  currentUserId?: string;
}

// Day-letter (M T W T F S S) from a YYYY-MM-DD via noon-parse to dodge
// UTC-midnight shifts. getDay(): 0=Sun..6=Sat.
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
function dayLetter(date: string): string {
  const d = new Date(date + "T12:00:00");
  return DAY_LETTERS[d.getDay()];
}

function initialFor(userId: string, nameByUser: Map<string, string>): string {
  const name = nameByUser.get(userId) ?? "M";
  return (name[0] ?? "M").toUpperCase();
}

// One settled chip — solid bg, dark initial. Sized large (single) or
// small (member of a tie pair). `isSelf` adds a thin blue identity
// ring around the chip without changing the fill (so the winner color
// language is preserved for everyone else, AND a self-+-overall-winner
// shows gold fill + blue ring).
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

// Empty / today-with-no-leader cell content.
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

// Settled-day cell: 1 winner → large solid chip; 2 winners → two small
// chips overlapping; 3+ → two small chips + "+N". Empty → dash.
// Tie days only ring the tied sub-chip whose winner is the current
// user — others keep their plain winner-color treatment.
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
  // Ties — show first 2 with overlap. 3+ → tack on "+N" text.
  const first = winnerUserIds[0];
  const second = winnerUserIds[1];
  const extra = winnerUserIds.length - 2;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <SolidChip
        initial={initialFor(first, nameByUser)}
        color={colorByUser.get(first) ?? NO_DATA_COLOR}
        size={CHIP_SMALL}
        isSelf={!!currentUserId && first === currentUserId}
      />
      <View style={{ marginLeft: -6 }}>
        <SolidChip
          initial={initialFor(second, nameByUser)}
          color={colorByUser.get(second) ?? NO_DATA_COLOR}
          size={CHIP_SMALL}
          isSelf={!!currentUserId && second === currentUserId}
        />
      </View>
      {extra > 0 && (
        <Text
          style={{
            marginLeft: 2,
            fontSize: 9,
            fontWeight: "700",
            color: NO_DATA_COLOR,
          }}
        >
          +{extra}
        </Text>
      )}
    </View>
  );
}

export function DailyWinnerStrip({
  days,
  nameByUser,
  colorByUser,
  width,
  categoryLabel,
  currentUserId,
}: Props) {
  if (days.length === 0) {
    return null;
  }

  const chartWidth = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const xForIndex = (i: number): number => {
    if (days.length === 1) return PAD_LEFT;
    return PAD_LEFT + (i / (days.length - 1)) * chartWidth;
  };

  const title = categoryLabel
    ? `DAILY ${categoryLabel.toUpperCase()} WINNER`
    : "DAILY WINNER";

  // Two parallel layers, both keyed to the same column x via the same
  // tick math the chart uses. Each chip-box and each letter-box is a
  // fixed CELL_W wide and centered on tickX (left = tickX - CELL_W/2).
  // This makes letter alignment independent of chip width — a tie
  // day's wider chip pair no longer shifts its letter off the column.
  return (
    <View style={{ width }}>
      <Text style={styles.title}>{title}</Text>
      <View style={[styles.strip, { width, height: STRIP_HEIGHT }]}>
        {/* Chip layer */}
        {days.map((d, i) => {
          const left = xForIndex(i) - CELL_W / 2;
          return (
            <View
              key={`chip-${d.date}`}
              style={[styles.chipBox, { left, width: CELL_W }]}
            >
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
          );
        })}
        {/* Letter layer — same left/width as the chip layer above, so
            letter i sits exactly under chip i's column center
            regardless of chip width. */}
        {days.map((d, i) => {
          const left = xForIndex(i) - CELL_W / 2;
          return (
            <View
              key={`letter-${d.date}`}
              style={[styles.letterBox, { left, width: CELL_W }]}
            >
              <Text
                style={[
                  styles.dayLetter,
                  d.isToday && styles.dayLetterToday,
                ]}
              >
                {dayLetter(d.date)}
              </Text>
            </View>
          );
        })}
      </View>
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
    paddingLeft: PAD_LEFT,
  },
  strip: {
    position: "relative",
  },
  // Chip and letter layers share the same `left + width` per column so
  // both center on the same tick x — independent of chip width. The
  // chip layer occupies the top portion of STRIP_HEIGHT (~28pt) and
  // the letter layer sits below it. Heights are loose; chips have
  // their own fixed dimensions and the letter is a single Text line.
  chipBox: {
    position: "absolute",
    top: 0,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  letterBox: {
    position: "absolute",
    top: 34,
    alignItems: "center",
  },
  dayLetter: {
    fontSize: 10,
    color: TERTIARY_TEXT,
  },
  dayLetterToday: {
    color: NO_DATA_COLOR,
  },
});
