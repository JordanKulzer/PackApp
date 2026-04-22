import { useState } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
} from "react-native";
import { Redirect, Tabs } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../src/stores/authStore";
import { LogSheet } from "../../src/components/LogSheet";

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
                  <Text style={styles.centerButtonText}>+</Text>
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

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
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
  centerButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1C2333",
    borderWidth: 1,
    borderColor: "#30363D",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Platform.OS === "ios" ? 8 : 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  centerButtonText: {
    fontSize: 35,
    fontWeight: "300",
    color: "#E6EDF3",
    lineHeight: 32,
  },
});
