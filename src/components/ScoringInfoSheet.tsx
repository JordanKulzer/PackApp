// ScoringInfoSheet — informational bottom sheet explaining the streak
// multiplier system (Pass 26-followup).
//
// Triggered from the SCORING section header on app/(app)/pack/create.tsx.
// Read-only modal, no inputs, no mutating actions. Tap-outside to dismiss
// or invoke the close button in the handle area.
//
// Animation pattern lifted from LogSheet — RN Modal + Animated.View slide
// translateY, mounted-then-animated-in via a `modalVisible` gate so the
// modal can play its slide-out before unmounting. Same easings (cubic),
// same timings (300ms in, 250ms out), same backdrop opacity (0.6).
//
// All copy in this file is provisional. Voice review pending — every
// user-visible string is flagged TODO(voice review).

import { useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableWithoutFeedback,
} from "react-native";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
} as const;

interface ScoringInfoSheetProps {
  visible: boolean;
  onClose: () => void;
}

interface MultiplierRow {
  range: string;
  multiplier: string;
}

// TODO(voice review): all copy in this component is provisional.
const COPY = {
  title: "Streak Multiplier",
  body:
    "Your streak grows each day you hit your goals. The longer your streak, " +
    "the more your points multiply.",
  rows: [
    { range: "Days 1–2", multiplier: "1×" },
    { range: "Days 3–4", multiplier: "1.25×" },
    { range: "Days 5–6", multiplier: "1.5×" },
    { range: "Day 7+", multiplier: "2×" },
  ] satisfies MultiplierRow[],
  footer: "Miss a day, your streak resets.",
};

export function ScoringInfoSheet({ visible, onClose }: ScoringInfoSheetProps) {
  const [modalVisible, setModalVisible] = useState(visible);
  const slideAnim = useRef(new Animated.Value(600)).current;

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
      }).start(() => setModalVisible(false));
    }
  }, [visible, slideAnim]);

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
          <View style={s.handleWrap}>
            <View style={s.handle} />
          </View>

          <Text style={s.title}>{COPY.title}</Text>
          <Text style={s.body}>{COPY.body}</Text>

          <View style={s.table}>
            {COPY.rows.map((row, i) => (
              <View
                key={row.range}
                style={[s.tableRow, i < COPY.rows.length - 1 && s.tableRowBordered]}
              >
                <Text style={s.tableRange}>{row.range}</Text>
                <Text style={s.tableMultiplier}>{row.multiplier}</Text>
              </View>
            ))}
          </View>

          <Text style={s.footer}>{COPY.footer}</Text>
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
    paddingBottom: 32,
  },
  handleWrap: { alignItems: "center", paddingTop: 12, paddingBottom: 4 },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: C.textPrimary,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  body: {
    fontSize: 14,
    color: C.textSecondary,
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  table: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  tableRowBordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  tableRange: {
    fontSize: 15,
    color: C.textPrimary,
    fontWeight: "500",
  },
  tableMultiplier: {
    fontSize: 15,
    color: C.textPrimary,
    fontWeight: "700",
  },
  footer: {
    fontSize: 13,
    color: C.textTertiary,
    paddingHorizontal: 20,
  },
});
