// Returns up to 5 categories the user has used in the last 30 days, ordered
// by most-recent first. Used by SeeMoreCategoriesSheet's "Recently used"
// section.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { ActivityCategory } from "../lib/activityCategoryMap";
import { ACTIVITY_CATEGORIES } from "../lib/activityCategoryMap";

const ALL_CATS = new Set<string>(ACTIVITY_CATEGORIES);

export function useRecentCategories(
  userId: string | null | undefined,
  enabled: boolean,
): { recent: ActivityCategory[]; isLoading: boolean } {
  const [recent, setRecent] = useState<ActivityCategory[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!userId || !enabled) {
      setRecent([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);

    (async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const { data, error } = await supabase
        .from("activity_feed")
        .select("category, created_at")
        .eq("user_id", userId)
        .not("category", "is", null)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(200);

      if (cancelled) return;
      if (error) {
        console.error("[useRecentCategories] fetch error:", error);
        setIsLoading(false);
        return;
      }

      // Walk in descending-time order, keep first appearance per category
      const seen = new Set<string>();
      const out: ActivityCategory[] = [];
      for (const row of data ?? []) {
        const cat = row.category as string | null;
        if (!cat || seen.has(cat) || !ALL_CATS.has(cat)) continue;
        seen.add(cat);
        out.push(cat as ActivityCategory);
        if (out.length >= 5) break;
      }
      setRecent(out);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, enabled]);

  return { recent, isLoading };
}
