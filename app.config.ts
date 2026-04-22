import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  newArchEnabled: false,
  name: "Pack",
  slug: "pack-app",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  scheme: "packapp",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#000000",
  },
  ios: {
    bundleIdentifier: "com.jordankulzer.pack",
    supportsTablet: false,
    usesAppleSignIn: true,
    infoPlist: {
      NSHealthShareUsageDescription:
        "Pack reads your steps, workouts, and active calories to score your daily competition.",
      NSHealthUpdateUsageDescription:
        "Pack does not write data to Apple Health.",
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
  plugins: [
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
      "react-native-health",
      {
        isClinicalDataEnabled: false,
        healthSharePermission:
          "Pack reads your activity data from Apple Health to automatically sync steps, workouts, and calories with your pack.",
        healthUpdatePermission: "Pack does not write data to Apple Health.",
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
