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
  ScrollView,
  SafeAreaView,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";
import { PackLogo } from "../../src/components/brand/PackLogo";
import { auth, forgotPassword } from "../../src/constants/strings";
import { BrandColors, BrandTypography, BrandSpacing } from "../../src/constants/brand";

export default function SignIn() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setIsLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed. Please try again.");
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
          <PackLogo size={80} />
          <Text style={styles.wordmark}>Pack</Text>
          <Text style={styles.tagline}>{auth.signIn.tagline}</Text>
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
              if (error) setError(null);
            }}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={BrandColors.inkMuted}
            secureTextEntry
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (error) setError(null);
            }}
          />

          <TouchableOpacity
            style={styles.forgotLinkRow}
            onPress={() => router.push("/(auth)/forgot-password")}
            hitSlop={8}
          >
            <Text style={styles.forgotLink}>{forgotPassword.signInLink}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSignIn}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* Inline error — covers email/password validation and sign-in failure.
              Apple/Google were removed in Pass 17 revision; will be re-added when
              providers are configured in Supabase. */}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <Link href="/(auth)/sign-up" asChild>
            <TouchableOpacity>
              <Text style={styles.footerLink}>Sign Up</Text>
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
  // "Pack" wordmark below the 80pt logo. Logo (80) → wordmark (36 bold)
  // → tagline. Combined visual mass matches the prior 120pt logo alone.
  wordmark: {
    fontSize: 36,
    fontWeight: BrandTypography.weightBold,
    letterSpacing: BrandTypography.tightLetter,
    color: BrandColors.ink,
    marginTop: BrandSpacing.md,
    marginBottom: BrandSpacing.sm,
  },
  tagline: {
    fontSize: 16,
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
  forgotLinkRow: {
    alignSelf: "flex-end",
    marginTop: 4,
    paddingVertical: 4,
  },
  forgotLink: {
    fontSize: 14,
    fontWeight: "500",
    color: BrandColors.blue,
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
