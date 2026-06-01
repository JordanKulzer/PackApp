// PackDailyBars — horizontal row of vertical bars, one per pack member,
// for a single (date, category) slice. Replaces the line chart's role
// as the Compete tab's hero in the bar-pivot. Pure presentational; all
// data via props.
//
// Step 2 status: built standalone for visual tuning with mock data
// mounted in PackCompeteView (clearly marked TEMP). Real data wiring
// (transpose seriesByCategory[selectedCategory] for selectedDate) is
// Step 3. No isolate, no crown overlay, no avatar fetch this step —
// initial-circle identity floor only.
//
// Scaling: per-day max. The tallest bar in the current view fills
// plotHeight; everyone else is proportional. dayMax floors at 1 so an
// all-zero day doesn't divide by zero — bars then collapse to the
// floor-stub height and the "0" value labels read truthfully. The
// tallest bar IS the winner by construction; height alone signals
// that (no crown glyph this step; can be added later).
//
// Value labels float ABOVE each bar (top-up labelling); identity
// circles sit BELOW the baseline (axis-down labelling). Two parallel
// flex rows (plot + identity) share the same slot widths so each
// column's bar, label, and circle align by construction.

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  type LayoutChangeEvent,
} from "react-native";

const TEXT_SECONDARY = "#8B949E";
const SURFACE_BORDER = "#30363D";

// Bar geometry — responsive to measured slot width. Bars fill ~65% of
// their slot, clamped to [BAR_MIN, BAR_MAX]. The clamp mirrors the
// score strip's existing adaptive-width pattern (MIN_CARD/MAX_CARD)
// so small packs read as chunky bars and big packs stay legible
// without dropping below BAR_MIN.
const BAR_FILL_FRACTION = 0.65;
const BAR_MIN = 16;
const BAR_MAX = 44;
const BAR_CORNER = 5;
const FLOOR_STUB = 3; // zero-value bars get this minimum height so
// the member stays visibly present (post settle-rows, zeros are real)
// — applies only on MIXED days (some members logged, others didn't);
// all-zero days skip the bar plot entirely (see empty-state branch).

// Identity-circle sizes for the two slot-width regimes.
const ID_LARGE = 28; // wide slots (≥ AVATAR_THRESHOLD): avatar OR initial
const ID_SMALL = 20; // narrow slots: initial only
const AVATAR_THRESHOLD = 40; // slot width >= → ID_LARGE + optional avatar

const VALUE_LABEL_HEIGHT = 16;
const VALUE_LABEL_GAP = 4;
const IDENTITY_GAP = 6; // space between baseline and identity row
const NAME_GAP = 4; // space between identity circle and name label
// Name-zone heights for the two regimes — narrow slots rotate -45° so
// the name needs a taller box. Component's total height stays roughly
// stable across pack sizes by absorbing the difference into the name
// zone (the bars themselves don't shrink).
const NAME_ZONE_HORIZONTAL = 16;
const NAME_ZONE_ROTATED = 36;
// Width below which names rotate to fit narrow slots. Slightly higher
// than AVATAR_THRESHOLD so the horizontal-name regime stays roomy and
// rotation kicks in only when the slot genuinely can't fit a
// horizontal first name.
const ROTATE_THRESHOLD = 50;

const DEFAULT_PLOT_HEIGHT = 150;
// Reduced height for the all-zero empty state — keeps a sensible
// presence (so the surrounding layout doesn't collapse on tab) without
// marooning a one-line message in the full plot's void.
const EMPTY_BOX_HEIGHT = 90;

export interface DailyBar {
  userId: string;
  value: number;
  color: string;
  name: string;
  avatarUrl?: string | null;
}

interface Props {
  bars: DailyBar[];
  plotHeight?: number;
  // Optional suffix appended to the value label after a space ("oz").
  // Skip the suffix when the value is abbreviated to ≥1k to avoid
  // awkward "1.5k oz" (water never reaches 1k oz; this guard is purely
  // defensive — if it ever did, we'd want "1.5k" alone).
  unitSuffix?: string;
  // Optional copy for the all-zero empty state (e.g. "No steps logged
  // yet today" / "No steps logged on May 27"). Used ONLY when every
  // bar's value is 0 — mixed days render normally with floor stubs.
  // Fallback "No activity yet." used when omitted.
  emptyLabel?: string;
}

