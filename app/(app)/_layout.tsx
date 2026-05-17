import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
  AppState,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect, Tabs } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../src/stores/authStore";
import { LogSheet } from "../../src/components/LogSheet";
import { LogSheetCoachMark } from "../../src/components/LogSheetCoachMark";
import { Toast } from "../../src/components/Toast";
import { rolloverExpiredRuns } from "../../src/lib/runRollover";
import { useCurrentUser } from "../../src/context/CurrentUserContext";

const LOGSHEET_HINT_KEY = "pack:logsheet:hint:plus_button";

// Pass 24: routes that should suppress the tab bar entirely. Pack create is a
// focused-task screen — converting from modal to pushed lost the modal's
// natural tab-bar coverage, so we hide it here instead.
//
// Pass 26-followup: walked the matcher down to the leaf so it works
// regardless of how deep expo-router nests the active screen under the
// active tab. Single-level lookup missed pack/create (the screen lives
// inside a Stack inside the pack tab; a single nested.routes[idx] read
// resolves to the Stack route, not the leaf). The recursive findLeafName
// descends until there's no further nested state.
//
// Future maintainers: leaf-name match doesn't disambiguate routes that
// share a leaf basename (e.g., pack/[id] vs pack/edit/[id] — both leaf
// "[id]"). For Pass 26-followup we only suppress "create" which has a
// unique leaf; if the set grows to include shared basenames, switch to
// a path-based match (collect names while descending and join).
const TAB_BAR_HIDDEN_ROUTES = new Set<string>(["create"]);

interface NestableState {
  index: number;
  routes: {
    name: string;
    state?: NestableState;
    params?: Record<string, unknown>;
  }[];
}

// When a tab's nested stack hasn't been hydrated yet (e.g., first-time
// navigation to /pack/create from Home), route.state is absent and the
// target screen is encoded as route.params.screen instead. Without that
// fallback, this function returns the parent tab name ("pack") rather
// than the actual target screen ("create"), which breaks tab bar
// suppression for screens listed in TAB_BAR_HIDDEN_ROUTES.
function findLeafName(state: NestableState | undefined): string | undefined {
  if (!state) return undefined;
  const route = state.routes[state.index];
  if (!route) return undefined;
  if (route.state) return findLeafName(route.state);
  if (
    route.params &&
    typeof (route.params as { screen?: unknown }).screen === "string"
  ) {
    return (route.params as { screen: string }).screen;
  }
  return route.name;
}

function isTabBarHiddenRoute(state: BottomTabBarProps["state"]): boolean {
  const leaf = findLeafName(state as unknown as NestableState);
  return leaf ? TAB_BAR_HIDDEN_ROUTES.has(leaf) : false;
}

function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const [logSheetVisible, setLogSheetVisible] = useState(false);
  const [showPlusHint, setShowPlusHint] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(LOGSHEET_HINT_KEY).then((v) => {
      if (v !== "1") setShowPlusHint(true);
    });
  }, []);

  const dismissPlusHint = useCallback(() => {
    setShowPlusHint(false);
    AsyncStorage.setItem(LOGSHEET_HINT_KEY, "1").catch(() => {});
  }, []);

  if (isTabBarHiddenRoute(state)) return null;

  return (
    <>
      <View style={styles.coachMarkLayer} pointerEvents="box-none">
        <LogSheetCoachMark
          visible={showPlusHint}
          onDismiss={dismissPlusHint}
        />
      </View>
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
                  onPress={() => {
                    dismissPlusHint();
                    setLogSheetVisible(true);
                  }}
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
  // Coach-mark layer sits above the tab bar, anchored to the bottom so the
  // bubble's downward caret aligns over the center + button. `bottom` is
  // tab-bar height (84/64) + a small gap so the caret kisses the button's
  // top edge without overlapping it.
  coachMarkLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: Platform.OS === "ios" ? 92 : 72,
    alignItems: "center",
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
