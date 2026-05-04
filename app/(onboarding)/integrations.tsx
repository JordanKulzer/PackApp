import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { useCurrentUser } from "../../src/context/CurrentUserContext";
import { useAuthStore } from "../../src/stores/authStore";
import { useHealthKit } from "../../src/hooks/useHealthKit";
import {
  AppleHealthIcon,
  OuraIcon,
  WhoopIcon,
} from "../../src/components/IntegrationIcons";
import { completeOnboarding } from "../../src/lib/onboarding";
import { onboarding } from "../../src/constants/strings";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: "#2F81F7",
  success: "#3FB950",
} as const;

export default function Integrations() {
  const router = useRouter();
  const { applyLocal } = useCurrentUser();
  const authUser = useAuthStore((s) => s.user);
  const { isAuthorized, requestPermissions } = useHealthKit(authUser?.id ?? null);
  const [hkRequesting, setHkRequesting] = useState(false);
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
            await completeOnboarding(authUser.id, "skip");
            applyLocal({ hasCompletedOnboarding: true });
            router.replace("/(app)/home");
          },
        },
      ],
    );
  };

  const handleConnectHealth = async () => {
    if (isAuthorized || hkRequesting) return;
    setHkRequesting(true);
    try {
      await requestPermissions();
    } finally {
      setHkRequesting(false);
    }
  };

  const handleContinue = () => {
    router.push("/(onboarding)/first-pack");
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <TouchableOpacity style={s.skipBtn} onPress={handleSkip} hitSlop={12}>
          <Text style={s.skipText}>Skip</Text>
        </TouchableOpacity>

        <Text style={s.header}>{onboarding.integrations.headline}</Text>
        <Text style={s.subtitle}>{onboarding.integrations.subhead}</Text>

        <View style={s.group}>
          {/* Apple Health */}
          <TouchableOpacity
            style={s.row}
            onPress={handleConnectHealth}
            activeOpacity={isAuthorized ? 1 : 0.7}
            disabled={hkRequesting || isAuthorized}
          >
            <AppleHealthIcon />
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>Apple Health</Text>
              <Text style={s.rowDesc}>Sync steps & workouts</Text>
            </View>
            {hkRequesting ? (
              <ActivityIndicator size="small" color={C.textSecondary} />
            ) : (
              <Text style={[s.rowValue, isAuthorized && s.rowValueSuccess]}>
                {isAuthorized ? "Connected" : "Connect"}
              </Text>
            )}
          </TouchableOpacity>

          <View style={s.divider} />

          {/* Oura Ring */}
          <View style={[s.row, s.rowDisabled]}>
            <OuraIcon />
            <View style={s.rowInfo}>
              <Text style={[s.rowLabel, s.rowLabelDisabled]}>Oura Ring</Text>
              <Text style={s.rowDesc}>Coming soon</Text>
            </View>
            <Text style={s.soonBadge}>Soon</Text>
          </View>

          <View style={s.divider} />

          {/* Whoop */}
          <View style={[s.row, s.rowDisabled]}>
            <WhoopIcon />
            <View style={s.rowInfo}>
              <Text style={[s.rowLabel, s.rowLabelDisabled]}>Whoop</Text>
              <Text style={s.rowDesc}>Coming soon</Text>
            </View>
            <Text style={s.soonBadge}>Soon</Text>
          </View>
        </View>

        <TouchableOpacity
          style={s.primaryBtn}
          onPress={handleContinue}
          activeOpacity={0.85}
        >
          <Text style={s.primaryBtnText}>Continue</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleContinue} hitSlop={8} style={s.skipLink}>
          <Text style={s.skipLinkText}>{onboarding.integrations.skipForNow}</Text>
        </TouchableOpacity>
        <Text style={s.skipHint}>{onboarding.integrations.skipHint}</Text>
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
    marginBottom: 32,
  },
  group: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: C.border,
    marginBottom: 32,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: C.textPrimary,
  },
  rowLabelDisabled: {
    color: C.textSecondary,
  },
  rowDesc: {
    fontSize: 12,
    color: C.textTertiary,
  },
  rowValue: {
    fontSize: 13,
    fontWeight: "600",
    color: C.accent,
  },
  rowValueSuccess: {
    color: C.success,
  },
  soonBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: C.textTertiary,
    backgroundColor: C.surfaceRaised,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginLeft: 54,
  },
  primaryBtn: {
    height: 52,
    backgroundColor: C.accent,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
  skipLink: {
    alignItems: "center",
  },
  skipLinkText: {
    fontSize: 14,
    color: C.textTertiary,
  },
  // Helper text below the skip link — preserves the "you can opt for
  // manual logging" affordance hint that the verbose version of skipForNow
  // used to carry inline.
  skipHint: {
    fontSize: 12,
    color: C.textTertiary,
    textAlign: "center",
    marginTop: 6,
    opacity: 0.75,
  },
});
