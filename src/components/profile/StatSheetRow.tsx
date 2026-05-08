// StatSheetRow — Lifetime section row primitive (Pass 22).
//
// Anatomy: [icon slot][label (flex)][value, right-aligned].
// Hairline divider is rendered by the component itself, suppressed for
// the bottom row via `isLast`. No card wrapper — rows visually group
// through shared dividers only.
//
// Consumers:
//   - app/(app)/profile/index.tsx       (self-view: 5 rows incl. Days Logged)
//   - app/user/[id].tsx                 (public view: 4 rows)

import { View, Text, StyleSheet } from "react-native";

const C = {
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
} as const;

interface StatSheetRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  isLast?: boolean;
}

export function StatSheetRow({
  icon,
  label,
  value,
  isLast,
}: StatSheetRowProps) {
  return (
    <View style={[s.row, !isLast && s.rowBordered]}>
      <View style={s.iconSlot}>{icon}</View>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  rowBordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  iconSlot: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: C.textSecondary,
  },
  value: {
    fontSize: 15,
    fontWeight: "700",
    color: C.textPrimary,
  },
});
