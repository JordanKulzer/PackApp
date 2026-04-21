import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/authStore";

// Auth state is owned by the root _layout.tsx (getSession + onAuthStateChange).
// This hook only reads from the store and provides action functions.
// Do NOT add a second onAuthStateChange subscription here.

export type SignUpResult = "signed_in" | "confirm_email";

// Fallback chain: full_name → name → identity full_name → email prefix → "User"
export function resolveDisplayName(user: User): string {
  const meta = user.user_metadata ?? {};
  if (meta.full_name && meta.full_name !== "") return meta.full_name as string;
  if (meta.name && meta.name !== "") return meta.name as string;
  const identityName = user.identities?.[0]?.identity_data?.full_name;
  if (identityName && identityName !== "") return identityName as string;
  if (user.email) {
    const prefix = user.email.split("@")[0];
    return prefix.charAt(0).toUpperCase() + prefix.slice(1);
  }
  return "User";
}

// Upsert the users row after social sign-in.
// Inserts on first sign-in; updates display_name only if still null or "User".
async function upsertSocialProfile(user: User, resolvedName: string) {
  const { data: existing } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    await supabase.from("users").insert({
      id: user.id,
      display_name: resolvedName,
      healthkit_authorized: false,
      subscription_tier: "free",
    });
  } else if (!existing.display_name || existing.display_name === "User") {
    await supabase
      .from("users")
      .update({ display_name: resolvedName })
      .eq("id", user.id);
  }
}

export function useAuth() {
  const { session, user, isLoading } = useAuthStore();

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // onAuthStateChange in _layout.tsx fires → setSession → navigation effect redirects
  };

  const signUp = async (
    email: string,
    password: string,
    displayName: string,
  ): Promise<SignUpResult> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw error;

    if (data.user) {
      const { error: profileError } = await supabase.from("users").upsert(
        {
          id: data.user.id,
          display_name: displayName,
          healthkit_authorized: false,
          subscription_tier: "free",
        },
        { onConflict: "id" },
      );
      if (profileError) {
        console.error("[signUp] users profile upsert failed:", profileError);
      }
    }

    // If a session came back, email confirmation is off — onAuthStateChange will
    // fire SIGNED_IN and the navigation effect in _layout.tsx will redirect.
    // If no session, Supabase requires email confirmation before sign-in.
    return data.session ? "signed_in" : "confirm_email";
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    // onAuthStateChange fires → setSession(null) → navigation effect redirects to sign-in
  };

  const signInWithApple = async () => {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) throw new Error("No identity token from Apple");

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
    });
    if (error) throw error;
    if (!data.user) throw new Error("No user returned from Apple sign-in");

    // Apple only provides fullName on the very first sign-in
    const givenName = credential.fullName?.givenName ?? "";
    const familyName = credential.fullName?.familyName ?? "";
    const appleFullName = [givenName, familyName].filter(Boolean).join(" ");
    const resolvedName = appleFullName || resolveDisplayName(data.user);
    await upsertSocialProfile(data.user, resolvedName);
    // onAuthStateChange in _layout.tsx fires and redirects
  };

  const signInWithGoogle = async () => {
    const redirectUrl = Linking.createURL("/");
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data.url) throw new Error("No OAuth URL returned");

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
    if (result.type !== "success") return; // user cancelled — not an error

    // Parse tokens from the redirect fragment
    const fragment = result.url.includes("#") ? result.url.split("#")[1] : "";
    const params = new URLSearchParams(fragment);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (!accessToken || !refreshToken) {
      throw new Error("OAuth redirect did not include session tokens");
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) throw sessionError;
    if (!sessionData.user) throw new Error("No user in session after Google sign-in");

    const resolvedName = resolveDisplayName(sessionData.user);
    await upsertSocialProfile(sessionData.user, resolvedName);
    // onAuthStateChange fires and redirects
  };

  return { session, user, isLoading, signIn, signUp, signOut, signInWithApple, signInWithGoogle };
}
