import PostHog from "posthog-react-native";

let _client: PostHog | null = null;

export function initAnalytics(): void {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  _client = new PostHog(key, {
    host: "https://us.i.posthog.com",
    disabled: __DEV__,
  });
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  _client?.capture(event, properties);
}

// Typed event helpers
export const analytics = {
  paywallViewed: (trigger: string) => capture("paywall_viewed", { trigger }),
  paywallDismissed: (trigger: string) => capture("paywall_dismissed", { trigger }),
  proSubscribed: (productId: string, trigger: string) =>
    capture("pro_subscribed", { product_id: productId, trigger }),
  proRestored: () => capture("pro_restored"),
  gateHit: (feature: string) => capture("gate_hit", { feature }),
};
