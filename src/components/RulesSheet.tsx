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
import { getPackRules } from "../lib/packRules";
import type { Pack } from "../types/database";

const C = {
  surface: "#121821",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
} as const;

export interface RulesSheetProps {
  visible: boolean;
  onClose: () => void;
  pack: Pack;
}

export function RulesSheet({ visible, onClose, pack }: RulesSheetProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(600)).current;

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

  const rules = getPackRules(pack);
  const windowLabel = rules.window === "weekly" ? "Weekly" : "Monthly";
  const visibleSpecialEvents = rules.specialEvents.filter((e) => e.enabled);

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
            <View style={{ width: 28 }} />
            <Text style={s.headerTitle}>How it works</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={C.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Section 1 — How to score */}
            <Text style={s.sectionTitle}>How to score</Text>
            <Text style={s.sectionSubtitle}>
              Points per activity in this pack
            </Text>
            {rules.activities.map((a, i) => {
              const isLast = i === rules.activities.length - 1;
              const showWorkoutMax = a.type === "workout" && a.enabled;
              return (
                <View key={a.type}>
                  <View style={s.activityRow}>
                    <View style={s.activityLeft}>
                      <Text
                        style={[s.activityLabel, !a.enabled && s.dim]}
                      >
                        {a.label}
                      </Text>
                      {showWorkoutMax && a.dailyMax != null ? (
                        <Text style={s.activitySubtle}>
                          (max {a.dailyMax} per day)
                        </Text>
                      ) : null}
                    </View>
                    <View style={s.activityRight}>
                      {a.enabled ? (
                        <Text style={s.activityGoal}>{a.goalDisplay}</Text>
                      ) : null}
                    </View>
                  </View>
                  {!isLast && <View style={s.divider} />}
                </View>
              );
            })}

            {/* Section 3 — Competition window */}
            <Text style={s.sectionTitle}>Competition window</Text>
            <View style={s.activityRow}>
              <Text style={s.activityLabel}>{windowLabel}</Text>
            </View>

            {/* Section 4 — Special events */}
            {visibleSpecialEvents.length > 0 && (
              <>
                <Text style={s.sectionTitle}>Special events</Text>
                {visibleSpecialEvents.map((e, i) => {
                  const isLast = i === visibleSpecialEvents.length - 1;
                  return (
                    <View key={e.key}>
                      <View style={s.eventRow}>
                        <Text style={s.eventName}>{e.name}</Text>
                        <Text style={s.eventDescription}>
                          {e.description}
                        </Text>
                      </View>
                      {!isLast && <View style={s.divider} />}
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>
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
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: C.textPrimary,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: C.textSecondary,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: C.textTertiary,
    marginBottom: 10,
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 0,
    paddingVertical: 14,
    minHeight: 56,
  },
  activityLeft: {
    flexShrink: 1,
  },
  activityLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  activitySubtle: {
    fontSize: 12,
    color: C.textTertiary,
    marginTop: 2,
  },
  activityRight: {
    alignItems: "flex-end",
  },
  activityPoints: {
    fontSize: 15,
    fontWeight: "700",
    color: C.textPrimary,
  },
  activityGoal: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  dim: {
    color: C.textTertiary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginHorizontal: 0,
  },
  eventRow: {
    paddingHorizontal: 0,
    paddingVertical: 12,
  },
  eventName: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
    marginBottom: 2,
  },
  eventDescription: {
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 18,
  },
});
