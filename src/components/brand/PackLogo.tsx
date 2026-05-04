/**
 * Pack — Logo component
 * --------------------------------------------------------------------------
 * The empty-ring mark + wordmark lockup.
 *
 * Path: components/brand/PackLogo.tsx
 *
 * Requires: react-native-svg, expo-linear-gradient
 *   npx expo install react-native-svg expo-linear-gradient
 *
 * Usage:
 *   <PackLogo size={120} />                   // hero
 *   <PackLogo size={28} />                    // nav
 *   <PackLogo size={40} variant="mono" tint="white" />
 *   <PackWordmark iconSize={28} />
 * --------------------------------------------------------------------------
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { BrandColors, BrandTypography } from '../../constants/brand';

type PackLogoVariant = 'tile' | 'mono';

interface PackLogoProps {
  /** Pixel size (square). Default: 56 */
  size?: number;
  /**
   * tile = on the brand gradient rounded square (default — use almost everywhere)
   * mono = no tile, just the rings — for placement on existing colored surfaces
   */
  variant?: PackLogoVariant;
  /**
   * For mono variant: ring + center color. Defaults to white.
   * Ignored for tile variant (always white on brand gradient).
   */
  tint?: string;
  /** Override the corner radius of the gradient tile. Default: size * 0.21 (iOS app-icon ratio) */
  cornerRadius?: number;
}

export function PackLogo({
  size = 56,
  variant = 'tile',
  tint = 'white',
  cornerRadius,
}: PackLogoProps) {
  const showTile = variant === 'tile';
  const ringColor = showTile ? 'white' : tint;

  // Stroke widths scale with viewBox (140). Slightly thicker at small sizes
  // to prevent sub-pixel rendering issues.
  const outerStroke = size <= 32 ? 4.5 : size <= 56 ? 4 : 3.5;
  const middleStroke = size <= 32 ? 5 : size <= 56 ? 4.5 : 4;

  return (
    <Svg width={size} height={size} viewBox="0 0 140 140">
      <Defs>
        <LinearGradient id="packGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor={BrandColors.gradientStart} />
          <Stop offset="100%" stopColor={BrandColors.gradientEnd} />
        </LinearGradient>
      </Defs>

      {showTile && (
        <Rect
          x="0"
          y="0"
          width="140"
          height="140"
          rx={(cornerRadius ?? size * 0.21) * (140 / size)}
          ry={(cornerRadius ?? size * 0.21) * (140 / size)}
          fill="url(#packGrad)"
        />
      )}

      {/* Outer ring — 3/4 arc, opens at top-right (the "empty" gap) */}
      <Path
        d="M 70 20 A 50 50 0 1 0 120 70"
        stroke={ringColor}
        strokeWidth={outerStroke}
        strokeOpacity={0.55}
        strokeLinecap="round"
        fill="none"
      />

      {/* Middle ring — solid */}
      <Circle
        cx="70"
        cy="70"
        r="32"
        stroke={ringColor}
        strokeWidth={middleStroke}
        strokeOpacity={0.85}
        fill="none"
      />

      {/* Center dot */}
      <Circle cx="70" cy="70" r="13" fill={ringColor} />
    </Svg>
  );
}

/* --------------------------------------------------------------------------
 * Wordmark — icon + "Pack" lockup
 * -------------------------------------------------------------------------- */

interface PackWordmarkProps {
  /** Icon height. Text scales relative to this. Default: 32 */
  iconSize?: number;
  /** Text color. Default: ink */
  color?: string;
  /** Mark variant. Default: tile */
  variant?: PackLogoVariant;
  style?: ViewStyle;
}

export function PackWordmark({
  iconSize = 32,
  color = BrandColors.ink,
  variant = 'tile',
  style,
}: PackWordmarkProps) {
  return (
    <View style={[styles.row, { gap: iconSize * 0.4 }, style]}>
      <PackLogo size={iconSize} variant={variant} />
      <Text
        style={[
          styles.text,
          {
            color,
            fontSize: iconSize * 0.85,
            lineHeight: iconSize * 0.95,
          },
        ]}
      >
        Pack
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontWeight: BrandTypography.weightBold,
    letterSpacing: BrandTypography.tightLetter,
  },
});
