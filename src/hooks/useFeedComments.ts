import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import type { ReactionType } from "./useActivityFeed";

export interface CommentWithUser {
  id: string;
  feedItemId: string;
  parentId: string | null;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  body: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  reactions: { type: ReactionType; count: number; hasReacted: boolean }[];
  replies: CommentWithUser[];
}

type CommentRow = {
  id: string;
  feed_item_id: string;
  parent_id: string | null;
  user_id: string;
  body: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  users: { display_name: string; avatar_url: string | null } | null;
};

type ReactionRow = {
  comment_id: string;
  user_id: string;
  reaction_type: ReactionType;
};

export function useFeedComments(feedItemId: string | null) {
  const [comments, setComments] = useState<CommentWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const commentIdsRef = useRef<Set<string>>(new Set());

  const fetchComments = useCallback(async () => {
    if (!feedItemId) return;
    setIsLoading(true);

    const [userRes, commentsRes] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from("feed_comments")
        .select("id, feed_item_id, parent_id, user_id, body, is_deleted, created_at, updated_at, users(display_name, avatar_url)")
        .eq("feed_item_id", feedItemId)
        .order("created_at", { ascending: true }),
    ]);

    const uid = userRes.data.user?.id ?? null;
    const { data, error } = commentsRes;

    if (error) {
      console.error("[useFeedComments]", error);
      setIsLoading(false);
      return;
    }

    const rows = ((data ?? []) as unknown as CommentRow[]);
    const commentIds = rows.map((r) => r.id);

    let reactionRows: ReactionRow[] = [];
    if (commentIds.length > 0) {
      const { data: rxData, error: rxErr } = await supabase
        .from("feed_comment_reactions")
        .select("comment_id, user_id, reaction_type")
        .in("comment_id", commentIds);
      if (rxErr) console.error("[useFeedComments] reactions fetch:", rxErr);
      reactionRows = (rxData ?? []) as ReactionRow[];
    }

    // Group reactions by comment_id → reaction_type → { count, hasReacted }
    const reactionsByComment: Record<string, Partial<Record<ReactionType, { count: number; hasReacted: boolean }>>> = {};
    reactionRows.forEach((r) => {
      if (!reactionsByComment[r.comment_id]) reactionsByComment[r.comment_id] = {};
      const bucket = reactionsByComment[r.comment_id];
      if (!bucket[r.reaction_type]) bucket[r.reaction_type] = { count: 0, hasReacted: false };
      bucket[r.reaction_type]!.count += 1;
      if (uid && r.user_id === uid) bucket[r.reaction_type]!.hasReacted = true;
    });

    const flat: CommentWithUser[] = rows.map((r) => {
      const rxMap = reactionsByComment[r.id] ?? {};
      const reactions = (Object.keys(rxMap) as ReactionType[]).map((type) => ({
        type,
        count: rxMap[type]!.count,
        hasReacted: rxMap[type]!.hasReacted,
      }));
      return {
        id: r.id,
        feedItemId: r.feed_item_id,
        parentId: r.parent_id,
        userId: r.user_id,
        displayName: r.users?.display_name ?? "Unknown",
        avatarUrl: r.users?.avatar_url ?? null,
        body: r.body,
        isDeleted: r.is_deleted,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        reactions,
        replies: [],
      };
    });

    const byId: Record<string, CommentWithUser> = {};
    const roots: CommentWithUser[] = [];
    flat.forEach((c) => { byId[c.id] = c; });
    flat.forEach((c) => {
      if (c.parentId && byId[c.parentId]) byId[c.parentId].replies.push(c);
      else roots.push(c);
    });

    // Hide soft-deleted roots that have no replies
    setComments(roots.filter((c) => !c.isDeleted || c.replies.length > 0));
    commentIdsRef.current = new Set(commentIds);
    setIsLoading(false);
  }, [feedItemId]);

  useEffect(() => {
    if (!feedItemId) return;
    fetchComments();

    const channel = supabase
      .channel(`feed_comments:${feedItemId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "feed_comments",
        filter: `feed_item_id=eq.${feedItemId}`,
      }, () => fetchComments())
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "feed_comment_reactions",
      }, (payload) => {
        // Unfiltered subscription — only refetch if the changed row is for
        // a comment we currently have loaded.
        const row = (payload.new ?? payload.old) as { comment_id?: string } | undefined;
        const cid = row?.comment_id;
        if (!cid) return;
        if (!commentIdsRef.current.has(cid)) return;
        fetchComments();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [feedItemId, fetchComments]);

  const addComment = useCallback(async (
    userId: string,
    body: string,
    parentId: string | null = null,
  ): Promise<boolean> => {
    // Insert + select the row back with the users join so we can optimistically
    // render the new comment without waiting for the realtime refetch to echo.
    const { data, error } = await supabase
      .from("feed_comments")
      .insert({
        feed_item_id: feedItemId,
        user_id: userId,
        body,
        parent_id: parentId,
      })
      .select("id, feed_item_id, parent_id, user_id, body, is_deleted, created_at, updated_at, users(display_name, avatar_url)")
      .single();

    if (error || !data) {
      console.error("[useFeedComments] addComment:", error);
      return false;
    }

    const row = data as unknown as CommentRow;
    const optimistic: CommentWithUser = {
      id: row.id,
      feedItemId: row.feed_item_id,
      parentId: row.parent_id,
      userId: row.user_id,
      displayName: row.users?.display_name ?? "You",
      avatarUrl: row.users?.avatar_url ?? null,
      body: row.body,
      isDeleted: row.is_deleted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reactions: [],
      replies: [],
    };

    setComments((prev) => {
      if (parentId) {
        return prev.map((root) =>
          root.id === parentId
            ? { ...root, replies: [...root.replies, optimistic] }
            : root,
        );
      }
      return [...prev, optimistic];
    });
    commentIdsRef.current.add(row.id);

    return true;
  }, [feedItemId]);

  const editComment = useCallback(async (id: string, body: string): Promise<boolean> => {
    const { error } = await supabase.from("feed_comments").update({ body }).eq("id", id);
    if (error) { console.error("[useFeedComments] editComment:", error); return false; }
    return true;
  }, []);

  const deleteComment = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase
      .from("feed_comments")
      .update({ is_deleted: true, body: "" })
      .eq("id", id);
    if (error) { console.error("[useFeedComments] deleteComment:", error); return false; }
    return true;
  }, []);

  const toggleCommentReaction = useCallback(async (
    commentId: string,
    packId: string,
    reactionType: ReactionType,
  ): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const uid = user.id;

    // Synchronously read prev reaction and apply optimistic update.
    let prevType: ReactionType | null = null;

    const mutateComment = (c: CommentWithUser): CommentWithUser => {
      if (c.id !== commentId) return c;
      const existing = c.reactions.find((r) => r.hasReacted);
      prevType = existing?.type ?? null;

      const isSame = prevType === reactionType;
      let next = c.reactions.map((r) => ({ ...r }));

      if (isSame) {
        next = next
          .map((r) => r.type === reactionType ? { ...r, count: r.count - 1, hasReacted: false } : r)
          .filter((r) => r.count > 0);
      } else {
        if (prevType) {
          next = next
            .map((r) => r.type === prevType ? { ...r, count: r.count - 1, hasReacted: false } : r)
            .filter((r) => r.count > 0);
        }
        const idx = next.findIndex((r) => r.type === reactionType);
        if (idx >= 0) {
          next[idx] = { ...next[idx], count: next[idx].count + 1, hasReacted: true };
        } else {
          next.push({ type: reactionType, count: 1, hasReacted: true });
        }
      }

      return { ...c, reactions: next };
    };

    setComments((prev) =>
      prev.map((root) => {
        if (root.id === commentId) return mutateComment(root);
        const newReplies = root.replies.map((r) => r.id === commentId ? mutateComment(r) : r);
        return { ...root, replies: newReplies };
      }),
    );

    const isSame = prevType === reactionType;

    try {
      if (isSame) {
        const { error } = await supabase
          .from("feed_comment_reactions")
          .delete()
          .eq("comment_id", commentId)
          .eq("user_id", uid);
        if (error) throw error;
      } else if (prevType) {
        // Switch: delete the old reaction first, then insert the new one.
        // The unique (comment_id, user_id) constraint rejects the new INSERT
        // while the old row exists, so update-in-place isn't viable here.
        const { error: delErr } = await supabase
          .from("feed_comment_reactions")
          .delete()
          .eq("comment_id", commentId)
          .eq("user_id", uid);
        if (delErr) throw delErr;
        const { error: insErr } = await supabase
          .from("feed_comment_reactions")
          .insert({ comment_id: commentId, user_id: uid, pack_id: packId, reaction_type: reactionType });
        if (insErr) throw insErr;
      } else {
        // No prior reaction in client state. Delete first in case the DB has
        // a stale row the client missed (avoids 23505 without needing UPDATE
        // policy). Mirrors the same defense in useActivityFeed.toggleReaction.
        await supabase
          .from("feed_comment_reactions")
          .delete()
          .eq("comment_id", commentId)
          .eq("user_id", uid);
        const { error } = await supabase
          .from("feed_comment_reactions")
          .insert({ comment_id: commentId, user_id: uid, pack_id: packId, reaction_type: reactionType });
        if (error) throw error;
      }
    } catch (err) {
      console.error("[useFeedComments] toggleCommentReaction:", err);
      // Rollback by refetching authoritative server state.
      fetchComments();
    }
  }, [fetchComments]);

  return { comments, isLoading, fetchComments, addComment, editComment, deleteComment, toggleCommentReaction };
}
