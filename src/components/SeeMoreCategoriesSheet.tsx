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
// Swap mode (Pass 25-followup-C-fix): when entryPoint === "add" and Quick
// Select is full, the caller passes a non-null pendingSwapCategory and the
// sheet flips into swap mode — header text changes, the All-categories
// grid is hidden, and the pinned chips become tap targets that pick the
// slot to replace. The mode switch is wrapped in LayoutAnimation so the
// content reflow animates instead of snapping. Kept inside the same
// overlay (rather than a second modal) for the same iOS Modal-stacking
// reason as above.
//
// The caller owns persistence (Supabase update + context refresh) — this
// sheet is purely the picker UI.

import React from "react";
import {
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CategoryChip } from "./CategoryChip";
import {
  ACTIVITY_CATEGORIES,
  CATEGORY_DISPLAY_NAMES,
  type ActivityCategory,
} from "../lib/activityCategoryMap";

export type SeeMoreEntryPoint = "add" | "browse" | "replace";

interface Props {
  visible: boolean;
  entryPoint: SeeMoreEntryPoint;
  pinnedCategories: readonly ActivityCategory[];
  userId: string | null | undefined;
  onClose: () => void;
  onSelect: (category: ActivityCategory) => void;
  // Swap mode: when set, the sheet shows the swap-target picker instead of
  // the All-categories grid. The pinned chips become tap targets that
  // resolve to handleSwapModeReplace(idx) on the caller side.
  pendingSwapCategory?: ActivityCategory | null;
  onSwapModeReplace?: (idx: number) => void;
  onSwapCancel?: () => void;
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
  userId: _userId,
  onClose,
  onSelect,
  pendingSwapCategory,
  onSwapModeReplace,
  onSwapCancel,
}: Props) {
  const pinnedSet = new Set<ActivityCategory>(pinnedCategories);
  const inSwapMode = entryPoint === "add" && pendingSwapCategory != null;

  // Animate the mode flip so the All-categories grid collapses smoothly
  // into the swap-target picker (and back) instead of a hard cut.
  React.useEffect(() => {
    if (!visible) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [inSwapMode, visible]);

  // For "add" entry, already-pinned chips are inert (no-op tap) to avoid
  // double-pin; in swap mode pinned chips become the tap targets.
  const isDisabled = (cat: ActivityCategory) =>
    entryPoint === "add" && pinnedSet.has(cat) && !inSwapMode;

  if (!visible) return null;

  return (
    <View style={s.overlay} pointerEvents="auto">
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.handleWrap}>
          <View style={s.handle} />
        </View>

        <View style={s.header}>
          <Text style={s.headerTitle}>
            {inSwapMode ? "Replace which one?" : "See More Categories"}
          </Text>
          <Text style={s.headerSub}>
            {inSwapMode
              ? `Quick Select is full. Tap a chip to swap out for ${CATEGORY_DISPLAY_NAMES[pendingSwapCategory!]}.`
              : HEADER_TEXT[entryPoint]}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {inSwapMode ? (
            <>
              <Text style={s.sectionLabel}>Pinned</Text>
              <View style={s.grid}>
                {pinnedCategories.map((cat, idx) => (
                  <View key={`pinned-${cat}`} style={s.cell}>
                    <CategoryChip
                      label={CATEGORY_DISPLAY_NAMES[cat]}
                      containerStyle={s.chipFill}
                      onPress={() => {
                        onSwapModeReplace?.(idx);
                      }}
                    />
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={s.cancelBtn}
                activeOpacity={0.7}
                onPress={() => onSwapCancel?.()}
              >
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.sectionLabel}>All categories</Text>
              <View style={s.grid}>
                {SORTED_CATEGORIES.map((cat) => (
                  <View key={`all-${cat}`} style={s.cell}>
                    <CategoryChip
                      label={CATEGORY_DISPLAY_NAMES[cat]}
                      selected={pinnedSet.has(cat)}
                      disabled={isDisabled(cat)}
                      containerStyle={s.chipFill}
                      onPress={() => {
                        onSelect(cat);
                      }}
                    />
                  </View>
                ))}
              </View>
            </>
          )}
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
  // dimensions — matches the LogSheet Quick Select layout. flexGrow: 1
  // lets cells share the remainder evenly so widths stay uniform within
  // each row.
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  cell: {
    width: "30%",
    flexGrow: 1,
  },
  // Pass 25-followup-C-fix-2: passed as CategoryChip's containerStyle so
  // the chip wrapper stretches to the cell's row-uniform height.
  chipFill: {
    flex: 1,
  },
  cancelBtn: {
    marginTop: 20,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#8B949E",
  },
});
