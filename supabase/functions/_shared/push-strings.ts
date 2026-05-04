// Push notification copy generators — Deno mirror.
//
// SINGLE SOURCE OF TRUTH lives in src/constants/strings.ts (the `push` export).
// This file is the Deno duplicate used by the notify-pack-event Edge Function,
// which cannot import the React Native strings module directly because of
// runtime + module-resolution mismatches.
//
// KEEP IN SYNC. When you add or change a generator in src/constants/strings.ts
// push.*, mirror it here. Both files together form the contract; drift
// between them is a real bug class.

export interface PushPayload {
  title: string;
  body: string;
}

export const push = {
  newMemberJoined: (name: string, packName: string): PushPayload => ({
    title: "New blood in the pack",
    body: `${name} joined ${packName}.`,
  }),

  // Mirrored for symmetry — currently unused by the Edge Function (achievement
  // unlocks fire as local notifications client-side via achievements.ts).
  // Kept here so when future server-side achievement triggers land, the
  // generator is a one-line import away.
  achievementUnlocked: (
    achievementName: string,
    copy: string,
  ): PushPayload => ({
    title: `${achievementName} unlocked`,
    body: copy,
  }),
};
