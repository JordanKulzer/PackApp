import { Stack } from "expo-router";

// Modal-presented screens (edit/[id]) MUST use router.dismiss() (not router.back())
// to close. router.back() leaves the modal mounted in the navigation state, which
// corrupts subsequent navigations — the next screen pushed inherits the modal
// presentation context and renders as a bottom sheet instead of full-screen.
//
// Pass 24: `create` was previously modal-presented but suffered a stack-corruption
// bug when entered from onboarding's router.replace path. Converted to a regular
// pushed screen — Cancel resolves to router.back(), tab bar suppressed by
// CustomTabBar route detection.
export default function PackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="edit/[id]" options={{ presentation: "modal" }} />
    </Stack>
  );
}
