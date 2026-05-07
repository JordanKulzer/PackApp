import { Stack } from "expo-router";
import { BrandColors } from "../../src/constants/brand";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Match the dark backdrop child screens render — prevents a one-frame
        // white flash during slide_from_right transitions on iOS.
        contentStyle: { backgroundColor: BrandColors.background },
        animation: "slide_from_right",
      }}
    />
  );
}
