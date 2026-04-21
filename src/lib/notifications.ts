import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Competitive pack notifications
// ─────────────────────────────────────────────────────────────────────────────

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type PackNotificationEvent =
  | { kind: "goal"; activityType: "steps" | "workout" | "calories" | "water"; pointsEarned: number }
  | { kind: "took_lead" }
  | { kind: "all_goals"; totalPoints: number };

function buildNotificationCopy(
  actorName: string,
  event: PackNotificationEvent,
): { title: string; body: string } {
  if (event.kind === "goal") {
    const label =
      event.activityType === "steps"    ? "their step goal" :
      event.activityType === "workout"  ? "a workout" :
      event.activityType === "calories" ? "their calorie goal" :
                                          "their water goal";
    return { title: actorName, body: `completed ${label} (+${event.pointsEarned} pts)` };
  }
  if (event.kind === "took_lead") {
    return { title: actorName, body: "took the lead 👑" };
  }
  return { title: actorName, body: `completed all goals today 🔥 (${event.totalPoints} pts)` };
}

// Sends a competitive push notification to all active pack members except the actor.
// Dedup is handled upstream — callers only invoke this when a new feed event was inserted.
export async function notifyPackMembers(
  actorId: string,
  packId: string,
  event: PackNotificationEvent,
): Promise<void> {
  try {
    const prefKey = event.kind === "goal" || event.kind === "all_goals" ? "goal_completed" : "goal_completed";

    const [actorResult, membersResult] = await Promise.all([
      supabase.from("users").select("display_name").eq("id", actorId).maybeSingle(),
      supabase
        .from("pack_members")
        .select("user_id")
        .eq("pack_id", packId)
        .eq("is_active", true)
        .neq("user_id", actorId),
    ]);

    const actorName = actorResult.data?.display_name ?? "A pack member";
    const recipientIds = (membersResult.data ?? []).map((m: { user_id: string }) => m.user_id);
    if (recipientIds.length === 0) return;

    const [tokenMap, optedOut] = await Promise.all([
      getTokensForUsers(recipientIds),
      getOptedOutUsers(recipientIds, prefKey),
    ]);

    const { title, body } = buildNotificationCopy(actorName, event);

    const messages = recipientIds
      .filter((uid) => !optedOut.has(uid))
      .flatMap((uid) => (tokenMap[uid] ?? []).map((token) => ({
        to: token,
        title,
        body,
        sound: "default",
        data: { packId },
      })));

    if (messages.length === 0) return;

    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error("[notifications] notifyPackMembers error:", err);
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

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  return token;
}

export async function saveTokenToSupabase(token: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("user_push_tokens").upsert(
    { user_id: user.id, token, last_seen_at: new Date().toISOString() },
    { onConflict: "token" },
  );
}

// Returns set of userIds who have explicitly disabled a given notification type.
// Anyone not in the table is treated as enabled (opt-out model).
export async function getOptedOutUsers(
  userIds: string[],
  prefKey: string,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data } = await supabase
    .from("user_notification_prefs")
    .select("user_id")
    .in("user_id", userIds)
    .eq("pref_key", prefKey)
    .eq("enabled", false);
  return new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
}

// Fetch all Expo push tokens for a list of user IDs.
export async function getTokensForUsers(
  userIds: string[],
): Promise<Record<string, string[]>> {
  if (userIds.length === 0) return {};
  const { data } = await supabase
    .from("user_push_tokens")
    .select("user_id, token")
    .in("user_id", userIds);
  const map: Record<string, string[]> = {};
  (data ?? []).forEach((row: { user_id: string; token: string }) => {
    if (!row.token.startsWith("ExponentPushToken")) return;
    if (!map[row.user_id]) map[row.user_id] = [];
    map[row.user_id].push(row.token);
  });
  return map;
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
