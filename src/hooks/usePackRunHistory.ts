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

// Per-category champion(s) for a completed run. winnerUserIds is a uuid[] —
// ties are first-class. The champion is the member (or members, on a true
// tie) with the MOST days won in the category across the run; a member who
// won 1 day in a 7-day category is not the champion.
// championDaysWon is the champion's day count (the max). Tied-day rows
// (winner_user_ids of length > 1) contribute +1 to EACH listed user.
export type RunCategoryWinner = {
  category: Category;
  winnerUserIds: string[];
  championDaysWon: number;
};

// One member's standing in a completed run. totalWins is their count of
// category-day winner memberships across all 4 categories.
export type RunMemberStanding = {
  userId: string;
  displayName: string;
  totalWins: number;
  rank: number; // dense rank by totalWins desc (1,1,3,…)
};

// Stage B (history redesign): a member who is currently active in the
// pack roster but won zero category-days this run. Separate from
// `standings` so callers can render them as a quiet footer line below
// the winning standings rows, instead of as full rows. Sorted by
// displayName asc.
export type ZeroWinMember = {
  userId: string;
  displayName: string;
};

export type CompletedRunHistory = {
  runId: string;
  startedAt: string; // run.start_date
  endedAt: string; // run.end_date
  categoryWinners: RunCategoryWinner[];
  // All members who won at least one category-day, ranked. standings[0]
  // (plus anyone tied at rank 1) is the overall winner. Zero-win members
  // are NOT included — they live in zeroWinMembers below.
  standings: RunMemberStanding[];
  // Active pack-roster members (pack_members.is_active = true) who won
  // zero category-days this run. Empty when every active member won
  // something. A member who left the pack mid-run is not included here.
  zeroWinMembers: ZeroWinMember[];
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
        // 1. Up to 10 most-recent completed runs for this pack, plus the
        // pack's active roster. Stage B (history redesign): the roster
        // query lets us identify "zero-win" members for FINAL STANDINGS —
        // active members of pack_members who don't appear in any
        // winner_user_ids row this run. Self-contained inside the hook,
        // so callers don't change.
        const [runsRes, rosterRes] = await Promise.all([
          supabase
            .from("runs")
            .select("id, start_date, end_date")
            .eq("pack_id", packId)
            .eq("status", "completed")
            .order("end_date", { ascending: false })
            .limit(10),
          supabase
            .from("pack_members")
            .select("user_id")
            .eq("pack_id", packId)
            .eq("is_active", true),
        ]);
        if (runsRes.error) throw runsRes.error;
        if (rosterRes.error) throw rosterRes.error;
        if (cancelled) return;

        const runs = (runsRes.data ?? []) as RunRow[];
        const rosterIds = (
          (rosterRes.data ?? []) as { user_id: string }[]
        ).map((r) => r.user_id);
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

        // 3. Display names for every user appearing in any winner_user_ids
        // OR in the active roster (so zero-win footer rows have real names).
        const userIdSet = new Set<string>();
        for (const row of winnerRows) {
          for (const uid of row.winner_user_ids) userIdSet.add(uid);
        }
        for (const uid of rosterIds) userIdSet.add(uid);
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
          // The champion is the member with the MOST days won in the
          // category (ties first-class — if N users tie at the max, all N
          // are returned). Per-user day count: +1 per row PER uid listed
          // in winner_user_ids, so a tied day awards +1 to each tied user
          // (not a fractional share, and not just to the first).
          const categoryWinners: RunCategoryWinner[] = [];
          for (const category of CATEGORIES) {
            const catRows = rows.filter((r) => r.category === category);
            if (catRows.length === 0) continue;
            const daysByUser: Record<string, number> = {};
            for (const r of catRows) {
              for (const uid of r.winner_user_ids) {
                daysByUser[uid] = (daysByUser[uid] ?? 0) + 1;
              }
            }
            const counts = Object.values(daysByUser);
            // Defensive: a row with an empty winner_user_ids would leave
            // daysByUser empty even though catRows.length > 0. Skip in that
            // case rather than push a champion with championDaysWon=0.
            if (counts.length === 0) continue;
            const maxDays = Math.max(...counts);
            const winnerUserIds = Object.entries(daysByUser)
              .filter(([, days]) => days === maxDays)
              .map(([uid]) => uid);
            categoryWinners.push({
              category,
              winnerUserIds,
              championDaysWon: maxDays,
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

          // Stage B: zero-win members = active roster ids that won nothing
          // this run. Sorted by displayName asc for stable footer order.
          const zeroWinMembers: ZeroWinMember[] = rosterIds
            .filter((uid) => !(uid in winsByUser))
            .map((uid) => ({
              userId: uid,
              displayName: nameMap[uid] ?? "Member",
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName));

          return {
            runId: run.id,
            startedAt: run.start_date,
            endedAt: run.end_date,
            categoryWinners,
            standings,
            zeroWinMembers,
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
