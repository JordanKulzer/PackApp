import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
  SafeAreaView,
} from "react-native";
import { Link } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";
import { normalizeDisplayName } from "../../src/lib/displayName";
import { PackLogo } from "../../src/components/brand/PackLogo";
import { auth } from "../../src/constants/strings";
import { BrandColors, BrandTypography, BrandSpacing } from "../../src/constants/brand";

export default function SignUp() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tiny helper — every input's onChangeText clears the error on first keystroke
  // so a stale message doesn't linger while the user retries.
  const clearErrorOnInput = () => {
    if (error) setError(null);
  };

  const handleSignUp = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Please fill in all fields.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setIsLoading(true);
    try {
      // Display name collection is deferred to onboarding's profile-setup
      // screen (Pass 17 revision). Default to the email's local-part
      // normalized via Pass 15's normalizeDisplayName — gives a reasonable
      // first impression in the welcome greeting and pre-populates the
      // edit field at profile-setup. Users edit-or-accept there.
      const normalizedEmail = email.trim().toLowerCase();
      const defaultName = normalizeDisplayName(normalizedEmail.split("@")[0]);
      const result = await signUp(normalizedEmail, password, defaultName);
      if (result === "confirm_email") {
        // Informational success modal — user must check inbox before signing
        // in. Modal acknowledgement is appropriate here (different from error
        // surfaces, which are inline).
        Alert.alert(
          "Check your email",
          "We sent a confirmation link to " + normalizedEmail + ". Click it to activate your account, then sign in.",
        );
      }
      // "signed_in" case: onAuthStateChange fires → _layout.tsx nav effect redirects automatically
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.hero}>
          {/* Smaller icon than sign-in (80 → 48) — sign-up is form-focused;
              sign-in is brand-impression. Intentional divergence. */}
          <PackLogo size={48} />
          <Text style={styles.wordmark}>Pack</Text>
          <Text style={styles.tagline}>{auth.signUp.tagline}</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={BrandColors.inkMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              clearErrorOnInput();
            }}
          />
          <TextInput
            style={styles.input}
            placeholder="Password (8+ characters)"
            placeholderTextColor={BrandColors.inkMuted}
            secureTextEntry
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              clearErrorOnInput();
            }}
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm password"
            placeholderTextColor={BrandColors.inkMuted}
            secureTextEntry
            value={confirmPassword}
            onChangeText={(t) => {
              setConfirmPassword(t);
              clearErrorOnInput();
            }}
          />

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSignUp}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.buttonText}>Create Account</Text>
            )}
          </TouchableOpacity>

          {/* Inline error — covers email/password validation and sign-up failure.
              Apple/Google were removed in Pass 17 revision; will be re-added
              when providers are configured in Supabase. */}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/(auth)/sign-in" asChild>
            <TouchableOpacity>
              <Text style={styles.footerLink}>Sign In</Text>
            </TouchableOpacity>
          </Link>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // SafeAreaView wraps everything; flex:1 ensures full-screen + provides the
  // safe-area bottom inset that KeyboardAvoidingView needs to compute padding
  // correctly when the keyboard opens. Mirrors forgot-password.tsx.
  safe: { flex: 1, backgroundColor: BrandColors.background },
  flex: { flex: 1 },
  // Top-aligned content (Pass 17.5 fix). The previous flexGrow + justifyContent:
  // center combo conflicted with KAV's padding behavior — the form re-centered
  // within the shrunken viewport but only by half the keyboard height, leaving
  // the focused input under the keyboard. Top-aligning lets ScrollView scroll
  // naturally so the focused input always rises above the keyboard.
  container: {
    padding: 24,
    paddingBottom: 48,
    gap: 28,
  },
  hero: {
    alignItems: "center",
  },
  wordmark: {
    fontSize: 36,
    fontWeight: BrandTypography.weightBold,
    letterSpacing: BrandTypography.tightLetter,
    color: BrandColors.ink,
    marginTop: BrandSpacing.md,
    marginBottom: BrandSpacing.sm,
  },
  tagline: {
    fontSize: 15,
    color: BrandColors.inkMuted,
    textAlign: "center",
  },
  form: {
    gap: 12,
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: "#30363D",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: BrandColors.ink,
    backgroundColor: BrandColors.surface,
  },
  button: {
    height: 52,
    backgroundColor: BrandColors.blue,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "700",
  },
  errorText: {
    fontSize: 13,
    color: BrandColors.danger,
    textAlign: "center",
    marginTop: 4,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  footerText: {
    fontSize: 15,
    color: BrandColors.inkMuted,
  },
  footerLink: {
    fontSize: 15,
    fontWeight: "700",
    color: BrandColors.blue,
  },
});
