// Pill-shaped category chip used by:
//   - LogSheet's QuickSelectGrid (filled + empty + slot)
//   - SeeMoreCategoriesSheet (filled with optional ✓ marker)
//   - Onboarding category-selection screen (filled, selected state)
//
// Long-press feedback: subtle scale + light haptic. Subdued by design.

import React, { useRef } from "react";
import {
  Animated,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  Vibration,
  View,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface ChipProps {
  label: string;
  selected?: boolean;        // ✓ marker on the right
  pressed?: boolean;         // visually pressed (used by Onboarding multi-select)
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  // Pass 25-followup-C-fix-2: callers that wrap the chip in a fixed-width
  // grid cell (LogSheet, SeeMoreCategoriesSheet) pass `{ flex: 1 }` so the
  // chip fills its cell vertically — gives uniform-height-per-row when one
  // chip in the row wraps to two lines. Onboarding renders chips inline
  // without a cell wrapper and passes nothing → chip stays content-sized.
  containerStyle?: StyleProp<ViewStyle>;
}

export function CategoryChip({
  label,
  selected,
  pressed,
  onPress,
  onLongPress,
  disabled,
  containerStyle,
}: ChipProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handleLongPress = () => {
    if (disabled) return;
    Vibration.vibrate(20);
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.02, useNativeDriver: true, speed: 50, bounciness: 0 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 4 }),
    ]).start();
    onLongPress?.();
  };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, containerStyle]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress ? handleLongPress : undefined}
        disabled={disabled}
        style={({ pressed: pressedNow }) => [
          s.chip,
          // When the wrapper is told to flex (containerStyle = { flex: 1 }),
          // make the inner Pressable fill it so the chip background covers
          // the stretched cell rather than leaving empty space below.
          containerStyle ? s.chipFill : null,
          pressed && s.chipSelected,
          pressedNow && !disabled && s.chipPressed,
          disabled && s.chipDisabled,
        ]}
      >
        <Text
          style={[s.label, pressed && s.labelSelected]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {label}
        </Text>
        {selected && (
          <Ionicons
            name="checkmark"
            size={14}
            color="#3FB950"
            style={s.checkIcon}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

interface EmptySlotProps {
  onPress: () => void;
  containerStyle?: StyleProp<ViewStyle>;
}

export function EmptyChipSlot({ onPress, containerStyle }: EmptySlotProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.emptySlot,
        containerStyle,
        pressed && s.emptySlotPressed,
      ]}
    >
      <Ionicons name="add" size={20} color="rgba(255, 255, 255, 0.30)" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  // Chip and emptySlot share minHeight so 6 cells in a 2×3 grid render
  // identical shapes regardless of text length. Labels with 2-line names
  // ("Strength Training", "Racquet Sports") fit with a slight font scale.
  chip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 52,
    gap: 6,
  },
  // Applied only when containerStyle is passed (flex-cell consumers).
  // Fills the stretched cell so the chip's background covers the full
  // row-uniform height instead of sitting top-aligned with empty space.
  chipFill: {
    flex: 1,
  },
  chipSelected: {
    backgroundColor: "rgba(10, 132, 255, 0.18)",
    borderColor: "rgba(10, 132, 255, 0.55)",
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  label: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
    flexShrink: 1,
  },
  labelSelected: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  checkIcon: {
    marginLeft: 2,
  },
  // Softened: borderWidth 1.5 + 0.12 alpha + matching icon tint so empty
  // slots invite tapping without competing with filled chips for attention.
  emptySlot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 52,
  },
  emptySlotPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
});

// Suppress an "unused" lint when we drop View import on small refactors.
void View;