// Value formatting:
//   • value < 1000 → whole number ("0", "1", "999")
//   • value ≥ 1000 → "X.Xk" with trailing ".0" stripped ("1.5k", "4k", "12.5k")
// Suffix appended only for whole-number renderings (see Props comment).
function formatValue(n: number, unitSuffix?: string): string {
  const rounded = Math.round(n);
  if (rounded < 1000) {
    return unitSuffix ? `${rounded} ${unitSuffix}` : String(rounded);
  }
  const k = rounded / 1000;
  return `${k.toFixed(1).replace(/\.0$/, "")}k`;
}

function initialFor(name: string): string {
  return (name[0] ?? "?").toUpperCase();
}

export function PackDailyBars({
  bars,
  plotHeight = DEFAULT_PLOT_HEIGHT,
  unitSuffix,
  emptyLabel,
}: Props) {
  // Track measured layout width to switch identity-circle treatment
  // (avatar/large vs initial-only/small) AND to size bars responsively.
  // 0 on first render → BAR_MIN + ID_SMALL fallback until layout fires
  // (~one frame); then re-renders with the real slot width.
  const [layoutWidth, setLayoutWidth] = useState(0);
  const onContainerLayout = (e: LayoutChangeEvent) => {
    setLayoutWidth(e.nativeEvent.layout.width);
  };

  if (bars.length === 0) {
    return null;
  }

  // All-zero empty state — every member at 0. Render a calm centered
  // message instead of a row of floor stubs under floating avatars.
  // ONLY for genuinely all-zero days; a mixed day where some members
  // have 0 still renders normally so the 0 members' floor stubs read
  // as "they sat this one out" (a real signal, not noise).
  const allZero = bars.every((b) => b.value === 0);

  // Per-day max scaling. Floor at 1 so an unexpectedly all-zero render
  // path (shouldn't hit — the empty-state branch catches first) still
  // wouldn't divide by zero.
  const dayMax = Math.max(1, ...bars.map((b) => b.value));

  // Slot width drives BOTH the avatar-vs-initial decision AND the
  // responsive bar width. layoutWidth is 0 until the first onLayout
  // fires; default to BAR_MIN / ID_SMALL on the first frame so the
  // initial paint isn't degenerate.
  const totalGap = (bars.length - 1) * 8;
  const slotWidth =
    layoutWidth > 0 ? Math.max(0, (layoutWidth - totalGap) / bars.length) : 0;
  const useLargeIdentity = slotWidth >= AVATAR_THRESHOLD;
  const idSize = useLargeIdentity ? ID_LARGE : ID_SMALL;

  // Responsive bar width — clamp to [BAR_MIN, BAR_MAX]. Pre-layout
  // (slotWidth = 0) falls back to BAR_MIN so the first frame still
  // shows real bars instead of zero-width slivers.
  const barWidth =
    slotWidth > 0
      ? Math.round(
          Math.min(BAR_MAX, Math.max(BAR_MIN, slotWidth * BAR_FILL_FRACTION)),
        )
      : BAR_MIN;

  // Rotate name labels when slots are too narrow for a horizontal
  // first-name to fit comfortably. Pre-layout (slotWidth = 0) starts
  // with rotated so the first frame doesn't show overlapping names
  // that may not exist after the real measurement; flips to
  // horizontal on the next render if the slot turns out roomy enough.
  const rotateNames = slotWidth > 0 ? slotWidth < ROTATE_THRESHOLD : true;

  // All-zero empty state. Keeps the overall component the same vertical
  // footprint (plotHeight + label headroom) so flipping between a logged
  // day and an all-zero day doesn't reflow the surrounding layout.
  // Identity row deliberately omitted — avatars-under-a-void looks
  // broken. Just the centered message.
  if (allZero) {
    return (
      <View onLayout={onContainerLayout} style={styles.container}>
        <View
          style={[
            styles.emptyBox,
            { height: EMPTY_BOX_HEIGHT },
          ]}
        >
          <Text style={styles.emptyText}>
            {emptyLabel ?? "No activity yet."}
          </Text>
        </View>
        <View style={styles.baseline} />
      </View>
    );
  }

  return (
    <View onLayout={onContainerLayout} style={styles.container}>
      {/* Plot row — bars share width evenly, pinned to the bottom.
          Height includes plotHeight + the value-label headroom so the
          baseline below sits directly under the bars regardless of
          which bar is tallest. */}
      <View
        style={[
          styles.plotRow,
          { height: plotHeight + VALUE_LABEL_HEIGHT + VALUE_LABEL_GAP },
        ]}
      >
        {bars.map((b) => {
          const ratio = dayMax > 0 ? b.value / dayMax : 0;
          const rawHeight = ratio * plotHeight;
          const barHeight = b.value === 0 ? FLOOR_STUB : Math.max(FLOOR_STUB, rawHeight);
          return (
            <View key={b.userId} style={styles.barSlot}>
              <Text
                style={styles.valueLabel}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {formatValue(b.value, unitSuffix)}
              </Text>
              <View
                style={[
                  styles.bar,
                  {
                    width: barWidth,
                    height: barHeight,
                    backgroundColor: b.color,
                    // Zero-value bars get reduced opacity on the floor
                    // stub so the floor reads as "no activity" rather
                    // than as a real (tiny) value. Non-zero bars stay
                    // full color.
                    opacity: b.value === 0 ? 0.35 : 1,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      {/* Baseline — thin horizontal axis line under the bars. */}
      <View style={styles.baseline} />

      {/* Identity row — circles align under each bar's slot center. */}
      <View style={styles.identityRow}>
        {bars.map((b) => {
          const useAvatar = useLargeIdentity && !!b.avatarUrl;
          return (
            <View key={b.userId} style={styles.identitySlot}>
              {useAvatar ? (
                <Image
                  source={{ uri: b.avatarUrl ?? undefined }}
                  style={{
                    width: idSize,
                    height: idSize,
                    borderRadius: idSize / 2,
                  }}
                />
              ) : (
                <View
                  style={[
                    styles.initialCircle,
                    {
                      width: idSize,
                      height: idSize,
                      borderRadius: idSize / 2,
                      backgroundColor: b.color,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.initialText,
                      { fontSize: idSize <= 20 ? 10 : 12 },
                    ]}
                    allowFontScaling={false}
                  >
                    {initialFor(b.name)}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Name row — first name below each identity circle, colored in
          the member's stable color. ROTATES -45° when the slot is too
          narrow for a horizontal label (ROTATE_THRESHOLD). Reserved
          name-zone height differs per regime so the component's
          overall footprint shifts smoothly between many-member
          (rotated, taller name zone) and few-member (horizontal,
          shorter name zone) packs. */}
      <View
        style={[
          styles.nameRow,
          {
            height: rotateNames ? NAME_ZONE_ROTATED : NAME_ZONE_HORIZONTAL,
          },
        ]}
      >
        {bars.map((b) => (
          <View key={b.userId} style={styles.nameSlot}>
            <Text
              style={[
                styles.nameLabel,
                { color: b.color },
                rotateNames && styles.nameLabelRotated,
              ]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {b.name}
            </Text>
          </View>
        ))}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    backgroundColor: "transparent",
  },
  plotRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  // Each slot fills available width evenly via flex; bar inside the
  // slot is fixed-width (BAR_WIDTH) and centered so bars stay uniform
  // across pack sizes (only slot padding/gap shifts).
  barSlot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: VALUE_LABEL_GAP,
  },
  valueLabel: {
    height: VALUE_LABEL_HEIGHT,
    fontSize: 11,
    fontWeight: "600",
    color: TEXT_SECONDARY,
    textAlign: "center",
  },
  bar: {
    // Width set per-render via the responsive `barWidth` computed in
    // the render body (clamped slot × BAR_FILL_FRACTION).
    borderTopLeftRadius: BAR_CORNER,
    borderTopRightRadius: BAR_CORNER,
  },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    textAlign: "center",
  },
  baseline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: SURFACE_BORDER,
    width: "100%",
  },
  identityRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: IDENTITY_GAP,
  },
  identitySlot: {
    flex: 1,
    alignItems: "center",
  },
  initialCircle: {
    alignItems: "center",
    justifyContent: "center",
  },
  initialText: {
    fontWeight: "700",
    color: "#0B0F14",
  },
  // Name row — sits below the identity row. Same gap/flex math so
  // labels align under their bar's column. Height set inline per the
  // current rotation regime.
  nameRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: NAME_GAP,
  },
  nameSlot: {
    flex: 1,
    alignItems: "center",
    overflow: "visible",
  },
  nameLabel: {
    fontSize: 10,
    fontWeight: "600",
    // Color set inline per-bar (member's stable color).
  },
  // -45° rotation keeps the name centered on its slot's column. Each
  // slot's `overflow: "visible"` (above) lets the rotated text spill
  // sideways into the adjacent slots' visual space — fine because
  // they're all rotating the same way, so they slot together rather
  // than collide.
  nameLabelRotated: {
    transform: [{ rotate: "-45deg" }],
  },
});
