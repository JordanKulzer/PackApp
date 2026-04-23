import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export interface RunStanding {
  rank: number;
  userId: string;
  displayName: string;
  totalPoints: number;
}

export interface CompletedRun {
  runId: string;
  startedAt: string;
  endedAt: string;
  winner: {
    userId: string;
    displayName: string;
    totalPoints: number;
  };
  standings: RunStanding[];
}

export function usePackHistory(packId: string) {
  const [completedRuns, setCompletedRuns] = useState<CompletedRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!packId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      // Step 1: Fetch completed runs for this pack
      const { data: runs, error: runsError } = await supabase
        .from("runs")
        .select("id, start_date, end_date")
        .eq("pack_id", packId)
        .eq("status", "completed")
        .order("end_date", { ascending: false })
        .limit(10);

      if (runsError) {
        console.error("[usePackHistory] runs query error:", runsError);
      }

      if (!runs || runs.length === 0) {
        if (!cancelled) {
          setCompletedRuns([]);
          setIsLoading(false);
        }
        return;
      }

      const runIds = runs.map((r) => r.id);

      // Step 2: Fetch daily scores for those runs, joined to users for display_name
      const { data: scores, error: scoresError } = await supabase
        .from("daily_scores")
        .select(
          `
          run_id,
          user_id,
          total_points,
          users ( display_name )
        `,
        )
        .in("run_id", runIds);

      if (scoresError) {
        console.error("[usePackHistory] scores query error:", scoresError);
      }

      if (cancelled) return;

      // Step 3: Aggregate points per (run_id, user_id)
      type UserTotal = {
        userId: string;
        displayName: string;
        totalPoints: number;
      };
      const totalsByRun: Record<string, Map<string, UserTotal>> = {};

      for (const row of scores ?? []) {
        const runMap = totalsByRun[row.run_id] ?? new Map<string, UserTotal>();
        const existing = runMap.get(row.user_id);

        const displayName =
          (row.users as { display_name?: string } | null)?.display_name ??
          "Unknown";

        if (existing) {
          existing.totalPoints += row.total_points;
        } else {
          runMap.set(row.user_id, {
            userId: row.user_id,
            displayName,
            totalPoints: row.total_points,
          });
        }

        totalsByRun[row.run_id] = runMap;
      }

      // Step 4: Build the final result — ranked standings per run, winner is rank 1
      const result: CompletedRun[] = runs.map((run) => {
        const runMap = totalsByRun[run.id] ?? new Map<string, UserTotal>();

        const ranked = Array.from(runMap.values())
          .sort((a, b) => b.totalPoints - a.totalPoints)
          .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

        const top = ranked[0];

        return {
          runId: run.id,
          startedAt: run.start_date,
          endedAt: run.end_date,
          winner: top
            ? {
                userId: top.userId,
                displayName: top.displayName,
                totalPoints: top.totalPoints,
              }
            : { userId: "", displayName: "—", totalPoints: 0 },
          standings: ranked.map((entry) => ({
            rank: entry.rank,
            userId: entry.userId,
            displayName: entry.displayName,
            totalPoints: entry.totalPoints,
          })),
        };
      });

      if (!cancelled) {
        setCompletedRuns(result);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packId]);

  return { completedRuns, isLoading };
}
