import { Stack } from "expo-router";

// Modal-presented screens MUST use router.dismiss() (not router.back()) to close.
// router.back() leaves the modal mounted in the navigation state, which corrupts
// subsequent navigations — the next screen pushed inherits the modal presentation
// context and renders as a bottom sheet instead of full-screen.
export default function PackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="create" options={{ presentation: "modal" }} />
    </Stack>
  );
}
