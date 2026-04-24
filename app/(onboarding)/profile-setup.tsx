import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  ActivityIndicator,
  ActionSheetIOS,
  Platform,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { useCurrentUser } from "../../src/context/CurrentUserContext";
import { useAuthStore } from "../../src/stores/authStore";
import { supabase } from "../../src/lib/supabase";
import {
  pickAvatarFromLibrary,
  takeAvatarPhoto,
  uploadAvatar,
} from "../../src/lib/photoUpload";
import { completeOnboarding } from "../../src/lib/onboarding";

const C = {
  bg: "#0B0F14",
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#E6EDF3",
  textSecondary: "#8B949E",
  textTertiary: "#484F58",
  accent: "#2F81F7",
} as const;

export default function ProfileSetup() {
  const router = useRouter();
  const { user: currentUser, applyLocal } = useCurrentUser();
  const authUser = useAuthStore((s) => s.user);

  const [nameInput, setNameInput] = useState(currentUser?.displayName ?? "");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [completing, setCompleting] = useState(false);

  const resolvedAvatar = currentUser?.avatarUrl;
  const initial = (nameInput.trim().charAt(0) || "?").toUpperCase();

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

  const handleAvatarPress = () => {
    if (!authUser?.id) return;

    const doUpload = async (picker: typeof pickAvatarFromLibrary) => {
      const photo = await picker();
      if (!photo) return;
      setAvatarUploading(true);
      try {
        const newUrl = await uploadAvatar(authUser.id, photo);
        await supabase.from("users").update({ avatar_url: newUrl }).eq("id", authUser.id);
        applyLocal({ avatarUrl: newUrl });
      } catch (e) {
        Alert.alert("Upload failed", (e as Error).message ?? "Please try again.");
      } finally {
        setAvatarUploading(false);
      }
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Take Photo", "Choose from Library", "Cancel"],
          cancelButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) doUpload(takeAvatarPhoto);
          else if (idx === 1) doUpload(pickAvatarFromLibrary);
        },
      );
    } else {
      Alert.alert("Upload photo", undefined, [
        { text: "Take Photo", onPress: () => doUpload(takeAvatarPhoto) },
        { text: "Choose from Library", onPress: () => doUpload(pickAvatarFromLibrary) },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const handleContinue = async () => {
    if (!authUser?.id || completing) return;
    setCompleting(true);

    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== currentUser?.displayName) {
      await supabase
        .from("users")
        .update({ display_name: trimmed })
        .eq("id", authUser.id);
      applyLocal({ displayName: trimmed });
    }

    setCompleting(false);
    router.push("/(onboarding)/integrations");
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <TouchableOpacity style={s.skipBtn} onPress={handleSkip} hitSlop={12}>
          <Text style={s.skipText}>Skip</Text>
        </TouchableOpacity>

        <Text style={s.header}>Make it yours</Text>
        <Text style={s.subtitle}>
          Your display name and photo are what your pack will see.
        </Text>

        <TouchableOpacity
          style={s.avatarWrap}
          onPress={handleAvatarPress}
          disabled={avatarUploading}
          activeOpacity={0.8}
        >
          {resolvedAvatar ? (
            <Image source={{ uri: resolvedAvatar }} style={s.avatarImage} />
          ) : (
            <View style={s.avatarPlaceholder}>
              <Text style={s.avatarInitial}>{initial}</Text>
            </View>
          )}
          {avatarUploading && (
            <View style={s.avatarOverlay}>
              <ActivityIndicator color="#FFF" />
            </View>
          )}
          <View style={s.avatarEditBadge}>
            <Text style={s.avatarEditText}>Edit</Text>
          </View>
        </TouchableOpacity>

        <TextInput
          style={s.nameInput}
          value={nameInput}
          onChangeText={(t) => setNameInput(t.slice(0, 30))}
          placeholder="Display name"
          placeholderTextColor={C.textTertiary}
          maxLength={30}
          autoCorrect={false}
        />

        <TouchableOpacity
          style={[s.primaryBtn, completing && s.primaryBtnDisabled]}
          onPress={handleContinue}
          disabled={completing}
          activeOpacity={0.85}
        >
          {completing ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={s.primaryBtnText}>Continue</Text>
          )}
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
    alignItems: "center",
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
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 36,
  },
  avatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 32,
    position: "relative",
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: C.surfaceRaised,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 36,
    fontWeight: "700",
    color: C.textPrimary,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 48,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarEditBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  avatarEditText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFF",
  },
  nameInput: {
    width: "100%",
    height: 52,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: C.textPrimary,
    marginBottom: 32,
  },
  primaryBtn: {
    width: "100%",
    height: 52,
    backgroundColor: C.accent,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
});
