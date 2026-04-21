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
      const { data: runs, error: runsError } = await supabase
        .from("pack_runs")
        .select("id, started_at, ended_at")
        .eq("pack_id", packId)
        .eq("status", "completed")
        .order("ended_at", { ascending: false })
        .limit(10);

      if (runsError || !runs || runs.length === 0) {
        if (!cancelled) {
          setCompletedRuns([]);
          setIsLoading(false);
        }
        return;
      }

      const runIds = runs.map((r) => r.id);

      const { data: snapshots } = await supabase
        .from("leaderboard_snapshots")
        .select("run_id, user_id, final_rank, total_points")
        .in("run_id", runIds)
        .order("final_rank", { ascending: true });

      if (cancelled) return;

      // Resolve display names in one query
      const userIds = [...new Set((snapshots ?? []).map((s) => s.user_id))];
      const userNameMap: Record<string, string> = {};

      if (userIds.length > 0) {
        const { data: usersData } = await supabase
          .from("users")
          .select("id, display_name")
          .in("id", userIds);
        (usersData ?? []).forEach((u) => {
          userNameMap[u.id] = u.display_name;
        });
      }

      if (cancelled) return;

      // Group snapshots by run
      type SnapRow = { user_id: string; final_rank: number; total_points: number };
      const snapshotsByRun: Record<string, SnapRow[]> = {};
      (snapshots ?? []).forEach((snap) => {
        if (!snapshotsByRun[snap.run_id]) snapshotsByRun[snap.run_id] = [];
        snapshotsByRun[snap.run_id].push(snap);
      });

      const result: CompletedRun[] = runs.map((run) => {
        const runSnaps = snapshotsByRun[run.id] ?? [];
        const top = runSnaps[0]; // already ordered final_rank asc

        return {
          runId: run.id,
          startedAt: run.started_at,
          endedAt: run.ended_at,
          winner: top
            ? {
                userId: top.user_id,
                displayName: userNameMap[top.user_id] ?? "Unknown",
                totalPoints: top.total_points,
              }
            : { userId: "", displayName: "—", totalPoints: 0 },
          standings: runSnaps.map((snap) => ({
            rank: snap.final_rank,
            userId: snap.user_id,
            displayName: userNameMap[snap.user_id] ?? "Unknown",
            totalPoints: snap.total_points,
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
