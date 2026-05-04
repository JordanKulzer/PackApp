// Pass 13 — Forgot-password request screen.
//
// User enters their email, we call supabase.auth.resetPasswordForEmail with
// redirectTo set to the deep-link target. Supabase sends an email with a
// link of the form `packapp://reset-password?token_hash=XYZ&type=recovery`
// (assuming the dashboard email template was edited per Pass 13 prerequisites).
//
// Manual prerequisites (must be done in Supabase dashboard before testing):
//   1. Authentication → URL Configuration → Site URL = packapp://
//   2. Authentication → URL Configuration → Redirect URLs includes
//      packapp://reset-password (or packapp://**)
//   3. Authentication → Email Templates → "Reset Password" template's link
//      changed from {{ .ConfirmationURL }} to:
//      {{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery
//
// Copy is PLACEHOLDER per Pass 13 scope. Future voice-review pass replaces
// strings under forgotPassword.* in src/constants/strings.ts.
import { useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { forgotPassword, t } from "../../src/constants/strings";
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

const REDIRECT_URL = "packapp://reset-password";

// Loose-but-defensive client-side email check — server will do the real
// validation. Just enough to catch obvious typos before the API call.
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!looksLikeEmail(trimmed)) {
      setError(forgotPassword.errors.invalidEmail);
      return;
    }
    setIsSubmitting(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        trimmed,
        { redirectTo: REDIRECT_URL },
      );
      if (resetError) {
        // Supabase rate-limits per-email; the canonical message contains
        // "rate limit" or has a 429 status. Surface a friendlier line.
        const msg = resetError.message?.toLowerCase() ?? "";
        if (msg.includes("rate") || resetError.status === 429) {
          setError(forgotPassword.errors.rateLimit);
        } else {
          setError(resetError.message || forgotPassword.errors.generic);
        }
        return;
      }
      setSubmittedEmail(trimmed);
    } catch {
      setError(forgotPassword.errors.network);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = () => {
    if (!submittedEmail) return;
    setSubmittedEmail(null);
    // Fall back into the form view; user taps Submit again to re-trigger.
    // Re-running handleSubmit directly would double-fire on rate-limited
    // accounts; making the user re-tap surfaces any new error cleanly.
  };

  // ── Success state ──────────────────────────────────────────────────────
  if (submittedEmail) {
    return (
      <SafeAreaView style={s.safe}>
        <ScrollView style={s.flex} contentContainerStyle={s.content}>
          <View style={s.headerRow}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
              <Ionicons name="chevron-back" size={28} color={C.textPrimary} />
            </TouchableOpacity>
            <View style={{ width: 28 }} />
          </View>
          <Text style={s.headline}>{forgotPassword.request.successHeadline}</Text>
          <Text style={s.body}>
            {t(forgotPassword.request.successBody, { email: submittedEmail })}
          </Text>
          <View style={s.successButtons}>
            <TouchableOpacity
              style={s.secondaryBtn}
              onPress={handleResend}
              activeOpacity={0.85}
            >
              <Text style={s.secondaryBtnText}>{forgotPassword.request.resend}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={() => router.replace("/(auth)/sign-in")}
              activeOpacity={0.85}
            >
              <Text style={s.primaryBtnText}>{forgotPassword.request.backToSignIn}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Request form ───────────────────────────────────────────────────────
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
          <View style={s.headerRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={12}
              disabled={isSubmitting}
            >
              <Ionicons
                name="chevron-back"
                size={28}
                color={isSubmitting ? C.textTertiary : C.textPrimary}
              />
            </TouchableOpacity>
            <View style={{ width: 28 }} />
          </View>

          <Text style={s.headline}>{forgotPassword.request.headline}</Text>
          <Text style={s.body}>{forgotPassword.request.body}</Text>

          <TextInput
            style={s.input}
            placeholder={forgotPassword.request.placeholder}
            placeholderTextColor={C.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
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
              <Text style={s.primaryBtnText}>{forgotPassword.request.submit}</Text>
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
  content: { padding: 24, paddingBottom: 48, gap: 16 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
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
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
  secondaryBtn: {
    height: 52,
    backgroundColor: "transparent",
    borderRadius: 12,
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
  successButtons: { gap: 12, marginTop: 24 },
  btnDisabled: { opacity: 0.6 },
});
