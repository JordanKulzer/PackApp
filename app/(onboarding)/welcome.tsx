import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCurrentUser } from "../../src/context/CurrentUserContext";
import { useAuthStore } from "../../src/stores/authStore";
import { completeOnboarding, SIGNUP_STARTED_AT_KEY } from "../../src/lib/onboarding";
import { PackLogo } from "../../src/components/brand/PackLogo";
import { onboarding, t } from "../../src/constants/strings";
import { BrandColors } from "../../src/constants/brand";

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

  // Mark onboarding-flow start time on first mount of the welcome screen.
  // Read by completeOnboarding to compute onboarding_duration_sec. Idempotent —
  // if a stale key exists from a prior session that didn't complete, we
  // overwrite it (the most recent welcome view is the meaningful start).
  useEffect(() => {
    AsyncStorage.setItem(SIGNUP_STARTED_AT_KEY, String(Date.now())).catch(() => {});
  }, []);

  const handleSkip = () => {
    Alert.alert(
      "Skip setup?",
      "You can connect a tracker and start a pack later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Skip anyway",
          style: "destructive",
          onPress: async () => {
            if (!authUser?.id || completing) return;
            setCompleting(true);
            await completeOnboarding(authUser.id, "skip");
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
          <Text style={s.skipText}>{onboarding.welcome.skip}</Text>
        </TouchableOpacity>

        <View style={s.hero}>
          <PackLogo size={120} />
          <View style={s.heroText}>
            <Text style={s.greeting}>
              {t(onboarding.welcome.greeting, { firstName })}
            </Text>
            <Text style={s.headline}>{onboarding.welcome.headline}</Text>
          </View>
        </View>

        <Text style={s.subhead}>{onboarding.welcome.subhead}</Text>

        <TouchableOpacity
          style={s.primaryBtn}
          onPress={() => router.push("/(onboarding)/profile-setup")}
          activeOpacity={0.85}
        >
          <Text style={s.primaryBtnText}>{onboarding.welcome.cta}</Text>
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
  // Skip is an escape hatch for power users — present but visually quiet.
  // Smaller font + inkMuted + further into the corner per design feedback.
  skipBtn: {
    position: "absolute",
    top: 12,
    right: 16,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  skipText: {
    fontSize: 13,
    color: BrandColors.inkMuted,
  },
  hero: {
    alignItems: "center",
    marginBottom: 40,
    gap: 24,
  },
  heroText: {
    alignItems: "center",
    gap: 6,
  },
  // Greeting sits visually subordinate to the brand line: muted color,
  // smaller weight/size, so the two read as a single layered hero
  // rather than two competing headlines.
  greeting: {
    fontSize: 19,
    fontWeight: "500",
    color: BrandColors.inkMuted,
    textAlign: "center",
  },
  headline: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -0.5,
    color: BrandColors.ink,
    textAlign: "center",
  },
  subhead: {
    fontSize: 15,
    color: C.textSecondary,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 56,
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
