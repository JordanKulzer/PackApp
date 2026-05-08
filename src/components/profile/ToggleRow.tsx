// ToggleRow — boolean-preference row primitive (Pass 23).
//
// Anatomy: [label\nsubtitle? (flex)][Switch].
// Tappable: tapping anywhere on the row flips `value` (standard iOS
// Settings UX). The Switch's own touch zone also fires onValueChange —
// double-tap-zone is intentional. Hairline divider rendered by the
// component itself, suppressed via `isLast` for the bottom row.
//
// No icon prop — current consumers (Notifications) render icon-less, and
// adding optional icon support is premature. Add it when a second
// consumer wants it.
//
// Switch styling lifts the existing notifications.tsx colors verbatim
// (trackColor false=surfaceRaised, true=accent; thumbColor="#FFFFFF").
// Pass 23 is a visual migration of the surrounding row anatomy, not an
// aesthetic redesign of the toggle itself.
//
// Consumers (as of Pass 23):
//   - app/(app)/profile/notifications.tsx (6 rows under the Activity
//     section header; no icons; row-tap-toggles)

import { View, Text, Switch, TouchableOpacity, StyleSheet } from "react-native";
import { colors } from "../../theme/colors";

const C = {
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  accent: colors.self,
} as const;

interface ToggleRowProps {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  isLast?: boolean;
  disabled?: boolean;
}

export function ToggleRow({
  label,
  subtitle,
  value,
  onValueChange,
  isLast,
  disabled,
}: ToggleRowProps) {
  return (
    <TouchableOpacity
      onPress={() => onValueChange(!value)}
      activeOpacity={0.7}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
    >
      <View style={[s.row, !isLast && s.rowBordered]}>
        <View style={s.textStack}>
          <Text style={s.label}>{label}</Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        </View>
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: C.surfaceRaised, true: C.accent }}
          thumbColor="#FFFFFF"
        />
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
  },
  rowBordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  textStack: {
    flex: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 1,
  },
});
