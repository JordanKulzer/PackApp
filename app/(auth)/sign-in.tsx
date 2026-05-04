import { useState, useEffect } from "react";
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
} from "react-native";
import { Link, useRouter } from "expo-router";
import * as AppleAuthentication from "expo-apple-authentication";
import { useAuth } from "../../src/hooks/useAuth";
import { PackLogo } from "../../src/components/brand/PackLogo";
import { auth, forgotPassword } from "../../src/constants/strings";
import { BrandColors, BrandTypography, BrandSpacing } from "../../src/constants/brand";

export default function SignIn() {
  const router = useRouter();
  const { signIn, signInWithApple, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<"apple" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
  }, []);

  const handleSignIn = async () => {
    setError(null);
    if (!email.trim() || !password) {
      Alert.alert("Missing fields", "Please enter your email and password.");
      return;
    }
    setIsLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
    } catch (err) {
      Alert.alert(
        "Sign in failed",
        err instanceof Error ? err.message : "Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleApple = async () => {
    setError(null);
    setSocialLoading("apple");
    try {
      await signInWithApple();
    } catch (err: unknown) {
      // ERR_CANCELED = user dismissed the sheet — not an error worth showing
      if ((err as { code?: string }).code === "ERR_CANCELED") return;
      setError(err instanceof Error ? err.message : "Apple sign-in failed. Please try again.");
    } finally {
      setSocialLoading(null);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setSocialLoading("google");
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed. Please try again.");
    } finally {
      setSocialLoading(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
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
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={BrandColors.inkMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
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
        </View>

        {/* Social auth divider — flanking lines on either side of "or" */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Social buttons */}
        <View style={styles.socialGroup}>
          {appleAvailable && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={12}
              style={styles.appleBtn}
              onPress={handleApple}
            />
          )}

          <TouchableOpacity
            style={[styles.googleBtn, socialLoading === "google" && styles.buttonDisabled]}
            onPress={handleGoogle}
            disabled={!!socialLoading}
            activeOpacity={0.85}
          >
            {socialLoading === "google" ? (
              <ActivityIndicator color="#1F1F1F" />
            ) : (
              <View style={styles.googleBtnInner}>
                <GoogleG />
                <Text style={styles.googleBtnText}>Continue with Google</Text>
              </View>
            )}
          </TouchableOpacity>

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
  );
}

// Google "G" logo using colored letters — Google brand requirement.
function GoogleG() {
  return (
    <View style={g.wrapper}>
      <Text style={[g.letter, { color: "#4285F4" }]}>G</Text>
      <Text style={[g.letter, { color: "#EA4335" }]}>o</Text>
      <Text style={[g.letter, { color: "#FBBC05" }]}>o</Text>
      <Text style={[g.letter, { color: "#4285F4" }]}>g</Text>
      <Text style={[g.letter, { color: "#34A853" }]}>l</Text>
      <Text style={[g.letter, { color: "#EA4335" }]}>e</Text>
    </View>
  );
}

const g = StyleSheet.create({
  wrapper: { flexDirection: "row", marginRight: 8 },
  letter: { fontSize: 15, fontWeight: "700" },
});

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: BrandColors.background },
  // contentContainerStyle on the ScrollView — flexGrow:1 lets the content
  // fill available height when short, justifyContent:center keeps the form
  // visually centered when no keyboard is present, and the ScrollView's
  // overflow handles the keyboard-up case without pushing the logo into
  // the status bar.
  container: {
    flexGrow: 1,
    padding: 24,
    justifyContent: "center",
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
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#30363D",
  },
  dividerText: {
    fontSize: 13,
    color: BrandColors.inkMuted,
    fontWeight: "500",
  },
  socialGroup: {
    gap: 12,
  },
  appleBtn: {
    height: 52,
    width: "100%",
  },
  googleBtn: {
    height: 52,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#30363D",
    alignItems: "center",
    justifyContent: "center",
  },
  googleBtnInner: {
    flexDirection: "row",
    alignItems: "center",
  },
  googleBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1F1F1F",
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
