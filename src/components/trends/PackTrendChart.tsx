// PackTrendChart — multi-series SVG line chart, one line per pack
// member for a single category, on a shared y-scale and a date-domain
// x-axis. Pure presentational: the consumer fully resolves every
// series' stroke color, width, and emphasis flag. This component knows
// nothing about "you", "leader", tab state, modes, the strip, or any
// interaction — those are all later steps.
//
// Path math (epochDay / buildRuns / Catmull-Rom-to-Bezier / SMOOTH /
// y-inversion / empty handling) is copied verbatim from
// CategoryTrendChart.tsx. The duplication is deliberate for now — once
// the Trends feature is verified end-to-end we'll extract a shared
// trendPath.ts and dedupe in one go. Do NOT short-cut that here.
//
// CRITICAL difference from CategoryTrendChart: x positioning is by
// DATE, not by array index. The points arrays are NOT one-per-day —
// days with no daily_scores row are simply absent from a member's
// series. Index-based spacing would slide gapped days into the wrong
// slot. Domain is [runStart, runEnd] in epoch-days; each point's x is
// linearly interpolated from its epoch-day within that domain.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  AccessibilityInfo,
} from "react-native";
import Svg, {
  Path,
  Circle,
  Line as SvgLine,
  Text as SvgText,
} from "react-native-svg";
import { Crown } from "lucide-react-native";

// Smoothing toggle — flip to true to render Catmull-Rom Bezier curves
// instead of straight L segments. Straight is more honest for daily
// activity data and makes member-vs-member line crossings legible
// (smoothing hid those crossings under the curves).
const SMOOTH = false;

// Headroom multiplier — peaks aren't jammed at the top edge. Matches
// CategoryTrendChart's value verbatim so the two charts read with the
// same visual breathing room.
const Y_HEADROOM = 1.1;

const PADDING_LEFT = 36; // room for y-axis labels
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 24; // room for x-axis labels
const DEFAULT_HEIGHT = 180;
const DOT_RADIUS = 3;
const NO_DATA_COLOR = "#8B949E"; // muted gray — sole hardcoded color

export interface PackTrendSeries {
  userId: string;
  points: { date: string; value: number }[]; // ascending by date; gaps allowed
  strokeColor: string;
  strokeWidth: number;
  emphasized: boolean;
}

interface Props {
  series: PackTrendSeries[];
  runStart: string; // "YYYY-MM-DD"
  runEnd: string; // "YYYY-MM-DD"
  width: number;
  height?: number;
  formatValue?: (n: number) => string;
  // Bumping this key (e.g. on category-tab switch) replays a brief
  // fade+slide-up enter animation. Absent or unchanged → no animation.
  // Deliberately NOT data — animating on data would flicker on every
  // realtime update.
  transitionKey?: string;
  // Optional crown overlay — gold marker drawn on top of the
  // matching series' LATEST real point. Identity is owned by the line
  // color (caller passes a stable color per member); the crown is the
  // category-leader signal layered on top, never replacing the line's
  // color. Undefined → no crown.
  crownUserId?: string;
}

// Parse YYYY-MM-DD to an epoch-day integer (UTC). Hermes-safe — Date.UTC
// + integer math, no Intl. Copied verbatim from CategoryTrendChart.
function epochDay(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, day) / 86400000);
}

// Group consecutive points (date-adjacent) into runs. Each run emits
// its own sub-path so the line breaks across gaps. Copied verbatim
// from CategoryTrendChart.
function buildRuns(points: { date: string }[]): number[][] {
  if (points.length === 0) return [];
  const runs: number[][] = [];
  let current: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = epochDay(points[i - 1].date);
    const cur = epochDay(points[i].date);
    if (cur - prev === 1) {
      current.push(i);
    } else {
      runs.push(current);
      current = [i];
    }
  }
  runs.push(current);
  return runs;
}

