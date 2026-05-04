import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { analytics } from "./analytics";
import { getHealthKitAuthStatus } from "./healthkit";

// AsyncStorage key for the timestamp the welcome screen sets on first mount.
// Used to compute onboarding_duration_sec at signup_completed firing time.
export const SIGNUP_STARTED_AT_KEY = "pack:onboarding:signup_started_at";

// Centralized completion path — fires signup_completed exactly once across
// every onboarding-screen Skip and the final-step Finish. Five call sites
// share this funnel; instrumenting it here avoids scattering analytics
// calls across the onboarding screens.
//
// completedVia distinguishes finish-the-flow vs skip-out-early. signup_method
// captures the auth provider (email/apple/google). Both ride on the same event.
export async function completeOnboarding(
  userId: string,
  completedVia: "finish" | "skip",
): Promise<{ error: Error | null }> {
  // Property reads are best-effort. A failure on any of them shouldn't block
  // the user from completing onboarding — analytics is non-fatal.
  try {
    const [profileRes, sessionRes] = await Promise.all([
      supabase
        .from("users")
        .select("quick_select_categories")
        .eq("id", userId)
        .maybeSingle(),
      supabase.auth.getSession(),
    ]);

    const cats = (profileRes.data?.quick_select_categories ?? []) as unknown[];
    const provider = sessionRes.data.session?.user?.app_metadata?.provider as
      | string
      | undefined;
    const signupMethod: "email" | "apple" | "google" | "unknown" =
      provider === "apple" || provider === "google" || provider === "email"
        ? provider
        : "unknown";

    const startedAtRaw = await AsyncStorage.getItem(SIGNUP_STARTED_AT_KEY);
    const startedAt = startedAtRaw ? parseInt(startedAtRaw, 10) : 0;
    const onboardingDurationSec =
      startedAt > 0 ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;

    const enabledHealthkit = await getHealthKitAuthStatus().catch(() => false);

    analytics.signupCompleted({
      onboarding_duration_sec: onboardingDurationSec,
      signup_method: signupMethod,
      categories_selected_count: cats.length,
      enabled_healthkit: enabledHealthkit,
      completed_via: completedVia,
    });

    // Clear the start-time key so a second account on the same device doesn't
    // inherit a stale duration.
    AsyncStorage.removeItem(SIGNUP_STARTED_AT_KEY).catch(() => {});
  } catch {
    // Analytics is non-fatal — proceed to the DB update regardless.
  }

  const { error } = await supabase
    .from("users")
    .update({ has_completed_onboarding: true })
    .eq("id", userId);
  return { error: error as Error | null };
}
