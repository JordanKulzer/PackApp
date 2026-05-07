import { useState, useEffect, useRef } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
  AppState,
} from "react-native";
import { Redirect, Tabs } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../src/stores/authStore";
import { LogSheet } from "../../src/components/LogSheet";
import { Toast } from "../../src/components/Toast";
import { rolloverExpiredRuns } from "../../src/lib/runRollover";
import { useCurrentUser } from "../../src/context/CurrentUserContext";

function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const [logSheetVisible, setLogSheetVisible] = useState(false);

  return (
    <>
      <View style={styles.tabBar}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

          // Skip any route that expo-router marks as href:null (tabBarButton suppressed)
          // except the water slot which we repurpose as the center + button
          if (
            route.name !== "home" &&
            route.name !== "water" &&
            route.name !== "profile"
          ) {
            return null;
          }

          // Center placeholder — renders the + button instead
          if (index === 1) {
            return (
              <View key="center" style={styles.centerSlot}>
                <TouchableOpacity
                  style={styles.centerButton}
                  onPress={() => setLogSheetVisible(true)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add" size={32} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            );
          }

          const label =
            typeof options.tabBarLabel === "string"
              ? options.tabBarLabel
              : (options.title ?? route.name);

          const iconName =
            route.name === "home"
              ? isFocused
                ? "home"
                : "home-outline"
              : isFocused
                ? "person"
                : "person-outline";

          const color = isFocused ? "#E6EDF3" : "#484F58";

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              style={styles.tabItem}
              onPress={onPress}
              activeOpacity={0.7}
            >
              <Ionicons name={iconName as any} size={24} color={color} />
              <Text style={[styles.tabLabel, { color }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <LogSheet
        visible={logSheetVisible}
        onClose={() => setLogSheetVisible(false)}
      />
    </>
  );
}

export default function AppLayout() {
  const session = useAuthStore((s) => s.session);
  const user = useAuthStore((s) => s.user);
  const { user: currentUser, loading: ctxLoading } = useCurrentUser();
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (!user?.id) return;

    // Run on mount (app open)
    rolloverExpiredRuns(user.id).catch((e) =>
      console.warn("[runRollover] launch:", e),
    );

    const sub = AppState.addEventListener("change", (next) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        rolloverExpiredRuns(user.id!).catch((e) =>
          console.warn("[runRollover] foreground:", e),
        );
      }
      appState.current = next;
    });

    return () => sub.remove();
  }, [user?.id]);

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (ctxLoading) {
    return null;
  }

  if (currentUser && !currentUser.hasCompletedOnboarding) {
    return <Redirect href="/(onboarding)/welcome" />;
  }

  return (
    <>
      <Tabs
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="home" options={{ title: "Home" }} />
        {/* Center slot — hidden from navigation, just a spacer for the tab bar */}
        <Tabs.Screen name="water" options={{ href: null, title: "" }} />
        <Tabs.Screen name="profile" options={{ title: "Profile" }} />
        <Tabs.Screen name="pack" options={{ href: null }} />
      </Tabs>
      <Toast />
    </>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#0B0F14",
    borderTopWidth: 0.5,
    borderTopColor: "#30363D",
    paddingBottom: Platform.OS === "ios" ? 28 : 8,
    paddingTop: 8,
    height: Platform.OS === "ios" ? 84 : 64,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  centerSlot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // Pass 16 — Primary-action treatment for the LogSheet trigger. Brand-blue
  // (#2F81F7) solid fill against the dark bar reads as "this is the primary
  // daily action" without the visual loudness of a lifted FAB. Icon is
  // Ionicons add at 32pt white for max contrast. Shadow opacity bumped 0.20
  // → 0.25 to compensate for the brighter fill against the dark bar.
  centerButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#2F81F7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Platform.OS === "ios" ? 8 : 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
});
