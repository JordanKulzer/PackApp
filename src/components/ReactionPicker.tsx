// Unified reaction picker — popover anchored at the smiley button on a
// chat message or activity row. Same geometry/animation as
// MessageActionMenu so the patterns stay consistent.
//
// Agnostic to target type: parent decides what `onToggle(emoji)` does.
// One-reaction-per-user model: tapping any emoji either replaces the
// user's existing reaction or removes it (if they already have that
// emoji). The picker itself doesn't track state — it just fires the
// toggle and dismisses.

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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "💪"] as const;

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
  // Emoji(s) the current user already has on this target. Highlighted
  // in the picker so the user can see what they're toggling. With the
  // one-per-user model, this is at most one entry — but the shape is
  // an array for forward compat if we ever loosen that.
  existingReactions: string[];
  onToggle: (emoji: string) => void;
}

const PICKER_HEIGHT = 52;
const EMOJI_SIZE = 28;
const VERTICAL_GAP = 4;
const BOTTOM_BUFFER = 20;
const SCREEN_EDGE_MARGIN = 8;

export function ReactionPicker({
  visible,
  onClose,
  anchorPosition,
  existingReactions,
  onToggle,
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
      scale.setValue(0.95);
    }
  }, [visible, opacity, scale]);

  // Right-edge aligned to the smiley (legacy positioning) with bottom-flip
  // when the below-anchor position would overflow the visible area.
  const right = Math.max(
    SCREEN_EDGE_MARGIN,
    screenWidth - anchorPosition.x - anchorPosition.width,
  );

  const belowY = anchorPosition.y + anchorPosition.height + VERTICAL_GAP;
  const aboveY = anchorPosition.y - PICKER_HEIGHT - VERTICAL_GAP;
  const wouldOverflowBottom =
    belowY + PICKER_HEIGHT > screenHeight - insets.bottom - BOTTOM_BUFFER;
  const top = wouldOverflowBottom
    ? Math.max(insets.top + SCREEN_EDGE_MARGIN, aboveY)
    : belowY;

  const handleEmojiPress = (emoji: string) => {
    onClose();
    onToggle(emoji);
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
            { top, right, opacity, transform: [{ scale }] },
          ]}
          // Stop press propagation so taps inside don't dismiss.
          onStartShouldSetResponder={() => true}
        >
          {REACTION_EMOJIS.map((emoji) => {
            const active = existingReactions.includes(emoji);
            return (
              <Pressable
                key={emoji}
                style={({ pressed }) => [
                  s.emojiBtn,
                  active && s.emojiBtnActive,
                  pressed && { opacity: 0.6 },
                ]}
                onPress={() => handleEmojiPress(emoji)}
                hitSlop={4}
              >
                <Text style={s.emoji}>{emoji}</Text>
              </Pressable>
            );
          })}
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
    height: PICKER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    backgroundColor: "#1C1C1E",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "#2C2C2E",
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
  emojiBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    marginHorizontal: 1,
  },
  emojiBtnActive: {
    backgroundColor: "rgba(10, 132, 255, 0.18)",
  },
  emoji: {
    fontSize: EMOJI_SIZE,
    textAlign: "center",
    lineHeight: EMOJI_SIZE + 4,
  },
});
