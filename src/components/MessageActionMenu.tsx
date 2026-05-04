// Custom popover for chat message actions. Anchored beneath the row's
// ⋯ button. Backdrop tap dismisses; Edit/Delete fire callbacks for own
// messages, Report shows a placeholder alert for others'.
//
// The popover doesn't yet flip up if it would fall off the bottom of the
// screen — most messages render in the middle of the visible area, so
// this is acceptable for v1. Polish pass can add flip later.

import React, { useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Platform,
  useWindowDimensions,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

export interface AnchorPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  anchorPosition: AnchorPosition;
  isOwn: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

const POPOVER_WIDTH = 140;
// Conservative max — covers both the 2-item Edit/Delete + divider (~88pt)
// and the 1-item Report layout (~44pt). Used for the bottom-flip threshold;
// hardcoded so we don't need an onLayout round-trip before positioning.
const POPOVER_HEIGHT_MAX = 100;
const VERTICAL_GAP = 4;
const SCREEN_EDGE_MARGIN = 8;
const BOTTOM_BUFFER = 20;

export function MessageActionMenu({
  visible,
  onClose,
  anchorPosition,
  isOwn,
  onEdit,
  onDelete,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.95)).current;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }).start();
      // Reset scale immediately so the next open animates from 0.95 again.
      scale.setValue(0.95);
    }
  }, [visible, opacity, scale]);

  // Center horizontally under the anchor, clamping to screen edges so
  // the popover stays fully on-screen. Works for both the legacy smiley
  // anchor (width > 0) and the touch-point anchor (width = 0; centers
  // directly under the touch).
  const desiredCenterX = anchorPosition.x + anchorPosition.width / 2;
  const desiredLeft = desiredCenterX - POPOVER_WIDTH / 2;
  const left = Math.max(
    SCREEN_EDGE_MARGIN,
    Math.min(desiredLeft, screenWidth - POPOVER_WIDTH - SCREEN_EDGE_MARGIN),
  );

  // Vertical: prefer rendering below the anchor. Flip above when the
  // below-position would overflow the visible area (keyboard/safe area).
  const belowY = anchorPosition.y + anchorPosition.height + VERTICAL_GAP;
  const aboveY = anchorPosition.y - POPOVER_HEIGHT_MAX - VERTICAL_GAP;
  const wouldOverflowBottom =
    belowY + POPOVER_HEIGHT_MAX >
    screenHeight - insets.bottom - BOTTOM_BUFFER;
  const top = wouldOverflowBottom
    ? Math.max(insets.top + SCREEN_EDGE_MARGIN, aboveY)
    : belowY;

  const handleEdit = () => {
    onClose();
    onEdit?.();
  };

  const handleDelete = () => {
    onClose();
    onDelete?.();
  };

  const handleReport = () => {
    onClose();
    Alert.alert("Reporting coming soon");
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable style={s.backdrop} onPress={onClose}>
        <Animated.View
          style={[
            s.popover,
            { top, left, opacity, transform: [{ scale }] },
          ]}
          // Stop press propagation so taps inside the popover don't dismiss it.
          onStartShouldSetResponder={() => true}
        >
          {isOwn ? (
            <>
              <Pressable
                style={({ pressed }) => [s.item, pressed && s.itemPressed]}
                onPress={handleEdit}
              >
                <Ionicons name="pencil-outline" size={16} color="#FFFFFF" />
                <Text style={s.label}>Edit</Text>
              </Pressable>
              <View style={s.divider} />
              <Pressable
                style={({ pressed }) => [s.item, pressed && s.itemPressed]}
                onPress={handleDelete}
              >
                <Ionicons name="trash-outline" size={16} color="#F87171" />
                <Text style={[s.label, s.labelDanger]}>Delete</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={({ pressed }) => [s.item, pressed && s.itemPressed]}
              onPress={handleReport}
            >
              <Ionicons name="flag-outline" size={16} color="#FFFFFF" />
              <Text style={s.label}>Report</Text>
            </Pressable>
          )}
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  popover: {
    position: "absolute",
    width: POPOVER_WIDTH,
    backgroundColor: "#1C1C1E",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2C2C2E",
    paddingVertical: 4,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: {
        elevation: 8,
      },
    }),
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  itemPressed: {
    opacity: 0.6,
  },
  label: {
    fontSize: 14,
    color: "#FFFFFF",
  },
  labelDanger: {
    color: "#F87171",
  },
  divider: {
    height: 1,
    backgroundColor: "#2C2C2E",
    marginHorizontal: 12,
  },
});
