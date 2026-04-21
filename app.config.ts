import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  newArchEnabled: false, // enable only in custom dev builds once RN screens native binary matches
  name: "Pack",
  slug: "pack-app",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#000000",
  },
  ios: {
    bundleIdentifier: "com.packapp.pack",
    buildNumber: "1",
    supportsTablet: false,
    usesAppleSignIn: true,
    infoPlist: {
      NSHealthShareUsageDescription:
        "Pack reads your steps, workouts, and active calories to score your daily competition.",
      NSHealthUpdateUsageDescription:
        "Pack writes your water intake to Apple Health.",
      UIBackgroundModes: ["fetch", "remote-notification"],
    },
    entitlements: {
      "com.apple.developer.healthkit": true,
      "com.apple.developer.healthkit.background-delivery": true,
    },
  },
  plugins: [
    "expo-router",
    "expo-apple-authentication",
    "expo-notifications",
    [
      "react-native-health",
      {
        isClinicalDataEnabled: false,
      },
    ],
  ],
  scheme: "packapp",
  extra: {
    eas: {
      projectId: "f845a503-e45f-467c-8860-9eb36526e7cc",
    },
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
});
