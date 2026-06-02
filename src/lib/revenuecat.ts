import Purchases, {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
  LOG_LEVEL,
} from "react-native-purchases";

const RC_API_KEY_IOS = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";

// Legacy one-time product identifier — still honored for grandfathered users
const LEGACY_PRODUCT_ID = "pack_pro_lifetime";

// Module-level "configured" flag — Purchases.configure() is documented as
// safe to call multiple times, but on hot-reload / fast-refresh in dev the
// SDK can warn and the configure call does network work that adds latency.
// This guard runs the configure path exactly once per JS context. logIn /
// logOut paths below bypass the guard since they're per-user state changes,
// not SDK boot.
let rcConfigured = false;

// Boot + per-user login entry point. Safe to call from multiple
// auth-lifecycle moments:
//   • initRevenueCat()         — anon boot configure (run once at app start).
//   • initRevenueCat(user.id)  — configure (if not yet) + logIn the user.
// Subsequent calls with the same user are no-ops aside from logIn's
// SDK-internal short-circuit. Use logOutRevenueCat() on sign-out.
export function initRevenueCat(userId?: string): void {
  if (!rcConfigured) {
    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }
    Purchases.configure({ apiKey: RC_API_KEY_IOS });
    rcConfigured = true;
  }
  if (userId) {
    Purchases.logIn(userId);
  }
}

// TODO(pass-11 subscription-canceled): wire external-cancellation detection.
// On AppState change to "active", read getCustomerInfo(), compare to last-known
// pro status persisted in AsyncStorage. When status flips active → not active,
// fire analytics.subscriptionCanceled({ via: "external_detection", ... }). Edge
// cases to handle: cold-launch first time after install (no last-seen state —
// don't fire), customerInfo network failure (skip the flip check, retry next
// foreground), sign-out vs cancellation (auth state vs subscription state are
// different signals). See Pass 9 audit for the full discussion and properties.
export async function getCustomerInfo(): Promise<CustomerInfo> {
  return Purchases.getCustomerInfo();
}

export async function isPro(): Promise<boolean> {
  try {
    const info = await Purchases.getCustomerInfo();
    if (info.entitlements.active["pro"]) return true;
    // Grandfather legacy one-time purchasers
    return info.nonSubscriptionTransactions.some(
      (t) => t.productIdentifier === LEGACY_PRODUCT_ID
    );
  } catch {
    return false;
  }
}

export async function hasLegacyPurchase(): Promise<boolean> {
  try {
    const info = await Purchases.getCustomerInfo();
    return info.nonSubscriptionTransactions.some(
      (t) => t.productIdentifier === LEGACY_PRODUCT_ID
    );
  } catch {
    return false;
  }
}

export async function getOfferings(): Promise<PurchasesOffering | null> {
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current;
  } catch {
    return null;
  }
}

export async function purchasePackage(
  pkg: PurchasesPackage
): Promise<CustomerInfo | null> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "userCancelled" in error &&
      (error as { userCancelled: boolean }).userCancelled
    ) {
      return null;
    }
    throw error;
  }
}

export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

export async function logOutRevenueCat(): Promise<void> {
  await Purchases.logOut();
}

// Freemium limits
export const FREE_PACK_LIMIT = 3;
export const FREE_MEMBER_LIMIT = 10;
export const PRO_MEMBER_LIMIT = 25;
export const LEGACY_PACK_LIMIT = 4; // extra slot for legacy one-time purchasers
export const FREE_HISTORY_WEEKS = 4; // free tier sees 4 most-recent completed weeks unlocked
export const PRO_MONTHLY_PRICE = "$2.99/mo";
export const PRO_ANNUAL_PRICE = "$19.99/yr";
