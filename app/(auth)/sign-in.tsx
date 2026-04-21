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
} from "react-native";
import { Link } from "expo-router";
import * as AppleAuthentication from "expo-apple-authentication";
import { useAuth } from "../../src/hooks/useAuth";

export default function SignIn() {
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
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.wordmark}>PACK</Text>
          <Text style={styles.tagline}>Compete with your crew</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#9CA3AF"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

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

        {/* Social auth divider */}
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
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
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
      </View>
    </KeyboardAvoidingView>
  );
}

// Google "G" logo using colored letters
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
  flex: { flex: 1 },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 28,
  },
  hero: {
    alignItems: "center",
    gap: 8,
  },
  wordmark: {
    fontSize: 42,
    fontWeight: "800",
    letterSpacing: 6,
    color: "#0F0F0F",
  },
  tagline: {
    fontSize: 16,
    color: "#9CA3AF",
  },
  form: {
    gap: 12,
  },
  input: {
    height: 52,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  button: {
    height: 52,
    backgroundColor: "#111827",
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
    backgroundColor: "#D1D5DB",
  },
  dividerText: {
    fontSize: 13,
    color: "#9CA3AF",
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
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
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
    color: "#DC2626",
    textAlign: "center",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  footerText: {
    fontSize: 15,
    color: "#6B7280",
  },
  footerLink: {
    fontSize: 15,
    fontWeight: "700",
    color: "#6366F1",
  },
});