// SVG path d-string builder. M starts each sub-path; within a run,
// segments are L (straight) when SMOOTH is false OR the run has fewer
// than 3 points; otherwise Catmull-Rom-to-Bezier (uniform, factor 1/6)
// with endpoint-clamp neighbors.
//
// yMin/yMax are the vertical bounds of the plot area (yTop / yBottom in
// the consumer). The Catmull-Rom control points naturally overshoot
// past the data — visible on small-integer categories like Workouts as
// curves that dip BELOW the y=0 baseline. Endpoints (xs/ys) are already
// in-bounds; clamping only the control-point Ys removes the dip without
// flattening the curve elsewhere.
function buildPath(
  runs: number[][],
  xs: number[],
  ys: number[],
  smooth: boolean,
  yMin: number,
  yMax: number,
): string {
  const clampY = (y: number) => Math.max(yMin, Math.min(yMax, y));
  const segments: string[] = [];
  for (const run of runs) {
    if (run.length === 0) continue;
    const i0 = run[0];
    segments.push(`M ${xs[i0]} ${ys[i0]}`);
    if (run.length === 1) continue;
    if (!smooth || run.length === 2) {
      for (let j = 1; j < run.length; j++) {
        const idx = run[j];
        segments.push(`L ${xs[idx]} ${ys[idx]}`);
      }
      continue;
    }
    for (let j = 0; j < run.length - 1; j++) {
      const iPrev = run[Math.max(0, j - 1)];
      const iCur = run[j];
      const iNext = run[j + 1];
      const iNext2 = run[Math.min(run.length - 1, j + 2)];

      const cp1x = xs[iCur] + (xs[iNext] - xs[iPrev]) / 6;
      const cp1y = ys[iCur] + (ys[iNext] - ys[iPrev]) / 6;
      const cp2x = xs[iNext] - (xs[iNext2] - xs[iCur]) / 6;
      const cp2y = ys[iNext] - (ys[iNext2] - ys[iCur]) / 6;
      segments.push(
        `C ${cp1x} ${clampY(cp1y)} ${cp2x} ${clampY(cp2y)} ${xs[iNext]} ${ys[iNext]}`,
      );
    }
  }
  return segments.join(" ");
}

