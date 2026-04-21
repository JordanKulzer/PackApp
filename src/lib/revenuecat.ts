import Purchases, {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
  LOG_LEVEL,
} from "react-native-purchases";

const RC_API_KEY_IOS = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";

// Legacy one-time product identifier — still honored for grandfathered users
const LEGACY_PRODUCT_ID = "pack_pro_lifetime";

export function initRevenueCat(userId?: string): void {
  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }
  Purchases.configure({ apiKey: RC_API_KEY_IOS });
  if (userId) {
    Purchases.logIn(userId);
  }
}

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
export const PRO_MONTHLY_PRICE = "$2.99/mo";
export const PRO_ANNUAL_PRICE = "$19.99/yr";
