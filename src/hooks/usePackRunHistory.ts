// usePackRunHistory — completed-run history for the categories pivot.
//
// Replaces the points-based usePackHistory. A completed run no longer has
// one points champion; it has per-category winners and per-member
// category-wins standings. This hook reads settled history straight from
// daily_winners (the same surface usePackCategoryStandings aggregates for
// the active run) — one uniform path for every completed run, regardless
// of close date. run_category_winners is intentionally NOT read (retired).
//
// Completed runs are immutable, so there is no realtime subscription.

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { CATEGORIES, type Category } from "../lib/categories";

// Per-category winner(s) for a completed run. winnerUserIds is a uuid[] —
// ties are first-class. totalDaysWon counts winning DAYS (daily_winners
// rows) for the category, not user-days: a tied day is one row.
export type RunCategoryWinner = {
  category: Category;
  winnerUserIds: string[];
  totalDaysWon: number;
};

// One member's standing in a completed run. totalWins is their count of
// category-day winner memberships across all 4 categories.
export type RunMemberStanding = {
  userId: string;
  displayName: string;
  totalWins: number;
  rank: number; // dense rank by totalWins desc (1,1,3,…)
};

export type CompletedRunHistory = {
  runId: string;
  startedAt: string; // run.start_date
  endedAt: string; // run.end_date
  categoryWinners: RunCategoryWinner[];
  // All members who won at least one category-day, ranked. standings[0]
  // (plus anyone tied at rank 1) is the overall winner.
  standings: RunMemberStanding[];
};

// daily_winners / runs aren't in the generated DB types — declare the row
// shapes we read and cast (same pattern as usePackCategoryStandings).
type RunRow = {
  id: string;
  start_date: string;
  end_date: string;
};

type DailyWinnerRow = {
  run_id: string;
  category: Category;
  winner_user_ids: string[];
};

export function usePackRunHistory(packId: string): {
  completedRuns: CompletedRunHistory[];
  isLoading: boolean;
  error: Error | null;
} {
  const [completedRuns, setCompletedRuns] = useState<CompletedRunHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!packId) {
      setCompletedRuns([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        // 1. Up to 10 most-recent completed runs for this pack.
        const runsRes = await supabase
          .from("runs")
          .select("id, start_date, end_date")
          .eq("pack_id", packId)
          .eq("status", "completed")
          .order("end_date", { ascending: false })
          .limit(10);
        if (runsRes.error) throw runsRes.error;
        if (cancelled) return;

        const runs = (runsRes.data ?? []) as RunRow[];
        if (runs.length === 0) {
          setCompletedRuns([]);
          setIsLoading(false);
          return;
        }

        const runIds = runs.map((r) => r.id);

        // 2. All settled per-day-per-category winner rows for those runs.
        const winnersRes = await supabase
          .from("daily_winners")
          .select("run_id, category, winner_user_ids")
          .in("run_id", runIds)
          .neq("category", "legacy");
        if (winnersRes.error) throw winnersRes.error;
        if (cancelled) return;

        const winnerRows = (winnersRes.data ?? []) as DailyWinnerRow[];

        // 3. Display names for every user appearing in any winner_user_ids.
        const userIdSet = new Set<string>();
        for (const row of winnerRows) {
          for (const uid of row.winner_user_ids) userIdSet.add(uid);
        }
        const nameMap: Record<string, string> = {};
        if (userIdSet.size > 0) {
          const usersRes = await supabase
            .from("users")
            .select("id, display_name")
            .in("id", Array.from(userIdSet));
          if (usersRes.error) throw usersRes.error;
          if (cancelled) return;
          for (const u of usersRes.data ?? []) {
            nameMap[u.id] = u.display_name ?? "Member";
          }
        }

        // 4. Per-run aggregation.
        const rowsByRun: Record<string, DailyWinnerRow[]> = {};
        for (const row of winnerRows) {
          if (!rowsByRun[row.run_id]) rowsByRun[row.run_id] = [];
          rowsByRun[row.run_id].push(row);
        }

        const result: CompletedRunHistory[] = runs.map((run) => {
          const rows = rowsByRun[run.id] ?? [];

          // categoryWinners: one entry per category that has winner rows.
          // totalDaysWon = number of winner rows for the category (= days
          // won); a tied day is a single row listing multiple users.
          const categoryWinners: RunCategoryWinner[] = [];
          for (const category of CATEGORIES) {
            const catRows = rows.filter((r) => r.category === category);
            if (catRows.length === 0) continue;
            const winnerIds = new Set<string>();
            for (const r of catRows) {
              for (const uid of r.winner_user_ids) winnerIds.add(uid);
            }
            categoryWinners.push({
              category,
              winnerUserIds: Array.from(winnerIds),
              totalDaysWon: catRows.length,
            });
          }

          // standings: per user, totalWins = count of category-day winner
          // memberships across every category (UNNEST winner_user_ids).
          // A member who won nothing this run won't appear — acceptable
          // for a history standings list.
          const winsByUser: Record<string, number> = {};
          for (const r of rows) {
            for (const uid of r.winner_user_ids) {
              winsByUser[uid] = (winsByUser[uid] ?? 0) + 1;
            }
          }
          const sorted = Object.entries(winsByUser)
            .map(([userId, totalWins]) => ({
              userId,
              displayName: nameMap[userId] ?? "Member",
              totalWins,
            }))
            .sort((a, b) =>
              b.totalWins !== a.totalWins
                ? b.totalWins - a.totalWins
                : a.displayName.localeCompare(b.displayName),
            );
          // Dense competition rank: tied totalWins share a rank, next skips.
          let prevWins = -1;
          let prevRank = 0;
          const standings: RunMemberStanding[] = sorted.map((entry, i) => {
            const rank = entry.totalWins === prevWins ? prevRank : i + 1;
            prevWins = entry.totalWins;
            prevRank = rank;
            return { ...entry, rank };
          });

          return {
            runId: run.id,
            startedAt: run.start_date,
            endedAt: run.end_date,
            categoryWinners,
            standings,
          };
        });

        // runs already came back end_date desc — result preserves it.
        if (!cancelled) {
          setCompletedRuns(result);
          setIsLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packId]);

  return { completedRuns, isLoading, error };
}
