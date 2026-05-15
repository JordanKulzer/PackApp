// Loading placeholder for a single Home pack-grid cell. Mirrors
// DarkPackCard's active-card layout (rings + status) so the
// skeleton→data transition is minimal-shift for the common case;
// quiet-week cards (which are much shorter) settle slightly — an
// accepted tradeoff since real card height is unknowable pre-fetch.
//
// Container metrics + colors mirror app/(app)/home.tsx's `card`
// StyleSheet. There's no shared card-metrics module today — keep
// these in sync if `card` / the `C` palette in home.tsx changes.

import React from "react";
import { StyleSheet, View } from "react-native";
import { SkeletonBox } from "./SkeletonBox";

const C = {
  surface: "#121821",
  border: "#30363D",
};

export function SkeletonPackCard() {
  return (
    <View style={s.container}>
      {/* Row 1 — pack name + window badge */}
      <View style={s.topRow}>
        <SkeletonBox width="60%" height={16} />
        <SkeletonBox width={56} height={18} borderRadius={6} />
      </View>

      {/* Rings row — 3 ring placeholders, each with name + meta below */}
      <View style={s.ringsRow}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={s.ringCard}>
            <SkeletonBox width={96} height={96} borderRadius={48} />
            <SkeletonBox width={70} height={12} />
            <SkeletonBox width={50} height={11} />
          </View>
        ))}
      </View>

      {/* Status line */}
      <SkeletonBox width="45%" height={13} />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: C.border,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  ringsRow: {
    flexDirection: "row",
    paddingVertical: 14,
    gap: 12,
  },
  ringCard: {
    alignItems: "center",
    gap: 6,
  },
});
