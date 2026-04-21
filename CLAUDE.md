# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start dev server (Expo Go compatible, but HealthKit won't work)
npx expo start

# Run on iOS simulator (requires Xcode)
npx expo start --ios

# Custom dev build required for HealthKit (react-native-health)
npx expo run:ios

# Run on Android
npx expo start --android

# Build for production via EAS
eas build --platform ios
```

There is no test suite or linter configured yet.

## Environment

Copy `.env` with these keys:
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

Supabase credentials are read in `src/lib/supabase.ts` via `expo-constants` (not `process.env` directly) because `app.config.ts` forwards them through `extra`.

## Architecture

**Stack:** Expo 54 / React Native 0.81 / TypeScript, Expo Router v6 (file-based routing), Zustand for global state, Supabase for auth + database, RevenueCat for subscriptions, PostHog for analytics.

**Routing layout:**
- `app/index.tsx` — auth gate: redirects to `/(app)/home` or `/(auth)/sign-in` based on Zustand auth state
- `app/(auth)/` — sign-in, sign-up screens (unauthenticated)
- `app/(app)/` — tab-based authenticated shell; custom `CustomTabBar` in `_layout.tsx` renders a center `+` button that opens `LogSheet` (manual activity logging)
- `app/(app)/pack/[id].tsx` — pack detail / leaderboard
- `app/join/[code].tsx` — deep-link invite flow via `packapp://join/<code>`

**Auth flow:** `app/_layout.tsx` subscribes to `supabase.auth.onAuthStateChange` and writes to `useAuthStore` (Zustand). `app/(app)/_layout.tsx` re-checks the store and redirects unauthenticated users. `useAuth` hook in `src/hooks/useAuth.ts` wraps sign-in/sign-up/sign-out and creates the `users` row on registration.

**Data layer:** All Supabase queries are co-located in hooks under `src/hooks/`. No ORM or query cache — hooks use `useState` + `useEffect` with a `refetch` callback pattern. Types in `src/types/database.ts` mirror the Supabase schema (regenerate with `npx supabase gen types typescript`).

**Scoring:** `src/lib/scoring.ts` is the single source of truth for point values and streak multipliers. The main sync path is `syncHealthDataToSupabase` in `src/lib/healthkit.ts`, which reads HealthKit, computes streak from past `daily_scores`, then upserts to `daily_scores` and `activity_logs`.

**HealthKit:** Only available in custom dev builds (`npx expo run:ios`), not Expo Go. All HealthKit calls are guarded by `nativeAvailable()` which checks both `Platform.OS === 'ios'` and that the native module is actually registered. `newArchEnabled` is intentionally `false` in `app.config.ts` until `react-native-screens` native binary is compatible.

**Packs model:** A `Pack` has configurable activity categories and targets. A `Run` is the active competition window (weekly/monthly) for a pack. `DailyScore` rows belong to a run + user + date — the leaderboard aggregates these.
