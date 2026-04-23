import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmDestructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  confirmDestructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={s.overlay}>
        <View style={s.sheet}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.message}>{message}</Text>
          <View style={s.buttons}>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={onCancel}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.confirmBtn, confirmDestructive && s.destructiveBtn]}
              onPress={handleConfirm}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text
                  style={[
                    s.confirmText,
                    confirmDestructive && s.destructiveText,
                  ]}
                >
                  {confirmLabel}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  sheet: {
    width: "100%",
    backgroundColor: "#1C2333",
    borderRadius: 20,
    padding: 24,
    gap: 12,
    borderWidth: 0.5,
    borderColor: "#30363D",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#E6EDF3",
  },
  message: {
    fontSize: 14,
    color: "#8B949E",
    lineHeight: 20,
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#121821",
    alignItems: "center",
    borderWidth: 0.5,
    borderColor: "#30363D",
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#8B949E",
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#238636",
    alignItems: "center",
  },
  destructiveBtn: {
    backgroundColor: "#B91C1C",
  },
  confirmText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  destructiveText: {
    color: "#FFFFFF",
  },
});
