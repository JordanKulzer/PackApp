// Intentional-sharing Phase 2 — kind/category picker for the standalone
// "Share an activity" launcher in ChatTab.
//
// Two state-switched tiers inside a SINGLE Modal — NOT two sibling
// modals. iOS won't reliably present a sibling Modal while another is
// already showing, so the tier transition happens inline with a tier
// state flag. SharePostSheet opens only AFTER this picker's Modal
// fully dismisses (the ChatTab integration preserves that ordering by
// setting `share` only on onResolve and after the picker has been
// hidden).
//
// Tier 1: 4 vertical rows (Steps / Workout / Calories / Water) — picking
//   Steps / Calories / Water resolves immediately. Picking Workout
//   switches the sheet into Tier 2 inline.
// Tier 2: a 3-column CategoryChip grid over the 15 ActivityCategory
//   values, alphabetical with "Other" last (lifted layout from
//   SeeMoreCategoriesSheet — but NOT the whole component; that one's
//   entry-point/pinning/swap machinery is LogSheet-specific).
//
// Sheet shell matches the established RulesSheet / InviteSheet pattern:
// transparent Modal + dark surface (#121821) + drag handle + close X
// header + slide-up Animated.View. Drag-down dismisses.

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CategoryChip } from "./CategoryChip";
import { CategoryIcon } from "./CategoryIcon";
import {
  ACTIVITY_CATEGORIES,
  CATEGORY_DISPLAY_NAMES,
  type ActivityCategory,
} from "../lib/activityCategoryMap";
import type { Category } from "../lib/categories";
import type { ShareKind } from "../lib/sharePost";

const C = {
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
} as const;

// Tier 1 row config — the 4 ShareKinds, each paired with the Category
// literal used by the shared CategoryIcon component. Display labels
// match the existing CATEGORY_LABELS in src/lib/categories.ts.
const TIER1_ROWS: ReadonlyArray<{
  kind: ShareKind;
  category: Category;
  label: string;
}> = [
  { kind: "steps_share", category: "steps", label: "Steps" },
  { kind: "workout_share", category: "workouts", label: "Workout" },
  { kind: "calories_share", category: "calories", label: "Calories" },
  { kind: "water_share", category: "water", label: "Water" },
];

// Tier 2 ordering — mirror SeeMoreCategoriesSheet's SORTED_CATEGORIES:
// alphabetical by display name, with "Other" pinned to the end so the
// list reads cleanly.
const SORTED_CATEGORIES: readonly ActivityCategory[] = (() => {
  const rest: ActivityCategory[] = ACTIVITY_CATEGORIES.filter(
    (c): c is ActivityCategory => c !== "other",
  );
  rest.sort((a, b) =>
    CATEGORY_DISPLAY_NAMES[a].localeCompare(CATEGORY_DISPLAY_NAMES[b]),
  );
  return [...rest, "other" as ActivityCategory];
})();

export type SharePickerResolution =
  | { kind: "steps_share" }
  | { kind: "calories_share" }
  | { kind: "water_share" }
  | { kind: "workout_share"; category: ActivityCategory };

interface Props {
  visible: boolean;
  onResolve: (resolution: SharePickerResolution) => void;
  onClose: () => void;
}

export function SharePickerSheet({ visible, onResolve, onClose }: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const [tier, setTier] = useState<1 | 2>(1);
  const slideAnim = useRef(new Animated.Value(600)).current;

  // Reset tier on every fresh open. A user who picked Workout → backed
  // out via X / drag-dismiss → reopens should land on Tier 1, not Tier 2.
  useEffect(() => {
    if (visible) setTier(1);
  }, [visible]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          onCloseRef.current();
        }
      },
      onPanResponderTerminate: () => {},
    }),
  ).current;

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      slideAnim.setValue(600);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 600,
        duration: 250,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setModalVisible(false);
      });
    }
  }, [visible, slideAnim]);

  const handleTier1Press = (row: (typeof TIER1_ROWS)[number]) => {
    if (row.kind === "workout_share") {
      // Workout → into Tier 2 inline (no Modal stacking).
      setTier(2);
      return;
    }
    onResolve({ kind: row.kind });
  };

  const handleTier2Press = (category: ActivityCategory) => {
    onResolve({ kind: "workout_share", category });
  };

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={s.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFillObject} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}
        >
          <View style={s.handleWrap} {...dismissPanResponder.panHandlers}>
            <View style={s.handle} />
          </View>

          <View style={s.headerRow}>
            {tier === 2 ? (
              <TouchableOpacity
                onPress={() => setTier(1)}
                hitSlop={8}
                style={s.headerSide}
              >
                <Ionicons
                  name="chevron-back"
                  size={22}
                  color={C.textPrimary}
                />
              </TouchableOpacity>
            ) : (
              <View style={s.headerSide} />
            )}
            <Text style={s.headerTitle}>
              {tier === 1 ? "Share an activity" : "Pick a workout"}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={8}
              style={s.headerSide}
            >
              <Ionicons name="close" size={24} color={C.textPrimary} />
            </TouchableOpacity>
          </View>

          {tier === 1 ? (
            <View style={s.tier1List}>
              {TIER1_ROWS.map((row) => (
                <TouchableOpacity
                  key={row.kind}
                  style={s.tier1Row}
                  onPress={() => handleTier1Press(row)}
                  activeOpacity={0.7}
                >
                  <View style={s.tier1IconTile}>
                    <CategoryIcon
                      category={row.category}
                      size={20}
                      color={C.textSecondary}
                    />
                  </View>
                  <Text style={s.tier1Label}>{row.label}</Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={C.textTertiary}
                  />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <ScrollView
              style={s.tier2Scroll}
              contentContainerStyle={s.tier2ScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={s.tier2SectionLabel}>All categories</Text>
              <View style={s.tier2Grid}>
                {SORTED_CATEGORIES.map((cat) => (
                  <View key={`share-${cat}`} style={s.tier2Cell}>
                    <CategoryChip
                      label={CATEGORY_DISPLAY_NAMES[cat]}
                      containerStyle={s.tier2ChipFill}
                      onPress={() => handleTier2Press(cat)}
                    />
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    paddingBottom: 32,
  },
  handleWrap: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  // Equal-width left/right slots so the title centers regardless of
  // whether a back chevron is rendered.
  headerSide: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: C.textPrimary,
    textAlign: "center",
  },
  // Tier 1 — vertical list of 4 kind rows. Hairline dividers between
  // rows; icon tile + label + chevron mirror the address-book row shape.
  tier1List: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  tier1Row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  tier1IconTile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  tier1Label: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: C.textPrimary,
  },
  // Tier 2 — 3-column CategoryChip grid lifted from SeeMoreCategoriesSheet.
  // Same cell sizing math (30% min width + flexGrow:1 so cells share the
  // remainder evenly) so the chips render identical dimensions per row.
  tier2Scroll: {
    flexShrink: 1,
  },
  tier2ScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  tier2SectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.textTertiary,
    letterSpacing: 0.8,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  tier2Grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tier2Cell: {
    width: "30%",
    flexGrow: 1,
  },
  tier2ChipFill: {
    flex: 1,
  },
});
