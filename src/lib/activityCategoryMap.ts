// Maps every HKWorkoutActivityType integer (per kingstinct's enum, which
// matches Apple's docs) to one of the 15 platform-level categories.
//
// New HK types added in future iOS versions fall through to 'other' until
// the table is updated.

export const ACTIVITY_CATEGORIES = [
  "running",
  "walking",
  "hiking",
  "cycling",
  "swimming",
  "strength_training",
  "yoga",
  "pilates",
  "hiit",
  "climbing",
  "rowing",
  "team_sports",
  "racquet_sports",
  "dance",
  "other",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const CATEGORY_DISPLAY_NAMES: Record<ActivityCategory, string> = {
  running: "Running",
  walking: "Walking",
  hiking: "Hiking",
  cycling: "Cycling",
  swimming: "Swimming",
  strength_training: "Strength Training",
  yoga: "Yoga",
  pilates: "Pilates",
  hiit: "HIIT",
  climbing: "Climbing",
  rowing: "Rowing",
  team_sports: "Team Sports",
  racquet_sports: "Racquet Sports",
  dance: "Dance",
  other: "Other",
};

// Apple's HKWorkoutActivityType integer → category. Comments name the HK
// enum case for grep-ability when iOS adds new values.
const HK_TYPE_TO_CATEGORY: Record<number, ActivityCategory> = {
  1: "team_sports",        // americanFootball
  2: "other",              // archery
  3: "team_sports",        // australianFootball
  4: "racquet_sports",     // badminton
  5: "team_sports",        // baseball
  6: "team_sports",        // basketball
  7: "other",              // bowling
  8: "hiit",               // boxing
  9: "climbing",           // climbing
  10: "team_sports",       // cricket
  11: "strength_training", // crossTraining
  12: "other",             // curling
  13: "cycling",           // cycling
  14: "dance",             // dance
  15: "dance",             // danceInspiredTraining
  16: "other",             // elliptical
  17: "other",             // equestrianSports
  18: "other",             // fencing
  19: "other",             // fishing
  20: "strength_training", // functionalStrengthTraining
  21: "other",             // golf
  22: "other",             // gymnastics
  23: "team_sports",       // handball
  24: "hiking",            // hiking
  25: "team_sports",       // hockey
  26: "other",             // hunting
  27: "team_sports",       // lacrosse
  28: "hiit",              // martialArts
  29: "yoga",              // mindAndBody
  30: "hiit",              // mixedMetabolicCardioTraining
  31: "racquet_sports",    // paddleSports
  32: "other",             // play
  33: "other",             // preparationAndRecovery
  34: "racquet_sports",    // racquetball
  35: "rowing",            // rowing
  36: "team_sports",       // rugby
  37: "running",           // running
  38: "other",             // sailing
  39: "other",             // skatingSports
  40: "other",             // snowSports
  41: "team_sports",       // soccer
  42: "team_sports",       // softball
  43: "racquet_sports",    // squash
  44: "other",             // stairClimbing
  45: "other",             // surfingSports
  46: "swimming",          // swimming
  47: "racquet_sports",    // tableTennis
  48: "racquet_sports",    // tennis
  49: "running",           // trackAndField
  50: "strength_training", // traditionalStrengthTraining
  51: "team_sports",       // volleyball
  52: "walking",           // walking
  53: "swimming",          // waterFitness
  54: "team_sports",       // waterPolo
  55: "other",             // waterSports
  56: "hiit",              // wrestling
  57: "yoga",              // yoga
  58: "dance",             // barre
  59: "strength_training", // coreTraining
  60: "other",             // crossCountrySkiing
  61: "other",             // downhillSkiing
  62: "yoga",              // flexibility
  63: "hiit",              // highIntensityIntervalTraining
  64: "hiit",              // jumpRope
  65: "hiit",              // kickboxing
  66: "pilates",           // pilates
  67: "other",             // snowboarding
  68: "other",             // stairs
  69: "other",             // stepTraining
  70: "walking",           // wheelchairWalkPace
  71: "running",           // wheelchairRunPace
  72: "hiit",              // taiChi
  73: "hiit",              // mixedCardio
  74: "cycling",           // handCycling
  75: "other",             // discSports
  76: "other",             // fitnessGaming
  77: "dance",             // cardioDance
  78: "dance",             // socialDance
  79: "racquet_sports",    // pickleball
  80: "other",             // cooldown
  // 81 is unused in Apple's enum
  82: "swimming",          // swimBikeRun (triathlon — defaults to first leg)
  83: "other",             // transition
  84: "swimming",          // underwaterDiving
  3000: "other",           // other
};

export function getCategoryFromHKType(
  hkType: number | null | undefined,
): ActivityCategory {
  if (hkType == null) return "other";
  return HK_TYPE_TO_CATEGORY[hkType] ?? "other";
}

// Five sensible defaults if the user skips the onboarding category step.
// Five (not six) intentionally — leaves one Quick Select slot empty so the
// "tap + to add more" hint has somewhere to land.
export const DEFAULT_QUICK_SELECT: readonly ActivityCategory[] = [
  "running",
  "strength_training",
  "yoga",
  "cycling",
  "walking",
];
