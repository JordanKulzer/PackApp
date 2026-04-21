import { Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useAuthStore } from "../src/stores/authStore";

export default function Index() {
  const session = useAuthStore((s) => s.session);
  const isLoading = useAuthStore((s) => s.isLoading);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  if (session) {
    return <Redirect href="/(app)/home" />;
  }
  return <Redirect href="/(auth)/sign-in" />;
}
