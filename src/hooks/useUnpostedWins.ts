import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

export interface UnpostedWin {
  packId: string;
  feedItemId: string;
  scoreDate: string;
  winningPoints: number;
  postingWindowEndsAt: string;
}

function getYesterdayInTz(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")!.value;
    const mo = parts.find((p) => p.type === "month")!.value;
    const d = parseInt(parts.find((p) => p.type === "day")!.value, 10) - 1;
    const yesterday = new Date(`${y}-${mo}-01T00:00:00`);
    yesterday.setDate(d);
    return yesterday.toISOString().slice(0, 10);
  } catch {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
}

export function useUnpostedWins(userId: string | undefined): {
  wins: UnpostedWin[];
  loading: boolean;
  refresh: () => void;
} {
  const [wins, setWins] = useState<UnpostedWin[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchWins = useCallback(async () => {
    if (!userId) { setWins([]); return; }
    setLoading(true);

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const { data, error } = await supabase
      .from("activity_feed")
      .select("id, pack_id, score_date, points_earned, packs(timezone)")
      .eq("user_id", userId)
      .eq("activity_type", "daily_winner")
      .is("photo_url", null)
      .gte("score_date", twoDaysAgo.toISOString().slice(0, 10));

    if (error || !data) { setLoading(false); return; }

    const result: UnpostedWin[] = [];
    for (const row of data) {
      const tz = (row.packs as { timezone: string } | null)?.timezone ?? "UTC";
      const yesterday = getYesterdayInTz(tz);
      if (row.score_date !== yesterday) continue;

      // posting window ends 24h after the win day ended in pack timezone
      const windowEnd = new Date(row.score_date + "T00:00:00Z");
      windowEnd.setDate(windowEnd.getDate() + 2);

      result.push({
        packId: row.pack_id,
        feedItemId: row.id,
        scoreDate: row.score_date,
        winningPoints: row.points_earned,
        postingWindowEndsAt: windowEnd.toISOString(),
      });
    }

    setWins(result);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchWins(); }, [fetchWins]);

  return { wins, loading, refresh: fetchWins };
}
