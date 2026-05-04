// Pass 13 pivot — Set-new-password screen (deep-link target).
//
// Reached via packapp://reset-password after the deep-link handler in
// app/_layout.tsx parses the URL fragment from a Supabase recovery email
// and calls supabase.auth.setSession({ access_token, refresh_token }).
//
// By the time this screen mounts, the session is already established.
// This screen's job is just:
//   1. Confirm a session exists (defensive guard for stale URLs / manual nav)
//   2. Render the new-password form
//   3. On submit: validate passwords + call supabase.auth.updateUser
//   4. Auth-state listener in app/_layout.tsx routes to /(app)/home on
//      SIGNED_IN/USER_UPDATED. router.replace below is belt-and-suspenders.
//
// The /(auth)/reset-password route is exempted from the navigation gate's
// signed-in bounce (app/_layout.tsx:171) so the screen stays mounted even
// after the deep-link handler swaps the session.
import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { useAuthStore } from "../../src/stores/authStore";
import { forgotPassword } from "../../src/constants/strings";
import { BrandColors } from "../../src/constants/brand";

const C = {
  bg: BrandColors.background,
  surface: BrandColors.surface,
  border: "#30363D",
  textPrimary: BrandColors.ink,
  textSecondary: BrandColors.inkMuted,
  textTertiary: "#484F58",
  accent: BrandColors.blue,
  danger: BrandColors.danger,
} as const;

const MIN_PASSWORD_LENGTH = 8;

type Phase = "ready" | "submitting";

export default function ResetPassword() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);

  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // TODO(security): handle the cross-account recovery race.
  //
  // If user is signed into account A and taps a recovery link for account B,
  // the session guard will see account A's truthy session at mount time and
  // render the form. Between mount and setSession's resolution (writing
  // account B's session), a fast user could submit a new password against
  // account A's session → wrong account modified.
  //
  // Mitigation requires explicit "recovery in progress" state coordinated
  // between the deep-link handler in _layout.tsx and this screen — likely
  // a module-level flag or auth-store boolean.
  //
  // Pre-existing across all deep-link-while-authenticated recovery flows.
  // Out of scope for the cold-start race fix; tracked as a separate audit.

  // Session guard — wait up to 2s for the deep-link handler's setSession
  // to land before redirecting to the request screen. The handler navigates
  // here BEFORE setSession (per the CRITICAL ordering in _layout.tsx), then
  // setSession resolves async (~200-500ms typical). Without the grace
  // window, this guard fires its redirect during cold-start mount — both
  // crashes Expo Router ("before mounting Root Layout") and yanks the user
  // off /(auth)/reset-password before SIGNED_IN fires, which then trips
  // the navigation gate into routing them to home with the recovery
  // session active. 2s is conservative; tunable if observed latency runs
  // faster.
  useEffect(() => {
    if (session) return;
    const timer = setTimeout(() => {
      router.replace("/(auth)/forgot-password");
    }, 2000);
    return () => clearTimeout(timer);
  }, [session, router]);

  const handleSubmit = async () => {
    setError(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(forgotPassword.errors.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(forgotPassword.errors.passwordsDoNotMatch);
      return;
    }
    setPhase("submitting");
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        setError(updateError.message || forgotPassword.errors.generic);
        setPhase("ready");
        return;
      }
      // Session updated. Auth-state listener in app/_layout.tsx will route
      // to /(app)/home on USER_UPDATED; this is belt-and-suspenders.
      router.replace("/(app)/home");
    } catch {
      setError(forgotPassword.errors.network);
      setPhase("ready");
    }
  };

  // While !session (waiting for deep-link handler's setSession to land, or
  // about to redirect to forgot-password), render a minimal spinner — never
  // the form. Otherwise users could type into the password fields and submit
  // before setSession resolves, calling updateUser without an active session.
  if (!session) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator color={C.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const isSubmitting = phase === "submitting";
  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={s.flex}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.headline}>{forgotPassword.reset.headline}</Text>
          <Text style={s.body}>{forgotPassword.reset.body}</Text>

          <TextInput
            style={s.input}
            placeholder={forgotPassword.reset.newPasswordPlaceholder}
            placeholderTextColor={C.textSecondary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={newPassword}
            onChangeText={setNewPassword}
            editable={!isSubmitting}
          />

          <TextInput
            style={s.input}
            placeholder={forgotPassword.reset.confirmPasswordPlaceholder}
            placeholderTextColor={C.textSecondary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            editable={!isSubmitting}
          />

          {error && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[s.primaryBtn, isSubmitting && s.btnDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            activeOpacity={0.85}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={s.primaryBtnText}>{forgotPassword.reset.submit}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  content: { padding: 24, paddingBottom: 48, gap: 16, paddingTop: 48 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 24,
  },
  headline: {
    fontSize: 28,
    fontWeight: "700",
    color: C.textPrimary,
    letterSpacing: -0.5,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: C.textSecondary,
    marginBottom: 8,
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: C.textPrimary,
    backgroundColor: C.surface,
  },
  errorText: {
    fontSize: 13,
    color: C.danger,
  },
  primaryBtn: {
    height: 52,
    backgroundColor: C.accent,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    paddingHorizontal: 24,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
  btnDisabled: { opacity: 0.6 },
});
