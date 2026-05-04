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
} from "react-native";
import { Link } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";
import { normalizeDisplayName } from "../../src/lib/displayName";
import { PackLogo } from "../../src/components/brand/PackLogo";
import { auth } from "../../src/constants/strings";
import { BrandColors, BrandTypography, BrandSpacing } from "../../src/constants/brand";

export default function SignUp() {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSignUp = async () => {
    if (!displayName.trim() || !email.trim() || !password) {
      Alert.alert("Missing fields", "Please fill in all fields.");
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert("Password mismatch", "Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Weak password", "Password must be at least 8 characters.");
      return;
    }
    setIsLoading(true);
    try {
      const result = await signUp(email.trim().toLowerCase(), password, normalizeDisplayName(displayName));
      if (result === "confirm_email") {
        Alert.alert(
          "Check your email",
          "We sent a confirmation link to " + email.trim().toLowerCase() + ". Click it to activate your account, then sign in.",
        );
      }
      // "signed_in" case: onAuthStateChange fires → _layout.tsx nav effect redirects automatically
    } catch (err) {
      Alert.alert(
        "Sign up failed",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setIsLoading(false);
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
          <Text style={styles.tagline}>{auth.signUp.tagline}</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Display name"
            placeholderTextColor={BrandColors.inkMuted}
            autoCapitalize="words"
            autoCorrect={false}
            value={displayName}
            onChangeText={setDisplayName}
          />
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
            placeholder="Password (8+ characters)"
            placeholderTextColor={BrandColors.inkMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm password"
            placeholderTextColor={BrandColors.inkMuted}
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
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
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: BrandColors.background },
  container: {
    padding: 24,
    justifyContent: "center",
    flexGrow: 1,
    gap: 32,
  },
  hero: {
    alignItems: "center",
  },
  // "Pack" wordmark below the 80pt logo — same lockup as sign-in.
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
