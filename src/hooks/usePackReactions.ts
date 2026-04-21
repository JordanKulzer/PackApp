import { useCallback } from "react";
import { supabase } from "../lib/supabase";

type ActivityType = "steps" | "workout" | "calories" | "water";

export function usePackReactions(currentUserId: string | undefined) {
  const logFeedItem = useCallback(
    async (params: {
      packId: string;
      activityType: ActivityType;
      value: number;
      pointsEarned: number;
    }) => {
      if (!currentUserId) return;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: existing } = await supabase
        .from("activity_feed")
        .select("id")
        .eq("pack_id", params.packId)
        .eq("user_id", currentUserId)
        .eq("activity_type", params.activityType)
        .gte("created_at", todayStart.toISOString())
        .maybeSingle();

      if (existing) return;

      await supabase.from("activity_feed").insert({
        pack_id: params.packId,
        user_id: currentUserId,
        activity_type: params.activityType,
        value: params.value,
        points_earned: params.pointsEarned,
      });
    },
    [currentUserId]
  );

  return { logFeedItem };
}
