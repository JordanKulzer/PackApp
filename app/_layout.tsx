import { useEffect } from "react";
import { Platform } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "../src/lib/supabase";
import { useAuthStore } from "../src/stores/authStore";
import { ensureUserProfile } from "../src/lib/ensureUserProfile";
import {
  initNotifications,
  addNotificationResponseListener,
} from "../src/lib/notifications";
import { initAnalytics, identify, reset } from "../src/lib/analytics";
import { CurrentUserProvider } from "../src/context/CurrentUserContext";
import { ModalMutationProvider } from "../src/context/ModalMutationContext";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { StatusBar } from "expo-status-bar";
import { BrandColors } from "../src/constants/brand";
import {
  configureBackgroundTypes,
  subscribeToChanges,
  UpdateFrequency,
} from "@kingstinct/react-native-healthkit";
import { BACKGROUND_TYPES, syncHealthDataForUser } from "../src/lib/healthkit";
import {
  initSentry,
  setSentryUser,
  wrap as sentryWrap,
} from "../src/lib/sentry";

// Sentry first so init failures elsewhere (analytics, etc.) get captured.
// Both inits are no-ops in DEV (Sentry: enabled: !__DEV__; PostHog: disabled: __DEV__).
initSentry();
initAnalytics();

function RootLayout() {
  const setSession = useAuthStore((s) => s.setSession);
  const setLoading = useAuthStore((s) => s.setLoading);
  const session = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);

  const router = useRouter();
  const segments = useSegments();

  // ── Single auth/session source of truth ──────────────────────────────────
  useEffect(() => {
    setLoading(true);
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSentryUser(session?.user?.id ?? null);
      // identify() fires only on SIGNED_IN below — initial session restoration
      // re-attaches user context for any events fired immediately after launch.
      if (session?.user) {
        identify(session.user.id);
        ensureUserProfile(session.user.id, session.user);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setSentryUser(session?.user?.id ?? null);
      if (
        session?.user &&
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")
      ) {
        ensureUserProfile(session.user.id, session.user);
      }
      // PostHog identify only on SIGNED_IN — repeat calls on TOKEN_REFRESHED
      // burn marginal SDK work for no benefit. reset() on sign-out so the
      // next anonymous session doesn't get linked to the prior user.
      if (event === "SIGNED_IN" && session?.user) {
        identify(session.user.id);
        initNotifications().catch((err) => {
          console.error("[notifications] init failed:", err);
        });
      }
      if (event === "SIGNED_OUT") {
        reset();
      }
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link on notification tap — route to the relevant pack screen
  useEffect(() => {
    const sub = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      const packId = data?.packId as string | undefined;
      if (packId) {
        router.push(`/(app)/pack/${packId}`);
      }
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Deep-link: Supabase password recovery (Pass 13 pivot) ────────────────
  //
  // Supabase's default password-recovery email template uses
  // {{ .ConfirmationURL }}, which routes users through Supabase's
  // /auth/v1/verify endpoint. After the token is verified server-side,
  // Supabase 302-redirects to:
  //   packapp://reset-password#access_token=...&refresh_token=...&type=recovery
  //
  // Tokens land in the URL FRAGMENT (after #), which Expo Router's auto
  // file-route mapping discards. So this is the first manual deep-link
  // handler in the codebase — we parse the fragment, set the session via
  // setSession, and navigate to the reset-password screen.
  //
  // Path-discriminator: we only act when the URL contains "type=recovery".
  // Other deep links (packapp://join/<code>) keep flowing through Expo
  // Router auto-routing untouched. Google OAuth's redirect is consumed
  // by WebBrowser.openAuthSessionAsync inside useAuth.ts and never
  // reaches Linking listeners, so this handler can't hijack it either.
  useEffect(() => {
    const handleUrl = (url: string) => {
      if (!url.includes("type=recovery")) return;

      const hashIdx = url.indexOf("#");
      if (hashIdx === -1) return;
      const params = new URLSearchParams(url.slice(hashIdx + 1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!accessToken || !refreshToken) return;

      // ╔═══════════════════════════════════════════════════════════════════╗
      // ║ CRITICAL: router.replace MUST come BEFORE setSession.            ║
      // ║                                                                   ║
      // ║ If reordered (await setSession; then router.replace):            ║
      // ║   1. setSession fires SIGNED_IN auth event                       ║
      // ║   2. Auth-gate below sees `session && inAuthGroup` on whatever   ║
      // ║      screen the deep link arrived on (sign-in, home, etc.)       ║
      // ║   3. Gate routes user to /(app)/home — the gate exemption only   ║
      // ║      protects /(auth)/reset-password, but we haven't navigated   ║
      // ║      there yet                                                    ║
      // ║   4. Deep link silently dies, user lands on home instead of      ║
      // ║      the reset-password screen                                    ║
      // ║                                                                   ║
      // ║ THIS order: navigate first (gate exemption protects us), then   ║
      // ║ setSession (SIGNED_IN fires while we're already on              ║
      // ║ reset-password — exempted, no bounce).                          ║
      // ║                                                                   ║
      // ║ DO NOT REORDER these even if it looks "cleaner" to await         ║
      // ║ setSession first. The race is real and silent.                   ║
      // ╚═══════════════════════════════════════════════════════════════════╝
      router.replace("/(auth)/reset-password");
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .catch((err) => {
          console.error("[reset-password] setSession failed:", err);
        });
    };

    // Cold-start case: app launched FROM the deep link. Defer one microtask
    // so Expo Router's route tree has mounted before we try to navigate.
    Linking.getInitialURL().then((url) => {
      if (!url) return;
      Promise.resolve().then(() => handleUrl(url));
    });

    // Warm case: app already running, link tapped from another app.
    const sub = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── HealthKit background delivery — Pass 6.5a ────────────────────────────
  //
  // Bootstrap iOS HealthKit background delivery. This writes the type list
  // to UserDefaults so kingstinct's BackgroundDeliveryManager can register
  // AppDelegate-level HKObserverQueries on every cold launch — surviving
  // app termination (NOT user-initiated force-quit; that's platform policy).
  //
  // ROLLOUT NOTE: existing users won't have observers registered until they
  // open the app at least once after this update. The AppDelegate reads
  // UserDefaults on launch; UserDefaults gets populated by this call. So
  // background sync reliability metrics during the rollout window will look
  // worse than steady state — by design, not a regression.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    configureBackgroundTypes(
      [...BACKGROUND_TYPES],
      UpdateFrequency.immediate,
    ).catch((err) =>
      console.warn("[HealthKit] configureBackgroundTypes failed:", err),
    );
  }, []);

  // JS-side observer subscriptions. When iOS wakes the app for an HK
  // background event (because of configureBackgroundTypes above), the JS
  // bridge boots, this effect runs, and pending change notifications get
  // delivered to the callback. The callback runs syncHealthDataForUser
  // which has its own 60s throttle to absorb bursty wake-ups.
  //
  // Gated on session.user.id — a signed-out user's observer wakeups would
  // burn 30s windows for no work. On sign-in the subscriptions register;
  // on sign-out they tear down.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const userId = session?.user?.id;
    if (!userId) return;

    const subs = BACKGROUND_TYPES.map((type) =>
      subscribeToChanges(type, async () => {
        try {
          await syncHealthDataForUser(userId);
        } catch (err) {
          console.warn("[HealthKit observer] sync failed:", err);
        }
      }),
    );

    return () => {
      subs.forEach((sub) => {
        try {
          sub?.remove();
        } catch {
          /* defensive — kingstinct may already have torn down */
        }
      });
    };
  }, [session?.user?.id]);

  // ── Navigate based on session — fires whenever session or loading changes ─
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    // Exempt /(auth)/reset-password from the signed-in bounce — the deep
    // link from a Supabase recovery email may arrive while a user is signed
    // into a different account. verifyOtp inside that screen will swap the
    // session to the recovery user; the gate must let that complete before
    // routing anywhere. (Cast: useSegments returns a typed tuple that the
    // checker narrows to length 1 for top-level routes; runtime is just an
    // array of route segments.)
    const segs = segments as string[];
    if (session && inAuthGroup && segs[1] !== "reset-password") {
      router.replace("/(app)/home");
    } else if (!session && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    }
  }, [session, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // backgroundColor on both GestureHandlerRootView and Stack.contentStyle
    // prevents white flashes during route transitions on iOS — without
    // these, the auth → home pipeline flashes the device default (white)
    // between screens.
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: BrandColors.background }}
    >
      <StatusBar style="light" />
      <KeyboardProvider>
        <BottomSheetModalProvider>
          <CurrentUserProvider>
            <ModalMutationProvider>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: BrandColors.background },
                }}
              >
                <Stack.Screen
                  name="paywall"
                  options={{ presentation: "modal", gestureEnabled: true }}
                />
                <Stack.Screen
                  name="user/[id]"
                  options={{ presentation: "modal", gestureEnabled: true }}
                />
              </Stack>
            </ModalMutationProvider>
          </CurrentUserProvider>
        </BottomSheetModalProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap enables touch-event breadcrumbs and an auto error boundary at
// the root. No additional ErrorBoundary components needed — auto-capture +
// this wrapper covers ~95% of cases.
export default sentryWrap(RootLayout);
