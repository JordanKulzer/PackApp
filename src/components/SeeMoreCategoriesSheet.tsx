// Inline overlay that browses all 15 categories. Renders as an absolutely-
// positioned View inside the LogSheet's existing Modal — NOT its own Modal.
// iOS won't reliably present a sibling Modal while another is showing, so
// keeping this as a plain overlay sidesteps the stacking issue and removes
// a class of dismissal-animation bugs.
//
// Three entry points (header text changes per entry):
//   "add"     — picked category gets pinned to Quick Select, overlay closes
//   "browse"  — picked category opens the log flow once (no pinning)
//   "replace" — picked category replaces the targeted slot, overlay closes
//
// The caller owns persistence (Supabase update + context refresh) — this
// sheet is purely the picker UI.

import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CategoryChip } from "./CategoryChip";
import {
  ACTIVITY_CATEGORIES,
  CATEGORY_DISPLAY_NAMES,
  type ActivityCategory,
} from "../lib/activityCategoryMap";
import { useRecentCategories } from "../hooks/useRecentCategories";

export type SeeMoreEntryPoint = "add" | "browse" | "replace";

interface Props {
  visible: boolean;
  entryPoint: SeeMoreEntryPoint;
  pinnedCategories: readonly ActivityCategory[];
  userId: string | null | undefined;
  onClose: () => void;
  onSelect: (category: ActivityCategory) => void;
}

const HEADER_TEXT: Record<SeeMoreEntryPoint, string> = {
  add: "Pick a category to add to Quick Select",
  browse: "Pick a category to log",
  replace: "Pick a replacement",
};

// Sorted alphabetically by display name; "Other" pinned to the bottom so
// the alphabetical list reads cleanly.
const SORTED_CATEGORIES: readonly ActivityCategory[] = (() => {
  const rest: ActivityCategory[] = ACTIVITY_CATEGORIES.filter(
    (c): c is ActivityCategory => c !== "other",
  );
  rest.sort((a, b) =>
    CATEGORY_DISPLAY_NAMES[a].localeCompare(CATEGORY_DISPLAY_NAMES[b]),
  );
  return [...rest, "other" as ActivityCategory];
})();

export function SeeMoreCategoriesSheet({
  visible,
  entryPoint,
  pinnedCategories,
  userId,
  onClose,
  onSelect,
}: Props) {
  const { recent } = useRecentCategories(userId ?? null, visible);
  const pinnedSet = new Set<ActivityCategory>(pinnedCategories);

  // For "add" entry, already-pinned chips are disabled to avoid double-pin
  const isDisabled = (cat: ActivityCategory) =>
    entryPoint === "add" && pinnedSet.has(cat);

  if (!visible) return null;

  return (
    <View style={s.overlay} pointerEvents="auto">
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.handleWrap}>
          <View style={s.handle} />
        </View>

        <View style={s.header}>
          <Text style={s.headerTitle}>See More Categories</Text>
          <Text style={s.headerSub}>{HEADER_TEXT[entryPoint]}</Text>
        </View>

        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {recent.length > 0 && (
            <>
              <Text style={s.sectionLabel}>Recently used</Text>
              <View style={s.grid}>
                {recent.map((cat) => (
                  <View key={`recent-${cat}`} style={s.cell}>
                    <CategoryChip
                      label={CATEGORY_DISPLAY_NAMES[cat]}
                      selected={pinnedSet.has(cat)}
                      disabled={isDisabled(cat)}
                      onPress={() => {
                        onSelect(cat);
                      }}
                    />
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={[s.sectionLabel, recent.length > 0 && { marginTop: 20 }]}>
            All categories
          </Text>
          <View style={s.grid}>
            {SORTED_CATEGORIES.map((cat) => (
              <View key={`all-${cat}`} style={s.cell}>
                <CategoryChip
                  label={CATEGORY_DISPLAY_NAMES[cat]}
                  selected={pinnedSet.has(cat)}
                  disabled={isDisabled(cat)}
                  onPress={() => {
                    onSelect(cat);
                  }}
                />
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: "#121821",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "80%",
    paddingBottom: 32,
  },
  handleWrap: { alignItems: "center", paddingTop: 12, paddingBottom: 4 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#30363D",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#E6EDF3",
  },
  headerSub: {
    fontSize: 13,
    color: "#8B949E",
    marginTop: 4,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#484F58",
    letterSpacing: 0.8,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  // 3-column grid with uniform cell widths so chips render identical
  // dimensions across both Recently used and All categories sections —
  // matches the LogSheet Quick Select layout. flexGrow: 1 lets cells
  // share the remainder evenly so widths stay uniform within each row.
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  cell: {
    width: "30%",
    flexGrow: 1,
  },
});
