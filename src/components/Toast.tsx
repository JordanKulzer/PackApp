import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { subscribeToToast, ToastOptions } from "../lib/toast";

const KIND_COLORS = {
  success: "#3FB950",
  info: "#58A6FF",
  error: "#F85149",
} as const;

export function Toast() {
  const { bottom } = useSafeAreaInsets();
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<ToastOptions["kind"]>("success");
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return subscribeToToast(({ message: msg, kind: k = "success" }) => {
      if (timer.current) clearTimeout(timer.current);

      setMessage(msg);
      setKind(k);

      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.delay(2100),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      timer.current = setTimeout(() => setMessage(""), 2600);
    });
  }, [opacity]);

  if (!message) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { bottom: bottom + 80, opacity },
        { borderLeftColor: KIND_COLORS[kind ?? "success"] },
      ]}
      pointerEvents="none"
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: "#1C2333",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderLeftWidth: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
    maxWidth: 320,
    zIndex: 9999,
  },
  text: {
    fontSize: 14,
    fontWeight: "600",
    color: "#E6EDF3",
  },
});
