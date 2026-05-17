import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const C = {
  accent: "#2F81F7",
  white: "#FFFFFF",
} as const;

interface LogSheetCoachMarkProps {
  visible: boolean;
  onDismiss: () => void;
}

export function LogSheetCoachMark({
  visible,
  onDismiss,
}: LogSheetCoachMarkProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  if (!visible) return null;

  return (
    <Animated.View style={[s.bubbleWrap, { opacity }]} pointerEvents="box-none">
      <TouchableOpacity
        style={s.bubble}
        onPress={onDismiss}
        activeOpacity={0.85}
        accessibilityLabel="Log your first activity hint, tap to dismiss"
      >
        <Text style={s.bubbleText}>Log your first activity</Text>
      </TouchableOpacity>
      <View style={s.caret} />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bubbleWrap: {
    alignItems: "center",
  },
  bubble: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 5,
  },
  bubbleText: {
    color: C.white,
    fontSize: 14,
    fontWeight: "600",
  },
  // Downward-pointing caret. A square rotated 45° with bottom/right borders
  // hidden — yields a clean triangle pointing down, color-matched to the
  // bubble. Sits a hair under the bubble so the seam disappears.
  caret: {
    width: 12,
    height: 12,
    backgroundColor: C.accent,
    transform: [{ rotate: "45deg" }],
    marginTop: -6,
  },
});
