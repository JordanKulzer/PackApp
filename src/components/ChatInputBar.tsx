// Chat composer — text input + send button, with an edit-mode banner that
// shows above the input when editing an existing message. Lives at the
// bottom of ChatTab; sits above the bottom tab navigator. Wrap the whole
// thing in a KeyboardAvoidingView at the call site.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ChatMessage } from "../types/database";

interface Props {
  onSend: (body: string) => Promise<void> | void;
  onEdit: (messageId: string, newBody: string) => Promise<void> | void;
  editingMessage: ChatMessage | null;
  onCancelEdit: () => void;
}

const MAX_BODY_LENGTH = 1000;

export function ChatInputBar({
  onSend,
  onEdit,
  editingMessage,
  onCancelEdit,
}: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Prefill on edit transition; clear when leaving edit mode.
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.body);
      // Defer focus so the banner has time to mount before keyboard rises.
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    } else {
      setText("");
    }
  }, [editingMessage]);

  const trimmed = text.trim();
  const canSend =
    trimmed.length > 0 && trimmed.length <= MAX_BODY_LENGTH && !submitting;

  const handleSubmit = async () => {
    if (!canSend) return;
    setSubmitting(true);
    try {
      if (editingMessage) {
        await onEdit(editingMessage.id, trimmed);
        // Caller clears editingMessage on success; the effect above clears
        // the input.
      } else {
        await onSend(trimmed);
        setText("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View>
      {editingMessage ? (
        <View style={s.editBanner}>
          <View style={s.editBannerLeft}>
            <Ionicons name="pencil" size={14} color="#0A84FF" />
            <Text style={s.editBannerText}>Editing message</Text>
          </View>
          <TouchableOpacity onPress={onCancelEdit} hitSlop={8}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={s.bar}>
        <TextInput
          ref={inputRef}
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder={
            editingMessage ? "Editing message..." : "Type a message..."
          }
          placeholderTextColor="#8A8A8E"
          multiline
          textAlignVertical="center"
          maxLength={MAX_BODY_LENGTH}
        />
        <Pressable
          style={({ pressed }) => [
            s.sendBtn,
            !canSend && s.sendBtnDisabled,
            pressed && canSend && { opacity: 0.7 },
          ]}
          onPress={handleSubmit}
          disabled={!canSend}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons
            name="arrow-up"
            size={20}
            color={canSend ? "#FFFFFF" : "#8A8A8E"}
          />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Edit-mode banner sits above the input bar.
  editBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 36,
    paddingHorizontal: 16,
    backgroundColor: "#1C1C1E",
    borderTopWidth: 1,
    borderTopColor: "#2C2C2E",
  },
  editBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  editBannerText: {
    fontSize: 13,
    color: "#0A84FF",
    fontWeight: "500",
  },
  cancelText: {
    fontSize: 13,
    color: "#8A8A8E",
  },
  // Input bar. paddingBottom: 0 so the bar sits flush against whatever's
  // beneath it — keyboard's top edge when open (via KeyboardStickyView),
  // bottom tab navigator when closed (the tab nav handles its own
  // safe-area inset). The 8pt paddingTop gives the input row breathing
  // room from the hairline border above.
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: "#1C1C1E",
    borderTopWidth: 1,
    borderTopColor: "#2C2C2E",
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#2C2C2E",
    borderRadius: 18,
    color: "#FFFFFF",
    fontSize: 15,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginLeft: 8,
    backgroundColor: "#0A84FF",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: "#3A3A3C",
  },
});
