import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Vibration,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { showToast } from "../lib/toast";

const C = {
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: "#2F81F7",
} as const;

export interface InviteSheetProps {
  visible: boolean;
  onClose: () => void;
  packName: string;
  inviteCode: string;
  memberCount: number;
  memberLimit: number;
}

export function InviteSheet({
  visible,
  onClose,
  packName,
  inviteCode,
  memberCount,
  memberLimit,
}: InviteSheetProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const slideAnim = useRef(new Animated.Value(600)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const justCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Improved PanResponder pattern (matches the recent LogSheet fix):
  // follow the finger during the drag, loosen thresholds, snap back
  // when the dismissal threshold misses or the gesture is interrupted.
  const dismissPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) slideAnim.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 60 || g.vy > 0.3) {
          onCloseRef.current();
        } else {
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
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

  // Crossfade the copy/check icons whenever `justCopied` flips.
  useEffect(() => {
    Animated.timing(checkOpacity, {
      toValue: justCopied ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [justCopied, checkOpacity]);

  useEffect(() => {
    return () => {
      if (justCopiedTimerRef.current) clearTimeout(justCopiedTimerRef.current);
    };
  }, []);

  const handleCopyCode = async () => {
    await Clipboard.setStringAsync(inviteCode);
    Vibration.vibrate(40);
    setJustCopied(true);
    showToast({ message: "Code copied", kind: "success" });
    if (justCopiedTimerRef.current) clearTimeout(justCopiedTimerRef.current);
    justCopiedTimerRef.current = setTimeout(() => setJustCopied(false), 1500);
  };

  const handleShare = async () => {
    await Share.share({
      message: `Join my pack "${packName}"! Invite code: ${inviteCode}`,
    });
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

          <View style={s.body}>
            <Text style={s.title} numberOfLines={2}>
              Invite friends to {packName}
            </Text>
            <Text style={s.subline}>
              {memberCount} of {memberLimit} slots filled
            </Text>

            <TouchableOpacity
              style={s.codeChip}
              onPress={handleCopyCode}
              activeOpacity={0.7}
            >
              <Text style={s.codeText} selectable>
                {inviteCode}
              </Text>
              <View style={s.iconStack}>
                <Animated.View
                  style={{
                    opacity: checkOpacity.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 0],
                    }),
                  }}
                >
                  <Ionicons
                    name="copy-outline"
                    size={18}
                    color={C.textSecondary}
                  />
                </Animated.View>
                <Animated.View
                  style={[s.iconStackOverlay, { opacity: checkOpacity }]}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color="#3FB950"
                  />
                </Animated.View>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.shareBtn}
              onPress={handleShare}
              activeOpacity={0.85}
            >
              <Ionicons
                name="share-outline"
                size={18}
                color="#FFFFFF"
                style={s.shareIcon}
              />
              <Text style={s.shareBtnText}>Share…</Text>
            </TouchableOpacity>
          </View>
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
  },
  handleWrap: {
    alignItems: "center",
    paddingTop: 14,
    paddingBottom: 10,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
  },
  body: {
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 32,
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: C.textPrimary,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  subline: {
    fontSize: 13,
    color: C.textSecondary,
    textAlign: "center",
  },
  codeChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginTop: 8,
  },
  codeText: {
    fontSize: 24,
    fontWeight: "700",
    color: C.textPrimary,
    letterSpacing: 4,
    fontFamily: "Menlo",
  },
  iconStack: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  iconStackOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.accent,
    borderRadius: 14,
    height: 52,
  },
  shareIcon: {
    marginRight: 8,
  },
  shareBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
