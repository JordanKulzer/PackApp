// Per-pack dismissal of PendingCategoryBanner. The stored VALUE is the
// pack's `pending_changes_at` timestamp at dismissal time — dismissing
// hides THIS notice instance, but a later change refreshes
// pending_changes_at, the stored value no longer matches, and the
// banner re-shows automatically. Mirrors src/lib/newRunRecap.ts:
//   • per-pack key prefix + namespace
//   • fail-open on read (no record → "we don't know" → banner shows)
//   • fail-silent on write (worst case: the next mount asks again)

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "pack:pending_banner_dismissed:";

export async function getDismissedTimestamp(
  packId: string,
): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_PREFIX + packId);
  } catch {
    // Fail-open: a read failure means "we don't know," which the
    // consumer treats as not-dismissed (banner shows). Better than
    // accidentally suppressing a real notice on a transient
    // AsyncStorage error.
    return null;
  }
}

export async function dismissBanner(
  packId: string,
  pendingChangesAt: string,
): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + packId, pendingChangesAt);
  } catch {
    // Best-effort persist; a write failure just means the next mount
    // re-runs the same check and shows the banner again. The local
    // setDismissedAt() in the consumer still hides it for this
    // session.
  }
}
