import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  newArchEnabled: true,
  name: "Pack",
  slug: "pack-app",
  version: "1.0.3",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "automatic",
  scheme: "packapp",
  splash: {
    image: "./assets/images/splash.png",
    resizeMode: "contain",
    backgroundColor: "#000000",
  },
  ios: {
    bundleIdentifier: "com.jordankulzer.pack",
    supportsTablet: false,
    usesAppleSignIn: true,
    // ──────────────────────────────────────────────────────────────
    // ADDED: explicit icon path for iOS
    // (Optional — iOS falls back to the top-level icon if omitted, but
    // declaring it explicitly is clearer when adaptive android icon
    // also exists.)
    // ──────────────────────────────────────────────────────────────
    icon: "./assets/images/icon.png",
    infoPlist: {
      NSHealthShareUsageDescription:
        "Pack reads your steps, workouts, and active calories to score your daily competition.",
      NSHealthUpdateUsageDescription:
        "Pack writes water intake to Apple Health when you log it manually.",
      NSCameraUsageDescription:
        "Pack needs camera access so you can take photos to share with your pack.",
      NSPhotoLibraryUsageDescription:
        "Pack needs photo library access so you can select photos to share with your pack.",
      NSUserNotificationsUsageDescription:
        "Pack sends notifications when your pack members overtake you, react to your activity, or when your streak needs attention.",
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ["fetch", "remote-notification"],
    },
    entitlements: {
      "com.apple.developer.healthkit": true,
      "com.apple.developer.healthkit.access": [],
      "com.apple.developer.healthkit.background-delivery": true,
      "aps-environment": "production",
    },
  },
  // ──────────────────────────────────────────────────────────────
  // ADDED: Android adaptive icon block.
  // Add this only if you plan to publish to Android. Skip otherwise.
  // ──────────────────────────────────────────────────────────────
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#3B82F6",
    },
  },
  plugins: [
    "expo-build-properties",
    "expo-router",
    "expo-secure-store",
    "expo-apple-authentication",
    "expo-notifications",
    [
      "expo-image-picker",
      {
        photosPermission:
          "Pack needs photo library access so you can select photos to share with your pack.",
        cameraPermission:
          "Pack needs camera access so you can take photos to share with your pack.",
      },
    ],
    [
      "@kingstinct/react-native-healthkit",
      {
        NSHealthShareUsageDescription:
          "Pack reads your activity data from Apple Health to automatically sync steps, workouts, and calories with your pack.",
        NSHealthUpdateUsageDescription:
          "Pack writes water intake to Apple Health when you log it manually.",
        background: true,
      },
    ],
    [
      "@sentry/react-native/expo",
      {
        organization: "the-pack-app",
        project: "react-native",
      },
    ],
  ],
  extra: {
    ...config.extra,
    eas: {
      projectId: "f845a503-e45f-467c-8860-9eb36526e7cc",
    },
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
});
