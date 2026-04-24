import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useRouter } from "expo-router";
import { useCurrentUser } from "../../src/context/CurrentUserContext";
import { useAuthStore } from "../../src/stores/authStore";
import { completeOnboarding } from "../../src/lib/onboarding";

const C = {
  bg: "#0B0F14",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: "#2F81F7",
  border: "#30363D",
  surfaceRaised: "#1C2333",
} as const;

function RingsIllustration() {
  const slots: Array<{ size: number; sw: number; elevated: boolean }> = [
    { size: 44, sw: 4, elevated: false },
    { size: 60, sw: 5, elevated: true },
    { size: 44, sw: 4, elevated: false },
  ];
  return (
    <View style={ill.row}>
      {slots.map(({ size, sw, elevated }, i) => {
        const radius = (size - sw) / 2;
        const avatarR = radius * 0.52;
        return (
          <View key={i} style={[ill.slot, elevated && ill.elevated]}>
            <Svg width={size} height={size}>
              <Circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="#252E3D"
                strokeWidth={sw}
                fill="none"
              />
              <Circle cx={size / 2} cy={size / 2} r={avatarR} fill="#1A2232" />
            </Svg>
          </View>
        );
      })}
    </View>
  );
}

const ill = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 14,
    marginBottom: 8,
  },
  slot: { alignItems: "center" },
  elevated: { marginBottom: 14 },
});

export default function FirstPack() {
  const router = useRouter();
  const { applyLocal } = useCurrentUser();
  const authUser = useAuthStore((s) => s.user);
  const [completing, setCompleting] = useState(false);

  const handleSkip = () => {
    Alert.alert(
      "Skip setup?",
      "You can always connect Apple Health and create a pack later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Skip anyway",
          style: "destructive",
          onPress: async () => {
            if (!authUser?.id || completing) return;
            setCompleting(true);
            await completeOnboarding(authUser.id);
            applyLocal({ hasCompletedOnboarding: true });
            router.replace("/(app)/home");
          },
        },
      ],
    );
  };

  const finish = async () => {
    if (!authUser?.id || completing) return;
    setCompleting(true);
    await completeOnboarding(authUser.id);
    applyLocal({ hasCompletedOnboarding: true });
  };

  const handleCreatePack = async () => {
    await finish();
    router.replace("/(app)/pack/create");
  };

  const handleJoinWithCode = async () => {
    await finish();
    router.replace("/(app)/home");
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <TouchableOpacity style={s.skipBtn} onPress={handleSkip} hitSlop={12}>
          <Text style={s.skipText}>Skip</Text>
        </TouchableOpacity>

        <View style={s.illustration}>
          <RingsIllustration />
        </View>

        <Text style={s.header}>Last step — get in a pack</Text>
        <Text style={s.subtitle}>
          A pack is a group of people competing together. Create your own and
          invite friends, or join one with an invite code someone shared.
        </Text>

        <View style={s.buttons}>
          <TouchableOpacity
            style={[s.primaryBtn, completing && s.btnDisabled]}
            onPress={handleCreatePack}
            disabled={completing}
            activeOpacity={0.85}
          >
            <Text style={s.primaryBtnText}>Create a new pack</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.secondaryBtn, completing && s.btnDisabled]}
            onPress={handleJoinWithCode}
            disabled={completing}
            activeOpacity={0.85}
          >
            <Text style={s.secondaryBtnText}>I have an invite code</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.bg,
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 40,
    justifyContent: "center",
  },
  skipBtn: {
    position: "absolute",
    top: 16,
    right: 28,
  },
  skipText: {
    fontSize: 14,
    color: C.textTertiary,
  },
  illustration: {
    alignItems: "center",
    marginBottom: 32,
  },
  header: {
    fontSize: 28,
    fontWeight: "700",
    color: C.textPrimary,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    color: C.textSecondary,
    lineHeight: 22,
    marginBottom: 40,
  },
  buttons: {
    gap: 12,
  },
  primaryBtn: {
    height: 52,
    backgroundColor: C.accent,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
  secondaryBtn: {
    height: 52,
    backgroundColor: "transparent",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: C.textPrimary,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
