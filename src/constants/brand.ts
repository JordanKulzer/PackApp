/**
 * Pack — Brand tokens
 * --------------------------------------------------------------------------
 * Single source of truth for visual design. Every brand component pulls from
 * here. Update a value once and it propagates everywhere.
 *
 * Path: constants/brand.ts
 * --------------------------------------------------------------------------
 */

export const BrandColors = {
  // Primary brand
  blue: '#3B82F6',
  blueDeep: '#2563EB',
  blueSoft: '#60A5FA',

  // Surfaces (dark mode default)
  background: '#0A0A0F',
  surface: '#14141C',
  surfaceElevated: '#1A1A24',

  // Text
  ink: '#E8EAF0',
  inkMuted: '#8A8FA3',
  inkDim: '#6B7280',

  // Borders
  border: 'rgba(255,255,255,0.05)',
  borderStrong: 'rgba(255,255,255,0.1)',

  // Semantic
  success: '#6EE7B7',
  warning: '#FBBF24',
  danger: '#F87171',

  // Brand gradient stops
  gradientStart: '#3B82F6',
  gradientEnd: '#2563EB',
} as const;

export const BrandRadii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  /** iOS app icon corner radius ratio: r = size * 0.21 */
  iconRatio: 0.21,
} as const;

export const BrandSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const BrandTypography = {
  // Font families — falls back to system fonts on iOS
  display: 'System', // Maps to SF Pro Display on iOS
  body: 'System',
  mono: 'Menlo',

  // Weights
  weightRegular: '400' as const,
  weightMedium: '500' as const,
  weightSemibold: '600' as const,
  weightBold: '700' as const,

  // Letter spacing for display sizes
  tightLetter: -0.5,
  normalLetter: 0,
} as const;

/** Convenience: linear gradient props for the brand tile */
export const BrandGradient = {
  colors: [BrandColors.gradientStart, BrandColors.gradientEnd] as [string, string],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};
