import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Image,
  TouchableOpacity,
  Alert,
  Animated,
  TextInput,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFeedComments, CommentWithUser } from "../hooks/useFeedComments";
import type { ReactionType } from "../hooks/useActivityFeed";
import { notifyUser } from "../lib/notifications";
import { formatName, getInitial } from "../lib/displayName";
import { useCurrentUser } from "../context/CurrentUserContext";

const C = {
  surface: "#121821",
  surfaceRaised: "#1C2333",
  border: "#30363D",
  textPrimary: "#FFFFFF",
  textSecondary: "#EBEBF5",
  textMuted: "#8A8A8E",
  textDim: "#3A3A3C",
  accent: "#0A84FF",
  danger: "#F85149",
  pillBg: "#2C2C2E",
  pillBgActive: "#1F3A5F",
  popoverBg: "#1C1C1E",
  replyingPillBg: "#1C1C1E",
  handle: "#3A3A3C",
} as const;

const REACTION_EMOJIS: ReactionType[] = ["💪", "🔥", "👏"];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Inline reaction popover, anchored under the smiley button ──
// Re-mounts (and re-fades-in) each time reactionPickerCommentId switches.
function InlineReactionPopover({
  onPickEmoji,
}: {
  onPickEmoji: (emoji: ReactionType) => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  return (
    <Animated.View style={[s.popover, { opacity }]}>
      {REACTION_EMOJIS.map((emoji) => (
        <TouchableOpacity
          key={emoji}
          style={s.popoverBtn}
          onPress={() => onPickEmoji(emoji)}
          hitSlop={4}
        >
          <Text style={s.popoverEmoji}>{emoji}</Text>
        </TouchableOpacity>
      ))}
    </Animated.View>
  );
}

interface Props {
  feedItemId: string;
  feedItemUserId: string;
  feedItemSummary: string;
  packId: string;
  currentUserId: string | undefined;
  currentUserName: string;
  visible: boolean;
  onClose: () => void;
  onCommentAdded?: () => void;
}

export function CommentsSheet({
  feedItemId,
  feedItemUserId,
  feedItemSummary,
  packId,
  currentUserId,
  currentUserName,
  visible,
  onClose,
  onCommentAdded,
}: Props) {
  const { user: currentUser } = useCurrentUser();
  const {
    comments,
    isLoading,
    addComment,
    editComment,
    deleteComment,
    toggleCommentReaction,
  } = useFeedComments(visible ? feedItemId : null);

  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const sheetRef = useRef<BottomSheetModal>(null);
  const inputRef = useRef<TextInput>(null);
  const snapPoints = useMemo(() => {
    // Available height = window height minus top safe area
    // Sheet should occupy 75% of that, never more
    const sheetHeight = (windowHeight - insets.top) * 0.75;
    return [sheetHeight];
  }, [windowHeight, insets.top]);

  const [inputText, setInputText] = useState("");
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
  const [reactionPickerCommentId, setReactionPickerCommentId] = useState<string | null>(null);

  // Sync visible prop with sheet present/dismiss. The sheet's onDismiss
  // calls onClose, so external close commands and gesture-driven dismissal
  // funnel through the same parent state path. Reset transient UI state
  // when the sheet closes so the next open starts fresh.
  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
      setInputText("");
      setReplyingTo(null);
      setEditingId(null);
      setEditText("");
      setExpandedThreads({});
      setReactionPickerCommentId(null);
    }
  }, [visible]);

  const totalCount = comments.reduce(
    (acc, c) => acc + 1 + c.replies.filter((r) => !r.isDeleted).length,
    0,
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
      />
    ),
    [],
  );

  const handleSubmit = async () => {
    const text = inputText.trim();
    if (!text || !currentUserId) return;

    const parentId = replyingTo?.id ?? null;
    setInputText("");
    setReplyingTo(null);

    const ok = await addComment(currentUserId, text, parentId);
    if (!ok) {
      Alert.alert("Error", "Failed to post comment.");
      return;
    }

    onCommentAdded?.();

    if (feedItemUserId !== currentUserId) {
      const preview = text.length > 60 ? text.slice(0, 57) + "…" : text;
      notifyUser(feedItemUserId, currentUserName, packId, {
        kind: "new_comment",
        bodyPreview: preview,
      }).catch(() => {});
    }
  };

  const handleReply = (comment: CommentWithUser) => {
    setReplyingTo({ id: comment.id, name: comment.displayName });
    setEditingId(null);
    // Small delay lets the "Replying to" pill render before focus moves
    // and the keyboard rises.
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleStartEdit = (comment: CommentWithUser) => {
    setEditingId(comment.id);
    setEditText(comment.body);
    setReplyingTo(null);
    setReactionPickerCommentId(null);
  };

  const handleSubmitEdit = async () => {
    const text = editText.trim();
    if (!text || !editingId) return;
    await editComment(editingId, text);
    setEditingId(null);
    setEditText("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const handleDelete = (id: string) => {
    Alert.alert("Delete comment", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteComment(id) },
    ]);
  };

  const handleSmileyTap = (commentId: string) => {
    setReactionPickerCommentId((cur) => (cur === commentId ? null : commentId));
  };

  const renderComment = (comment: CommentWithUser, isReply = false) => {
    if (comment.isDeleted && comment.replies.length === 0) return null;

    const isMe = comment.userId === currentUserId;
    const isEditing = editingId === comment.id;
    const isPickerOpen = reactionPickerCommentId === comment.id;
    const resolvedName = isMe && currentUser ? currentUser.displayName : comment.displayName;
    const resolvedAvatar = isMe && currentUser ? currentUser.avatarUrl : comment.avatarUrl;
    const initial = getInitial(resolvedName);
    const avatarSize = isReply ? 26 : 34;
    const avatarRadius = avatarSize / 2;

    return (
      <View key={comment.id} style={[s.commentRow, isReply && s.replyRow]}>
        <View
          style={[
            s.avatar,
            { width: avatarSize, height: avatarSize, borderRadius: avatarRadius },
          ]}
        >
          {resolvedAvatar ? (
            <Image
              source={{ uri: resolvedAvatar }}
              style={{ width: avatarSize, height: avatarSize, borderRadius: avatarRadius }}
            />
          ) : (
            <Text style={[s.avatarText, isReply && { fontSize: 11 }]}>{initial}</Text>
          )}
        </View>

        <View style={s.commentContent}>
          {comment.isDeleted ? (
            <Text style={s.deletedText}>[Comment deleted]</Text>
          ) : (
            <>
              <View style={s.commentHeader}>
                <Text style={s.commenterName}>{formatName(resolvedName, 0)}</Text>
                <Text style={s.commentTime}>{relativeTime(comment.createdAt)}</Text>
              </View>

              {isEditing ? (
                <>
                  <BottomSheetTextInput
                    style={s.editInput}
                    value={editText}
                    onChangeText={(t) => setEditText(t.slice(0, 280))}
                    multiline
                    maxLength={280}
                    autoFocus
                  />
                  <View style={s.editActions}>
                    <TouchableOpacity onPress={handleSubmitEdit} hitSlop={6}>
                      <Text style={s.editSave}>Save</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleCancelEdit} hitSlop={6}>
                      <Text style={s.editCancel}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={s.commentBody}>{comment.body}</Text>

                  <View style={s.commentActions}>
                    <View style={s.actionsLeft}>
                      {!isReply && (
                        <TouchableOpacity onPress={() => handleReply(comment)} hitSlop={6}>
                          <Text style={s.actionText}>Reply</Text>
                        </TouchableOpacity>
                      )}
                      {isMe && (
                        <>
                          <TouchableOpacity onPress={() => handleStartEdit(comment)} hitSlop={6}>
                            <Text style={s.actionText}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleDelete(comment.id)} hitSlop={6}>
                            <Text style={[s.actionText, { color: C.danger }]}>Delete</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>

                    <View style={s.reactionRow}>
                      {comment.reactions.map((rx) => (
                        <TouchableOpacity
                          key={rx.type}
                          style={[s.reactionPill, rx.hasReacted && s.reactionPillActive]}
                          onPress={() => toggleCommentReaction(comment.id, packId, rx.type)}
                          hitSlop={4}
                        >
                          <Text style={s.reactionPillText}>
                            {rx.type} {rx.count}
                          </Text>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity
                        style={s.smileyBtn}
                        onPress={() => handleSmileyTap(comment.id)}
                        hitSlop={6}
                      >
                        <Ionicons name="happy-outline" size={18} color={C.textMuted} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {isPickerOpen && (
                    <InlineReactionPopover
                      onPickEmoji={(emoji) => {
                        toggleCommentReaction(comment.id, packId, emoji);
                        setReactionPickerCommentId(null);
                      }}
                    />
                  )}
                </>
              )}
            </>
          )}
        </View>
      </View>
    );
  };

  const renderReplyBlock = (parent: CommentWithUser) => {
    const replies = parent.replies;
    if (replies.length === 0) return null;
    if (replies.length === 1) return renderComment(replies[0], true);

    const isExpanded = !!expandedThreads[parent.id];

    if (isExpanded) {
      return (
        <>
          {replies.map((r) => renderComment(r, true))}
          <TouchableOpacity
            style={s.threadToggle}
            onPress={() =>
              setExpandedThreads((prev) => ({ ...prev, [parent.id]: false }))
            }
            hitSlop={6}
          >
            <Ionicons name="chevron-up" size={12} color={C.textMuted} />
            <Text style={s.threadToggleText}>Hide replies</Text>
          </TouchableOpacity>
        </>
      );
    }

    const hidden = replies.length - 1;
    return (
      <>
        {renderComment(replies[0], true)}
        <TouchableOpacity
          style={s.threadToggle}
          onPress={() =>
            setExpandedThreads((prev) => ({ ...prev, [parent.id]: true }))
          }
          hitSlop={6}
        >
          <Ionicons name="chevron-down" size={12} color={C.textMuted} />
          <Text style={s.threadToggleText}>
            View {hidden} more {hidden === 1 ? "reply" : "replies"}
          </Text>
        </TouchableOpacity>
      </>
    );
  };

  const sendColor = inputText.trim() ? C.accent : C.textDim;
  const inputPlaceholder = replyingTo
    ? `Add a comment for ${replyingTo.name}...`
    : "Add a comment...";

  return (
    <BottomSheetModal
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enableOverDrag={false}
      enablePanDownToClose
      topInset={insets.top}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      onDismiss={onClose}
      backgroundStyle={s.sheetBackground}
      handleIndicatorStyle={s.handleIndicator}
      backdropComponent={renderBackdrop}
    >
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>
          {totalCount === 0
            ? "Comments"
            : `${totalCount} comment${totalCount === 1 ? "" : "s"}`}
        </Text>
        <TouchableOpacity
          style={s.closeBtn}
          onPress={() => sheetRef.current?.dismiss()}
          hitSlop={8}
        >
          <Ionicons name="close" size={22} color={C.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Feed item summary */}
      <View style={s.summaryRow}>
        <Text style={s.summaryText} numberOfLines={2}>
          {feedItemSummary}
        </Text>
      </View>

      {/* Comment list */}
      <BottomSheetScrollView contentContainerStyle={s.listContent}>
        {isLoading && (
          <View style={s.centered}>
            <ActivityIndicator color={C.textMuted} />
          </View>
        )}
        {!isLoading && comments.length === 0 && (
          <Text style={s.emptyText}>Be the first to comment</Text>
        )}
        {comments.map((comment) => (
          <View key={comment.id}>
            {renderComment(comment, false)}
            {renderReplyBlock(comment)}
          </View>
        ))}
      </BottomSheetScrollView>

      {/* Replying to {name} pill */}
      {replyingTo && (
        <View style={s.replyingPill}>
          <Text style={s.replyingPillText}>
            Replying to {formatName(replyingTo.name, 0)}
          </Text>
          <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={8}>
            <Ionicons name="close" size={16} color={C.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Input row */}
      <View style={s.inputRow}>
        <BottomSheetTextInput
          // gorhom's BottomSheetTextInput ref typing collides with React 19's
          // strict Ref unions; eslint-disable for the cast keeps focus() working.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={inputRef as any}
          style={s.input}
          placeholder={inputPlaceholder}
          placeholderTextColor={C.textDim}
          value={inputText}
          onChangeText={(t) => setInputText(t.slice(0, 280))}
          multiline
          maxLength={280}
        />
        <TouchableOpacity
          style={s.sendBtn}
          onPress={handleSubmit}
          disabled={!inputText.trim()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="send" size={20} color={sendColor} />
        </TouchableOpacity>
      </View>
    </BottomSheetModal>
  );
}

const s = StyleSheet.create({
  sheetBackground: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  handleIndicator: {
    backgroundColor: C.handle,
    width: 36,
    height: 4,
    borderRadius: 2,
  },

  // ── Header ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textPrimary,
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    top: 10,
    padding: 2,
  },

  // ── Summary ──
  summaryRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  summaryText: {
    fontSize: 13,
    color: C.textMuted,
    fontStyle: "italic",
  },

  // ── List ──
  listContent: {
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  centered: {
    paddingVertical: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: C.textMuted,
    textAlign: "center",
    paddingTop: 40,
  },

  // ── Comment rows ──
  commentRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
  },
  replyRow: {
    marginLeft: 44,
    paddingVertical: 6,
  },
  avatar: {
    backgroundColor: C.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: "700",
    color: C.textPrimary,
  },
  commentContent: {
    flex: 1,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  commenterName: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textPrimary,
  },
  commentTime: {
    fontSize: 11,
    color: C.textMuted,
    marginLeft: 6,
  },
  commentBody: {
    fontSize: 14,
    lineHeight: 19,
    color: C.textSecondary,
    marginTop: 2,
  },
  deletedText: {
    fontSize: 13,
    color: C.textMuted,
    fontStyle: "italic",
  },

  // ── Action row (Reply/Edit/Delete on left, reactions on right) ──
  commentActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  actionsLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  actionText: {
    fontSize: 12,
    fontWeight: "500",
    color: C.textMuted,
    marginRight: 14,
  },

  // ── Reactions (pills + smiley) ──
  reactionRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  reactionPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: C.pillBg,
    marginRight: 4,
  },
  reactionPillActive: {
    backgroundColor: C.pillBgActive,
  },
  reactionPillText: {
    fontSize: 12,
    color: C.textPrimary,
  },
  smileyBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },

  // ── Inline reaction popover ──
  popover: {
    alignSelf: "flex-end",
    flexDirection: "row",
    backgroundColor: C.popoverBg,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 6,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  popoverBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  popoverEmoji: {
    fontSize: 22,
  },

  // ── Edit-in-place ──
  editInput: {
    backgroundColor: C.surfaceRaised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    color: C.textPrimary,
    marginTop: 2,
    maxHeight: 120,
  },
  editActions: {
    flexDirection: "row",
    marginTop: 6,
    gap: 16,
  },
  editSave: {
    fontSize: 12,
    fontWeight: "600",
    color: C.accent,
  },
  editCancel: {
    fontSize: 12,
    fontWeight: "500",
    color: C.textMuted,
  },

  // ── Thread expand / collapse ──
  threadToggle: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 44,
    paddingVertical: 6,
  },
  threadToggleText: {
    fontSize: 12,
    color: C.textMuted,
    marginLeft: 4,
  },

  // ── "Replying to {name}" pill above input ──
  replyingPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.replyingPillBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  replyingPillText: {
    fontSize: 12,
    color: C.textSecondary,
  },

  // ── Input ──
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  input: {
    flex: 1,
    backgroundColor: C.surfaceRaised,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: C.textPrimary,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: C.border,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
