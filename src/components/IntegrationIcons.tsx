import React from "react";
import Svg, { Path, Circle, Polyline } from "react-native-svg";

const SIZE = 24;

// Apple Health — heart shape, Apple Health brand red (#FF375F).
// Follows HealthKit branding guidelines: heart icon used to represent Health data.
export function AppleHealthIcon({ size = SIZE, color = "#FF375F" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 21.2C6.4 15.7 1 11 1 7.1 1 3.3 4 2 6.3 2c1.3 0 3.9.6 5.7 4.2C13.8 2.6 16.4 2 17.7 2 20 2 23 3.3 23 7.1c0 3.9-5.4 8.6-11 14.1z"
        fill={color}
      />
    </Svg>
  );
}

// Oura Ring — bold ring outline.
// Oura's brand mark is a circular "O" ring shape, used here in monochrome.
export function OuraIcon({ size = SIZE, color = "#8B949E" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle
        cx="12"
        cy="12"
        r="8.5"
        stroke={color}
        strokeWidth="2.5"
        fill="none"
      />
    </Svg>
  );
}

// Whoop — stylised W mark.
// Drawn as a clean V-shape pair matching Whoop's angular wordmark style.
export function WhoopIcon({ size = SIZE, color = "#8B949E" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polyline
        points="2,5 6.5,19 12,10 17.5,19 22,5"
        stroke={color}
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
