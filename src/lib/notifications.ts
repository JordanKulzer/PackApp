import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Competitive pack notifications
//
// Dispatch is server-side: invokes the `notify-pack-event` Supabase Edge
// Function which resolves recipients, checks per-user opt-out prefs, and
// POSTs to the Expo push API. The actor is identified by the function from
// the verified JWT — callers cannot spoof a different actor.
// ─────────────────────────────────────────────────────────────────────────────

export type PackNotificationEvent =
  | { kind: "goal"; activityType: "steps" | "workout" | "calories" | "water"; pointsEarned: number }
  | { kind: "took_lead" }
  | { kind: "all_goals"; totalPoints: number }
  | { kind: "ownership_transferred"; newOwnerName: string }
  | { kind: "new_comment"; bodyPreview: string }
  // Scaffolded but disconnected (Pass 7a). Edge Function and prefs UI both
  // know about this kind, but no client-side caller fires it yet. When
  // join-ping wiring lands (likely at JoinPackModal:118 and join/[code].tsx:113),
  // this type is the contract.
  | { kind: "new_member"; newMemberName: string; packName: string };

type InvokeResponse = { sent?: number; skipped?: number; errors?: unknown[] } | null | undefined;

function logExpoErrors(label: string, data: InvokeResponse): void {
  const errors = data && typeof data === "object" ? (data as { errors?: unknown[] }).errors : undefined;
  if (errors && errors.length > 0) {
    console.warn(`[notifications] ${label} expo errors:`, errors);
  }
}

// Sends a competitive push notification to all active pack members except the
// actor. The edge function resolves recipients from pack_members and checks
// each recipient's notification prefs server-side.
export async function notifyPackMembers(
  _actorId: string,
  packId: string,
  event: PackNotificationEvent,
): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke("notify-pack-event", {
      body: { packId, event },
    });
    if (error) {
      console.error("[notifications] notifyPackMembers invoke failed:", error);
      return;
    }
    console.log("[notifications] notifyPackMembers ok:", data);
    logExpoErrors("notifyPackMembers", data as InvokeResponse);
  } catch (err) {
    console.error("[notifications] notifyPackMembers error:", err);
  }
}

// Sends a push notification to a single user (e.g. new pack owner after transfer).
export async function notifyUser(
  recipientUserId: string,
  _actorName: string,
  packId: string,
  event: PackNotificationEvent,
): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke("notify-pack-event", {
      body: { packId, event, recipients: [recipientUserId] },
    });
    if (error) {
      console.error("[notifications] notifyUser invoke failed:", error);
      return;
    }
    console.log("[notifications] notifyUser ok:", data);
    logExpoErrors("notifyUser", data as InvokeResponse);
  } catch (err) {
    console.error("[notifications] notifyUser error:", err);
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    if (!token) return null;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF231F7C",
      });
    }

    return token;
  } catch (err) {
    console.error("[notifications] registerForPushNotifications threw:", err);
    throw err;
  }
}

export async function saveTokenToSupabase(token: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Delete-then-insert avoids an RLS edge case where UPSERT with a changing
  // owner (same token, different user_id) fails because RLS doesn't cleanly
  // handle the row-ownership transition during ON CONFLICT.
  const { error: deleteError } = await supabase
    .from("user_push_tokens")
    .delete()
    .eq("token", token);
  if (deleteError) {
    console.error("[notifications] token delete failed:", deleteError);
    // Don't return — try insert anyway, might just be that no row existed
  }

  const { error } = await supabase.from("user_push_tokens").insert({
    user_id: user.id,
    token,
    last_seen_at: new Date().toISOString(),
  });
  if (error) {
    console.error("[notifications] token insert failed:", error);
  }
}

export async function initNotifications(): Promise<void> {
  const token = await registerForPushNotifications();
  if (token) {
    await saveTokenToSupabase(token);
  }
}

export function addNotificationReceivedListener(
  handler: (notification: Notifications.Notification) => void
) {
  return Notifications.addNotificationReceivedListener(handler);
}

export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void
) {
  return Notifications.addNotificationResponseReceivedListener(handler);
}

export async function scheduleLocalNotification(
  title: string,
  body: string,
  triggerSeconds = 5
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { seconds: triggerSeconds, repeats: false } as Notifications.TimeIntervalTriggerInput,
  });
}

export async function clearAllNotifications(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync();
  await Notifications.setBadgeCountAsync(0);
}
