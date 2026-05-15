// Skeleton loading primitive — a base fill with a shimmer band that sweeps
// left→right via translateX (native-driver compatible). Reusable across
// skeleton surfaces; first consumer is SkeletonPackCard (Home pack grid).
//
// Colors: base #1C2333 (C.surfaceRaised — one step lighter than the
// C.surface #121821 card background, so a placeholder reads as "content
// pending"). There's no shared card-metrics module today — these mirror
// app/(app)/home.tsx's `C` palette.

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const BASE_FILL = "#1C2333";
const SHIMMER_BAND = "rgba(255,255,255,0.06)";
const CYCLE_MS = 1200;
const BAND_FRACTION = 0.4; // band is ~40% of the box width

interface SkeletonBoxProps {
  width?: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonBox({
  width = "100%",
  height,
  borderRadius = 8,
  style,
}: SkeletonBoxProps) {
  // Measured pixel width drives the translateX range. `width` may be a "%"
  // string, so we can't compute the sweep distance up front — until the
  // first onLayout fires we render the base fill only (no band).
  const [boxWidth, setBoxWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (boxWidth === 0) return;
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: CYCLE_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    // Stop the loop on unmount (or re-measure) so no Animated timer orphans.
    return () => loop.stop();
  }, [boxWidth, progress]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== boxWidth) setBoxWidth(w);
  };

  // Sweep the band from fully off the left edge to fully off the right edge.
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-boxWidth, boxWidth],
  });

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.box,
        { width, height, borderRadius, backgroundColor: BASE_FILL },
        style,
      ]}
    >
      {boxWidth > 0 && (
        <Animated.View
          style={[
            styles.band,
            {
              width: Math.max(1, boxWidth * BAND_FRACTION),
              backgroundColor: SHIMMER_BAND,
              transform: [{ translateX }],
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    overflow: "hidden", // clip the band to the rounded rect
  },
  band: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },
});
