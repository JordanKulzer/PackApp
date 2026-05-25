// Per-pack, per-device tracker for the "show recap once per new run"
// trigger. The trigger lives in app/(app)/pack/[id].tsx and uses these
// helpers to remember which run id this device last saw for each pack;
// when the active run id differs from the stored value, the rollover
// recap fires once.
//
// Mirrors the AsyncStorage pattern at src/lib/dailyWinners.ts (per-pack
// key prefix + namespace) and src/components/HomeAchievementBanner.tsx
// (fail-open on read errors, fail-silent on write errors). Per-device
// by design — a stricter cross-device "I've seen this run" signal would
// need a users.last_seen_run_id column, out of scope here.

import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_SEEN_RUN_KEY_PREFIX = "pack:last_seen_run:";

export async function getLastSeenRunId(
  packId: string,
): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_SEEN_RUN_KEY_PREFIX + packId);
  } catch {
    // Fail-open: a read failure means "we don't know," which the trigger
    // treats as a first-visit (seeds the baseline, doesn't navigate).
    return null;
  }
}

export async function markRunSeen(
  packId: string,
  runId: string,
): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_SEEN_RUN_KEY_PREFIX + packId, runId);
  } catch {
    // Best-effort persist; a write failure just means the next pack
    // open re-runs the same check (worst case: an extra recap fire).
  }
}
