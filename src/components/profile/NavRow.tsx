// NavRow — navigation/action row primitive (Pass 22, +`dangerous` Pass 22-polish).
//
// Anatomy: [icon][label\nsubtitle? (flex)][trailing].
// Default trailing is a chevron-right; override with `trailing` to render a
// status text, ActivityIndicator, or any other ReactNode (pass null to
// suppress entirely). Hairline divider rendered by the component itself,
// suppressed via `isLast` for the bottom row.
//
// `dangerous` (Pass 22-polish): when true, label text renders in danger red
// for destructive actions (Delete Account). Icon color is caller-controlled
// — pass a danger-colored icon for full-row red treatment if desired. The
// chevron stays default tertiary regardless. Purely additive: omitting
// `dangerous` (or passing false) leaves the row byte-identical to its
// pre-polish render.
//
// Consumers (all on app/(app)/profile/index.tsx as of Pass 22-polish):
//   - Settings → Notifications (icon + label + subtitle + chevron)
//   - About → Privacy / Terms / Support (icon + label + chevron)
//   - Account → Sign Out (icon + label + chevron)
//   - Account → Delete Account (icon + label + chevron, dangerous=true)
//   - Integrations → Apple Health / Oura / Whoop (icon + label + subtitle +
//                                                  trailing colored Text)

import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const C = {
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  danger: "#F85149",
} as const;

interface NavRowProps {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  isLast?: boolean;
  disabled?: boolean;
  dangerous?: boolean;
}

const DEFAULT_TRAILING = (
  <Ionicons name="chevron-forward" size={18} color={C.textTertiary} />
);

export function NavRow({
  icon,
  label,
  subtitle,
  onPress,
  trailing,
  isLast,
  disabled,
  dangerous,
}: NavRowProps) {
  const trailingNode = trailing === undefined ? DEFAULT_TRAILING : trailing;

  const content = (
    <View style={[s.row, !isLast && s.rowBordered]}>
      <View style={s.iconSlot}>{icon}</View>
      <View style={s.textStack}>
        <Text style={[s.label, dangerous && s.labelDangerous]}>{label}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailingNode}
    </View>
  );

  if (!onPress) return content;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
      accessibilityRole="button"
    >
      {content}
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
  iconSlot: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  textStack: {
    flex: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  labelDangerous: {
    color: C.danger,
  },
  subtitle: {
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 1,
  },
});
