import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
} from "react-native";
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
} as const;

export default function Welcome() {
  const router = useRouter();
  const { user: currentUser, applyLocal } = useCurrentUser();
  const authUser = useAuthStore((s) => s.user);
  const [completing, setCompleting] = useState(false);

  const firstName = (currentUser?.displayName ?? "").split(" ")[0] || "there";

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

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <TouchableOpacity style={s.skipBtn} onPress={handleSkip} hitSlop={12}>
          <Text style={s.skipText}>Skip</Text>
        </TouchableOpacity>

        <View style={s.hero}>
          <Text style={s.wordmark}>PACK</Text>
          <Text style={s.greeting}>Welcome to Pack, {firstName}</Text>
        </View>

        <View style={s.body}>
          <Text style={s.bodyLine}>
            Compete with friends on steps, workouts, calories, and water.
          </Text>
          <Text style={s.bodyLine}>
            Weekly competitions. Streak multipliers for showing up.
          </Text>
          <Text style={s.bodyLine}>
            Let's get you set up — takes about 30 seconds.
          </Text>
        </View>

        <TouchableOpacity
          style={s.primaryBtn}
          onPress={() => router.push("/(onboarding)/profile-setup")}
          activeOpacity={0.85}
        >
          <Text style={s.primaryBtnText}>Continue</Text>
        </TouchableOpacity>
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
  hero: {
    alignItems: "center",
    marginBottom: 48,
    gap: 12,
  },
  wordmark: {
    fontSize: 48,
    fontWeight: "800",
    letterSpacing: 8,
    color: C.textPrimary,
  },
  greeting: {
    fontSize: 18,
    fontWeight: "600",
    color: C.textPrimary,
    textAlign: "center",
  },
  body: {
    gap: 14,
    marginBottom: 56,
  },
  bodyLine: {
    fontSize: 15,
    color: C.textSecondary,
    lineHeight: 22,
    textAlign: "center",
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
});
