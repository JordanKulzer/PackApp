import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { supabase } from "../src/lib/supabase";
import { useAuthStore } from "../src/stores/authStore";
import { ensureUserProfile } from "../src/lib/ensureUserProfile";
import {
  initNotifications,
  addNotificationResponseListener,
} from "../src/lib/notifications";
import { initAnalytics } from "../src/lib/analytics";

initAnalytics();

export default function RootLayout() {
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
      if (session?.user) {
        ensureUserProfile(session.user.id, session.user);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (session?.user && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
        ensureUserProfile(session.user.id, session.user);
      }
      if (event === "SIGNED_IN") {
        initNotifications().catch(() => {});
      }
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link on notification tap — route to the relevant pack screen
  useEffect(() => {
    const sub = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const packId = data?.packId as string | undefined;
      if (packId) {
        router.push(`/(app)/pack/${packId}`);
      }
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigate based on session — fires whenever session or loading changes ─
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (session && inAuthGroup) {
      router.replace("/(app)/home");
    } else if (!session && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    }
  }, [session, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
