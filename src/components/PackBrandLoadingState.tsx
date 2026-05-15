// Branded loading state for Home — a single Pack logo, centered, with a
// continuous breathing pulse (scale + opacity in sync). Replaces the
// Phase 1 (screen-level) and Phase 1.5 (per-card) skeletons: held until
// ALL Home data resolves (useUserPacks + every pack's fetchScores), then
// one clean swap to the full UI. Background stays transparent — the
// parent screen owns the bg color.

import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { PackLogo } from "./brand/PackLogo";

export function PackBrandLoadingState() {
  // Single shared 0 → 1 driver. Animated.loop snaps it back to 0 each
  // cycle; scale + opacity both interpolate [0, 0.5, 1] so the snap lands
  // on the resting value (scale 1.0 / opacity 1.0) and reads as seamless.
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(breath, {
        toValue: 1,
        duration: 1400, // one full breath: rest → peak → rest
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    );
    loop.start();
    // Stop the loop on unmount so no Animated timer orphans.
    return () => loop.stop();
  }, [breath]);

  const scale = breath.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.04, 1],
  });
  // Slight fade at the larger scale point — fully opaque at rest.
  const opacity = breath.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.85, 1],
  });

  return (
    <View style={styles.container}>
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <PackLogo size={128} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
});
