// CategoryTrendChart — pure presentational line chart over react-native-svg.
//
// Built standalone (no chart lib — package.json has only react-native-svg
// 15.x) so Step E can drop it into the public profile screen behind the
// Trends section's category tabs. Pure props-in / no fetching, no state
// beyond what's needed to render.
//
// Note on the color prop: there is no per-category color map in this
// codebase (CATEGORY_ICON exists; CATEGORY_COLORS does not — Compete-tab
// icons all render in textSecondary). Step E will pass a single token
// color — `colors.accent` is the conventional pick, since the chart says
// "this user's trend for the selected category" rather than asserting a
// category-identity color the rest of the app doesn't carry.
//
// Y scale: 0-baseline + 10% headroom over observed max. For activity
// metrics (steps / calories / water / workouts) a non-zero floor would
// imply that the resting state is positive, which it isn't — a day of
// zero activity should sit on the baseline, visibly. The trade-off is
// that a series of similar large values (e.g. 7800/8100/7950) renders
// as a near-flat line. Acceptable for a "did they show up?" view.
//
// X spacing: index-based even distribution, NOT date-span. A 7-day
// window with one missing day would otherwise compress 6 points into
// part of the chart width; index spacing keeps the chart legible.
// Date-based gaps are still honored by the LINE itself (broken across
// gaps via the runs split below), so the user can still see when data
// is missing — they just lose the literal horizontal distance signal.

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, Circle, Line as SvgLine } from "react-native-svg";
import { colors } from "../../theme/colors";

// Smoothing toggle — flip to false to render straight L segments instead
// of Catmull-Rom → cubic Bezier curves. Kept as one constant so the look
// can be A/B'd on-device without rewriting the path builder.
const SMOOTH = true;

const Y_HEADROOM = 1.1;
const PADDING_X = 12;
const PADDING_Y = 12;
const DEFAULT_HEIGHT = 160;
const DOT_RADIUS = 3;
const LINE_WIDTH = 2;

export interface TrendPointInput {
  date: string; // YYYY-MM-DD
  value: number;
}

interface Props {
  points: TrendPointInput[]; // ascending by date; caller's responsibility
  color: string;
  width: number;
  height?: number;
}

// Parse YYYY-MM-DD to an epoch-day integer (UTC). Only used to compute
// day-deltas between two date strings; not for display. Hermes-safe:
// uses Date.UTC + integer math, no Intl or locale-sensitive parsing.
function epochDay(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, day) / 86400000);
}

// Group point indices into "runs" — maximal consecutive sequences whose
// dates are exactly 1 day apart. Each run becomes its own sub-path so
// the line breaks (rather than connects through) across gaps.
function buildRuns(points: TrendPointInput[]): number[][] {
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

// Build the SVG path `d` attribute. Each run yields a fresh "M …"
// sub-path. Within a run, segments are L (straight) when SMOOTH is
// false OR the run has fewer than 3 points; otherwise Catmull-Rom-to-
// Bezier (uniform, factor 1/6) with endpoint-clamp neighbors.
function buildPath(
  runs: number[][],
  xs: number[],
  ys: number[],
  smooth: boolean,
): string {
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
    // Catmull-Rom → cubic Bezier. For segment P[i] → P[i+1], the two
    // control points are derived from P[i-1] and P[i+2]; endpoints
    // clamp neighbors to themselves so the curve doesn't overshoot.
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
        `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${xs[iNext]} ${ys[iNext]}`,
      );
    }
  }
  return segments.join(" ");
}

export function CategoryTrendChart({
  points,
  color,
  width,
  height = DEFAULT_HEIGHT,
}: Props) {
  // 0 points — section doesn't collapse to zero height; muted "No data
  // yet" sits centered at the chart's natural size.
  if (points.length === 0) {
    return (
      <View style={[s.emptyBox, { width, height }]}>
        <Text style={s.emptyText}>No data yet</Text>
      </View>
    );
  }

  const chartWidth = Math.max(0, width - PADDING_X * 2);
  const chartHeight = Math.max(0, height - PADDING_Y * 2);

  // 1 point — center the lone dot. 2+ points — even spacing across the
  // chart's inner width. SVG Y grows DOWN, data grows UP — invert via
  // (1 - value/maxV).
  const xs: number[] =
    points.length === 1
      ? [PADDING_X + chartWidth / 2]
      : points.map(
          (_, i) => PADDING_X + (i / (points.length - 1)) * chartWidth,
        );

  const maxV =
    Math.max(1, ...points.map((p) => p.value)) * Y_HEADROOM;
  const ys = points.map(
    (p) => PADDING_Y + (1 - p.value / maxV) * chartHeight,
  );

  const runs = buildRuns(points);
  const d = buildPath(runs, xs, ys, SMOOTH);
  const baselineY = PADDING_Y + chartHeight;

  return (
    <View style={[s.container, { width, height }]}>
      <Svg width={width} height={height}>
        {/* Faint baseline — subtle ground reference at y=0 */}
        <SvgLine
          x1={PADDING_X}
          y1={baselineY}
          x2={PADDING_X + chartWidth}
          y2={baselineY}
          stroke={colors.barNeutral}
          strokeWidth={0.5}
          opacity={0.4}
        />
        {/* The line — skipped for the single-point case (which renders
            just the dot below). */}
        {points.length > 1 && (
          <Path
            d={d}
            stroke={color}
            strokeWidth={LINE_WIDTH}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {/* Dots — one per real data point. */}
        {points.map((p, i) => (
          <Circle
            key={p.date}
            cx={xs[i]}
            cy={ys[i]}
            r={DOT_RADIUS}
            fill={color}
          />
        ))}
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  container: { backgroundColor: "transparent" },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  emptyText: {
    fontSize: 12,
    color: colors.member,
    opacity: 0.7,
  },
});