// "May 26" — short month + day, Hermes-safe (no toLocaleDateString
// dependence, locale-independent for an English-only pre-launch app).
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function formatMonthDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function PackTrendChart({
  series,
  runStart,
  runEnd,
  width,
  height = DEFAULT_HEIGHT,
  formatValue = (n) => String(n),
  transitionKey,
  crownUserId,
}: Props) {
  // Enter animation — opacity + 6px slide-up on mount and whenever the
  // transitionKey changes. View-level only; the SVG path math is not
  // touched. Native-driven so scrolling stays smooth.
  const anim = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  // One-time reduce-motion check on mount, plus subscription so a user
  // toggling the OS setting mid-session doesn't keep getting animations.
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(enabled);
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

  // Deps deliberately exclude series/data — only the category key
  // (or any caller-supplied identity bump) replays the animation.
  // Without this discipline every realtime daily_scores update would
  // flicker the chart in.
  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(1);
      return;
    }
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [transitionKey, reduceMotion, anim]);

  const xLeft = PADDING_LEFT;
  const xRight = Math.max(xLeft, width - PADDING_RIGHT);
  const yTop = PADDING_TOP;
  const yBottom = Math.max(yTop, height - PADDING_BOTTOM);
  const chartHeight = yBottom - yTop;
  const chartWidth = xRight - xLeft;

  // Empty: no series at all, or every series has zero points. Render
  // the baseline + centered muted "No data yet" — mirrors
  // CategoryTrendChart's empty case, sized to the chart's full box.
  const anyPoints = series.some((s) => s.points.length > 0);
  if (!anyPoints) {
    return (
      <View style={[styles.emptyBox, { width, height }]}>
        <Text style={styles.emptyText}>No data yet</Text>
      </View>
    );
  }

  // Shared y-scale across ALL series — every line draws against the
  // same max so leader vs follower differences are honest. Floor at 1
  // to avoid divide-by-zero when every value is 0; lines collapse to
  // the baseline in that degenerate case, which is the truthful read.
  //
  // Two maxima: dataMax is the real peak, used for HONEST y-axis label
  // values. scaleMax = dataMax * Y_HEADROOM is the vertical-positioning
  // ceiling so the top label sits below the chart's top edge with a
  // breathing-room gap above it (mirrors CategoryTrendChart). Labels
  // show real data values; the gap is purely visual.
  const dataMax = Math.max(
    1,
    ...series.flatMap((s) => s.points.map((p) => p.value)),
  );
  const scaleMax = dataMax * Y_HEADROOM;

  // X-domain in epoch-days. Single-day runs degenerate to xLeft — guard
  // against divide-by-zero and place any point at the left edge.
  const xStartDay = epochDay(runStart);
  const xEndDay = epochDay(runEnd);
  const xDomain = Math.max(1, xEndDay - xStartDay);
  const xForDate = (date: string): number => {
    if (xEndDay === xStartDay) return xLeft;
    const day = epochDay(date);
    const t = (day - xStartDay) / xDomain;
    // Don't clamp here — out-of-domain points are a consumer error;
    // letting them render off-screen surfaces the bug instead of
    // silently mis-placing them.
    return xLeft + t * chartWidth;
  };
  const yForValue = (value: number): number =>
    yTop + (1 - value / scaleMax) * chartHeight;

  // X-axis hash ticks — one per day for short runs (≤12 days),
  // weekly for longer (monthly) runs so the axis doesn't overflow.
  // No per-tick labels — the start/end date labels remain the only x
  // text. Tick positions share the same xLeft/chartWidth formula the
  // data lines use, so ticks align exactly under data points.
  const totalDays = xEndDay - xStartDay + 1;
  const tickStep = totalDays <= 12 ? 1 : 7;
  const tickXs: number[] = [];
  if (totalDays > 0) {
    for (let d = 0; d < totalDays; d += tickStep) {
      const tx =
        totalDays <= 1
          ? xLeft
          : xLeft + (d / (totalDays - 1)) * chartWidth;
      tickXs.push(tx);
    }
  }

  // Pre-compute per-series xs/ys + run-grouping + path string. Done
  // once outside the JSX so the JSX can stay scan-friendly.
  type PreparedSeries = PackTrendSeries & {
    xs: number[];
    ys: number[];
    runs: number[][];
    d: string;
  };
  const prepared: PreparedSeries[] = series.map((s) => {
    const xs = s.points.map((p) => xForDate(p.date));
    const ys = s.points.map((p) => yForValue(p.value));
    const runs = buildRuns(s.points);
    const d = buildPath(runs, xs, ys, SMOOTH, yTop, yBottom);
    return { ...s, xs, ys, runs, d };
  });

  // Draw order: non-emphasized first, emphasized last. Stable order
  // within each group (Array.prototype.filter preserves input order).
  const background = prepared.filter((s) => !s.emphasized);
  const foreground = prepared.filter((s) => s.emphasized);

  // Y-axis labels — 0 / mid / max, rounded before formatting. Labels
  // show real data values (dataMax, not scaleMax) but are positioned at
  // their true heights via yForValue, which uses scaleMax — so the
  // top label sits just below the chart's top edge with the headroom
  // gap above it.
  const yLabels: { y: number; text: string }[] = [
    { y: yForValue(0), text: formatValue(0) },
    {
      y: yForValue(dataMax / 2),
      text: formatValue(Math.round(dataMax / 2)),
    },
    { y: yForValue(dataMax), text: formatValue(Math.round(dataMax)) },
  ];

  // 6px slide-up + fade-in; opacity and translateY both drive off the
  // same 0→1 anim, so reduce-motion / mid-flight setValue keeps them
  // perfectly in sync. Wrap is on the Svg only — the StyleSheet box
  // around it (sizing) stays static so layout never animates.
  const transformY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [6, 0],
  });

  return (
    <View style={[styles.container, { width, height }]}>
      <Animated.View
        style={{ opacity: anim, transform: [{ translateY: transformY }] }}
      >
        <Svg width={width} height={height}>
          {/* Y-axis labels — three sparse marks at 0, mid, max. */}
        {yLabels.map((label, i) => (
          <SvgText
            key={`y-${i}`}
            x={xLeft - 6}
            y={label.y + 3}
            fontSize={10}
            fill={NO_DATA_COLOR}
            textAnchor="end"
          >
            {label.text}
          </SvgText>
        ))}

        {/* Faint gridlines at the mid + max label heights — Oura-style
            subtle structure (NOT a dense grid). Drawn BEFORE the data
            lines so they sit behind. The y=0 baseline below stays
            slightly stronger as the primary ground reference. */}
        <SvgLine
          x1={xLeft}
          y1={yForValue(dataMax / 2)}
          x2={xRight}
          y2={yForValue(dataMax / 2)}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={0.5}
        />
        <SvgLine
          x1={xLeft}
          y1={yForValue(dataMax)}
          x2={xRight}
          y2={yForValue(dataMax)}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={0.5}
        />

        {/* Baseline at y=0 — subtle ground reference. */}
        <SvgLine
          x1={xLeft}
          y1={yForValue(0)}
          x2={xRight}
          y2={yForValue(0)}
          stroke={NO_DATA_COLOR}
          strokeWidth={0.5}
          opacity={0.4}
        />

        {/* Day hash ticks — short verticals just below the baseline.
            One per day on short runs, weekly on long runs. No labels. */}
        {tickXs.map((tx, i) => (
          <SvgLine
            key={`tick-${i}`}
            x1={tx}
            y1={yBottom}
            x2={tx}
            y2={yBottom + 4}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={1}
          />
        ))}

        {/* X-axis end labels — runStart left, runEnd right. Dense ticks
            deliberately skipped (a monthly run would overflow). */}
        <SvgText
          x={xLeft}
          y={yBottom + 14}
          fontSize={10}
          fill={NO_DATA_COLOR}
          textAnchor="start"
        >
          {formatMonthDay(runStart)}
        </SvgText>
        <SvgText
          x={xRight}
          y={yBottom + 14}
          fontSize={10}
          fill={NO_DATA_COLOR}
          textAnchor="end"
        >
          {formatMonthDay(runEnd)}
        </SvgText>

        {/* Non-emphasized series (background) — line for connected runs,
            plus a faint dot at any LONE point (a run of length 1, i.e.
            an isolated day surrounded by gaps). Without lone-point dots,
            sparse data (common on Workouts / Water) just vanishes — a
            member with one logged day in the run would render as
            nothing. Connected runs of length ≥2 still get clean dot-less
            lines for the ghost-treatment aesthetic. */}
        {background.map((s) =>
          s.points.length > 1 ? (
            <Path
              key={`bg-line-${s.userId}`}
              d={s.d}
              stroke={s.strokeColor}
              strokeWidth={s.strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null,
        )}
        {background.map((s) =>
          s.runs
            .filter((run) => run.length === 1)
            .map((run) => {
              const idx = run[0];
              return (
                <Circle
                  key={`bg-dot-${s.userId}-${s.points[idx].date}`}
                  cx={s.xs[idx]}
                  cy={s.ys[idx]}
                  r={2}
                  fill={s.strokeColor}
                  opacity={0.9}
                />
              );
            }),
        )}

        {/* Emphasized series (foreground) — line first, dots on top so
            dots aren't covered by overlapping lines from the same set. */}
        {foreground.map((s) =>
          s.points.length > 1 ? (
            <Path
              key={`fg-line-${s.userId}`}
              d={s.d}
              stroke={s.strokeColor}
              strokeWidth={s.strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null,
        )}
        {foreground.map((s) =>
          s.points.map((p, i) => (
            <Circle
              key={`fg-dot-${s.userId}-${p.date}`}
              cx={s.xs[i]}
              cy={s.ys[i]}
              r={DOT_RADIUS}
              fill={s.strokeColor}
            />
          )),
        )}

        </Svg>
        {/* Crown overlay — real lucide glyph, absolutely positioned
            over the Svg at the crowned series' latest point. Inside
            the Animated.View so it fades+slides with the chart. The
            12px crown is centered on the point's (x, y) and nudged
            up 10px so the glyph sits ABOVE the line, not on it.
            pointerEvents="none" so the overlay never blocks future
            chart taps. */}
        {(() => {
          if (!crownUserId) return null;
          const target = prepared.find((s) => s.userId === crownUserId);
          if (!target || target.points.length === 0) return null;
          const lastIdx = target.points.length - 1;
          const CROWN_SIZE = 14;
          const left = target.xs[lastIdx] - CROWN_SIZE / 2;
          const top = target.ys[lastIdx] - CROWN_SIZE / 2 - 10;
          return (
            <View
              pointerEvents="none"
              style={{ position: "absolute", left, top }}
            >
              <Crown
                size={CROWN_SIZE}
                color="#E3A000"
                strokeWidth={2.5}
              />
            </View>
          );
        })()}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "transparent" },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  emptyText: {
    fontSize: 12,
    color: NO_DATA_COLOR,
    opacity: 0.7,
  },
});
