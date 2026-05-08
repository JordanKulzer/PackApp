// ActivityToggleRow — toggle-with-expanded-content row primitive (Pass 26,
// dividers dropped Pass 26-followup).
//
// Anatomy:
//   ┌─────────────────────────────────────────┐
//   │ [label\ndescription (flex)]   [Switch]  │  ← always rendered
//   │ {expanded}                              │  ← rendered only when value === true
//   └─────────────────────────────────────────┘
//
// The `expanded` slot renders ONLY when value === true. When off, the row
// collapses to just the toggle row.
//
// No hairline divider between rows: each activity is a self-contained
// block; vertical whitespace from `paddingVertical` and the section's own
// `gap` carry the visual rhythm. The `isLast` prop is preserved as a
// no-op for caller positional intent — kept on the API in case future
// passes reintroduce a per-row divider treatment.
//
// Tappable: tapping anywhere on the toggle row flips `value` (standard
// iOS Settings UX, matches ToggleRow's pattern). Switch's own touch zone
// also fires onValueChange — double-tap-zone is intentional. Tapping
// inside the expanded slot does NOT flip the toggle (the slot's children
// own their own interactions: target inputs, points-edit affordances,
// etc.).
//
// Why a separate component vs. extending ToggleRow: ToggleRow is a single
// row primitive with no slot for below-toggle content. Activity rows need
// rich variant content (target inputs, Pro points-edit affordances,
// static hint text) that's caller-specific — pushing it through a
// ReactNode slot keeps the component lean while letting callers compose
// arbitrary expanded UIs.
//
// Consumers (as of Pass 26):
//   - app/(app)/pack/create.tsx (4 rows: Steps, Workouts, Calories, Water)

import { View, Text, Switch, TouchableOpacity, StyleSheet } from "react-native";
import { colors } from "../../theme/colors";

const C = {
  surfaceRaised: "#1C2333",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  accent: colors.self,
} as const;

interface ActivityToggleRowProps {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Rendered below the toggle row only when value === true. */
  expanded?: React.ReactNode;
  isLast?: boolean;
}

export function ActivityToggleRow({
  label,
  description,
  value,
  onValueChange,
  expanded,
  isLast: _isLast,
}: ActivityToggleRowProps) {
  return (
    <View style={s.group}>
      <TouchableOpacity
        onPress={() => onValueChange(!value)}
        activeOpacity={0.7}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
      >
        <View style={s.row}>
          <View style={s.textStack}>
            <Text style={s.label}>{label}</Text>
            <Text style={s.description}>{description}</Text>
          </View>
          <Switch
            value={value}
            onValueChange={onValueChange}
            trackColor={{ false: C.surfaceRaised, true: C.accent }}
            thumbColor="#FFFFFF"
          />
        </View>
      </TouchableOpacity>
      {value && expanded ? <View style={s.expanded}>{expanded}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  group: {
    // paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  textStack: {
    flex: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  description: {
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 2,
  },
  expanded: {
    paddingBottom: 8,
    gap: 8,
  },
});
