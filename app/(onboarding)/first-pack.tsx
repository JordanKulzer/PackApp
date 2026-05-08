import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { useCurrentUser } from "../../src/context/CurrentUserContext";
import { useAuthStore } from "../../src/stores/authStore";
import { completeOnboarding } from "../../src/lib/onboarding";
import { onboarding } from "../../src/constants/strings";
import { PackLogo } from "../../src/components/brand/PackLogo";
import { JoinPackModal } from "../../src/components/JoinPackModal";
import { BrandColors } from "../../src/constants/brand";

const C = {
  bg: "#0B0F14",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: "#2F81F7",
  border: "#30363D",
  surfaceRaised: "#1C2333",
} as const;

export default function FirstPack() {
  const router = useRouter();
  const { applyLocal } = useCurrentUser();
  const authUser = useAuthStore((s) => s.user);
  const [completing, setCompleting] = useState(false);
  const [joinModalVisible, setJoinModalVisible] = useState(false);

  // Last onboarding step — Skip bails directly to Home with no confirmation.
  // The user has already done meaningful setup (profile, categories, integrations);
  // a generic warning that references already-completed actions would be misleading.
  const handleSkip = async () => {
    if (!authUser?.id || completing) return;
    setCompleting(true);
    await completeOnboarding(authUser.id, "skip");
    applyLocal({ hasCompletedOnboarding: true });
    router.replace("/(app)/home");
  };

  const finish = async () => {
    if (!authUser?.id || completing) return;
    setCompleting(true);
    await completeOnboarding(authUser.id, "finish");
    applyLocal({ hasCompletedOnboarding: true });
  };

  const handleCreatePack = async () => {
    await finish();
    // Pass 24: build the back-stack as Home → create so Cancel/back from
    // create resolves to Home (not back into a completed-onboarding zombie
    // state). Replace onboarding root with Home, then push create on top
    // in the next frame so the replace commits before the push.
    router.replace("/(app)/home");
    requestAnimationFrame(() => router.push("/(app)/pack/create"));
  };

  // Pass 14 — Open the JoinPackModal in place rather than routing to Home
  // first. Onboarding is NOT marked complete on tap; cancel keeps the user
  // on first-pack with Create/Skip/Join still live. completeOnboarding fires
  // only from handleJoinSuccess once the modal reports a real join.
  const handleJoinWithCode = () => {
    if (completing) return;
    setJoinModalVisible(true);
  };

  // Fires when the modal successfully inserts the pack_member row. Matches
  // the create-pack commit-point semantics — onboarding 'finish' marks
  // a real onboarding completion, not just a button tap. Modal handles
  // its own analytics (pack_joined) and pushes (new_member); we just
  // close, complete onboarding, and route to the joined pack.
  const handleJoinSuccess = async (packId: string) => {
    if (!authUser?.id || completing) return;
    setCompleting(true);
    setJoinModalVisible(false);
    await completeOnboarding(authUser.id, "finish");
    applyLocal({ hasCompletedOnboarding: true });
    router.replace(`/(app)/pack/${packId}`);
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <TouchableOpacity style={s.skipBtn} onPress={handleSkip} hitSlop={12}>
          <Text style={s.skipText}>{onboarding.firstPack.lastStep.skip}</Text>
        </TouchableOpacity>

        <View style={s.illustration}>
          <PackLogo size={80} variant="mono" tint={BrandColors.blue} />
        </View>

        <Text style={s.header}>{onboarding.firstPack.lastStep.headline}</Text>
        <Text style={s.subtitle}>{onboarding.firstPack.lastStep.subhead}</Text>

        <View style={s.buttons}>
          <TouchableOpacity
            style={[s.primaryBtn, completing && s.btnDisabled]}
            onPress={handleCreatePack}
            disabled={completing}
            activeOpacity={0.85}
          >
            <Text style={s.primaryBtnText}>
              {onboarding.firstPack.lastStep.createCta}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.secondaryBtn, completing && s.btnDisabled]}
            onPress={handleJoinWithCode}
            disabled={completing}
            activeOpacity={0.85}
          >
            <Text style={s.secondaryBtnText}>
              {onboarding.firstPack.lastStep.joinCta}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <JoinPackModal
        visible={joinModalVisible}
        onClose={() => setJoinModalVisible(false)}
        onJoined={handleJoinSuccess}
      />
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
