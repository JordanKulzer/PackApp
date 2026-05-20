// Per-category threat notifications (Categories pivot, Stage 2C).
//
// Replaces the points-based threat detection. A "threat" fires when the
// actor's per-category value crosses a packmate's value for TODAY:
//   • passed_you — actor moved strictly above a packmate in a category
//   • tied_you   — actor's category value now exactly equals a packmate's
//
// Crossing is detected from the actor's BEFORE/AFTER values for the
// categories that changed in this sync (the caller computes those and
// passes them in as CategoryDelta[]). No cooldowns — the before/after
// transition gate is the dedup: a threat fires once, on the crossing.

import { supabase } from "./supabase";
import { packToday } from "./packDates";
import { CATEGORY_DAILY_SCORE_COLUMN, type Category } from "./categories";

// Re-exported so existing consumers (logActivity.ts) that import Category
// from this module keep working.
export type { Category };

export type CategoryDelta = {
  category: Category;
  // The value BEFORE this sync wrote anything for this category.
  //   Manual writers: oldManualCount + currentHkCount.
  //   HK writers:     currentManualCount + oldHkCount.
  // The caller computes this and passes it in.
  beforeValue: number;
  // The value AFTER this sync wrote — from the upsert that just ran.
  afterValue: number;
};

export type ThreatKind = "passed_you" | "tied_you";

type ScoreRow = {
  user_id: string;
  steps_count: number;
  workout_count: number;
  calories_count: number;
  water_oz_count: number;
};

// Detects per-category passed_you / tied_you crossings against every other
// member of the run for today, and fires a targeted push to each victim.
// Fire-and-forget: errors are logged, never thrown.
export async function detectAndSendCategoryThreats(
  actorId: string,
  packId: string,
  runId: string,
  packTimezone: string,
  changes: CategoryDelta[],
): Promise<void> {
  if (changes.length === 0) return;

  try {
    const today = packToday(packTimezone);

    // Today's per-category values for every member of this run.
    const { data: rowsRaw } = await supabase
      .from("daily_scores")
      .select(
        "user_id, steps_count, workout_count, calories_count, water_oz_count",
      )
      .eq("run_id", runId)
      .eq("score_date", today);

    const rows = (rowsRaw ?? []) as ScoreRow[];
    if (rows.length === 0) return;

    const { data: actor } = await supabase
      .from("users")
      .select("display_name")
      .eq("id", actorId)
      .maybeSingle();
    const actorName = actor?.display_name ?? "A pack member";

    for (const change of changes) {
      const column = CATEGORY_DAILY_SCORE_COLUMN[change.category];
      for (const row of rows) {
        if (row.user_id === actorId) continue;
        const victimValue = row[column] ?? 0;

        // Crossing detection: fire only on the transition.
        let threatKind: ThreatKind | null = null;
        if (
          change.beforeValue <= victimValue &&
          change.afterValue > victimValue
        ) {
          threatKind = "passed_you";
        } else if (
          change.beforeValue < victimValue &&
          change.afterValue === victimValue
        ) {
          threatKind = "tied_you";
        }
        if (!threatKind) continue;

        // Targeted push — recipients is [victimId] only.
        supabase.functions
          .invoke("notify-pack-event", {
            body: {
              packId,
              recipients: [row.user_id],
              event: {
                kind: "category_threat",
                actorName,
                victimId: row.user_id,
                threatKind,
                category: change.category,
              },
            },
          })
          .catch((err) => {
            console.error("[threatNotifications] invoke failed:", err);
          });
      }
    }
  } catch (err) {
    console.error("[threatNotifications] error:", err);
  }
}
