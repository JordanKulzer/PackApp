/**
 * Pack — Copy / Strings
 * --------------------------------------------------------------------------
 * Centralized copy with wolf-flavored brand voice. Type-safe and grouped by
 * surface. Supports simple template interpolation via {variable} syntax.
 *
 * Path: constants/strings.ts
 *
 * Adoption strategy:
 *   - Don't refactor everything at once
 *   - When you touch a screen, replace its inline strings with strings.* refs
 *   - Settings, errors, and dry confirmations don't need to be packed —
 *     keep those clear and direct
 *
 * Voice rules (the four laws):
 *   1. Speak like a packmate, not a coach
 *   2. Group language over solo language ("the pack" beats "you")
 *   3. Show teeth, but stay warm
 *   4. Use pack vocabulary as nouns: den, hunt, howl, alpha, lone wolf,
 *      trail, scent. Don't force verbs.
 * --------------------------------------------------------------------------
 */

/* ============================================================
 * Onboarding
 * ============================================================ */
export const onboarding = {
  welcome: {
    // Personalized line — paired above the brand headline. Post-signup; we
    // already know the user's first name from CurrentUserContext.
    greeting: "Welcome, {firstName}.",
    headline: "Find your pack.",
    subhead:
      "Daily targets. Real accountability. Friends who actually show up.",
    cta: "Get started",
    skip: "Skip",
  },
  profile: {
    // Surface clarity wins here over wolf metaphor — onboarding's profile
    // step is mechanically about setting up identity, and "running with
    // the pack" reads as a running-app reference.
    headline: "Set up your profile.",
    subhead: "Your name and photo show up in your packs.",
    nameLabel: "Your name",
    namePlaceholder: "First name",
    avatarLabel: "Pick an avatar",
    cta: "Continue",
  },
  integrations: {
    headline: "Connect your data.",
    subhead:
      "Pack reads from Apple Health so you don't have to log everything by hand.",
    healthkitCta: "Connect Apple Health",
    skipForNow: "Maybe later",
    // Small helper line below the skip link — preserves the "you can opt
    // for manual" affordance hint that the original verbose copy carried.
    skipHint: "You can always log activities by hand.",
  },
  firstPack: {
    headline: "Start your pack.",
    subhead:
      "You can invite people now or later. Pack works best at 3-5 people.",
    nameLabel: "Pack name",
    namePlaceholder: "e.g. Morning Crew",
    cta: "Start pack",
    joinExistingCta: "Run with an existing pack",
    // The actual current onboarding screen is a Create-or-Join choice, not
    // a name-input form. Keys above are kept for the create flow elsewhere
    // (pack/create.tsx); the lastStep.* set below drives the onboarding
    // last screen specifically.
    lastStep: {
      headline: "Join or start a pack.",
      subhead:
        "Pack works best in groups of 3-5. Start one, or run with one a friend already made.",
      createCta: "Start a pack",
      joinCta: "Use an invite code",
      skip: "Skip",
    },
  },
  // Onboarding category selection — pin the activities the user does most
  // often so they sit at the top of LogSheet's Quick Select.
  categorySelection: {
    headline: "Find your trails.",
    subhead: "Pick what you actually do. We'll keep them on top of the menu.",
    counter: "{count} of {max}",
    cta: "Continue",
    skip: "Skip",
  },
  // Notifications primer — runs after integrations, before first-pack.
  // Explains what Pack pushes look like so the iOS dialog lands with
  // in-app context rather than cold. Skipping leaves the OS permission
  // state undetermined so the user can opt in later from Settings.
  notifications: {
    headline: "Stay in the loop",
    subhead:
      "Pack uses notifications to keep you in the loop on what your friends are doing.",
    rows: {
      movementLabel: "Pack movement",
      movementDesc: "When friends hit goals, take the lead, or pass you.",
      streakLabel: "Streak alerts",
      streakDesc: "A heads-up before your streak breaks.",
      chatLabel: "Replies & reactions",
      chatDesc: "When packmates react to your activity or message.",
    },
    cta: "Turn on notifications",
    skipForNow: "Maybe later",
    skipHint: "You can turn these on later in Settings.",
    skip: "Skip",
  },
} as const;

/* ============================================================
 * Auth — sign-in and sign-up taglines
 * ============================================================ */
export const auth = {
  signIn: {
    // Echoes welcome's "Find your pack." Returning users land back in
    // the same brand frame they signed up under.
    tagline: "Find your pack. Compete together.",
  },
  signUp: {
    // Inverted form of "Find your pack." — explicit invitation.
    tagline: "Join the pack.",
  },
} as const;

/* ============================================================
 * Forgot password — request + reset screens (Pass 13)
 *
 * TODO(voice-review): all copy below is placeholder. The forgot-password
 * surfaces ship with functional but un-voiced strings; a future copy
 * pass will polish alongside other UX strings. Single grep target:
 * `forgotPassword` references reach all of these.
 * ============================================================ */
export const forgotPassword = {
  // Link rendered below the password field on the sign-in screen.
  signInLink: "Forgot password?",

  // Request screen — user enters email to receive the reset link.
  request: {
    headline: "Reset your password",
    body: "Enter your email and we'll send a reset link.",
    placeholder: "Email",
    submit: "Send reset link",
    submitting: "Sending...",
    successHeadline: "Check your inbox",
    // {email} is interpolated via the t() helper at the call site.
    successBody: "We sent a password reset link to {email}.",
    resend: "Resend",
    backToSignIn: "Back to sign in",
  },

  // Reset screen — deep-link target after user taps the email link.
  // verifyOtp runs on mount; on success the new-password form renders.
  reset: {
    headline: "Set a new password",
    body: "Choose a strong password you'll remember.",
    newPasswordPlaceholder: "New password",
    confirmPasswordPlaceholder: "Confirm new password",
    submit: "Update password",
    submitting: "Updating...",
  },

  errors: {
    invalidEmail: "Enter a valid email address.",
    rateLimit: "Too many requests. Try again in a few minutes.",
    network: "Couldn't reach the server. Check your connection.",
    invalidLink:
      "This reset link is invalid or has expired. Request a new one.",
    passwordsDoNotMatch: "Passwords don't match.",
    passwordTooShort: "Password must be at least 8 characters.",
    generic: "Something went wrong. Try again.",
  },
} as const;

/* ============================================================
 * Profile — branded copy for the profile screen surface.
 * Most of profile is settings (out of scope per voice rules);
 * this section is for the few branded moments.
 * ============================================================ */
export const profile = {
  // Shown in place of the stats grid when the user has zero days logged.
  // Reveals the grid the moment any activity is recorded.
  emptyStatsHint: "Your trail starts when you log your first activity.",
} as const;

/* ============================================================
 * Packs list / home
 * ============================================================ */
export const packs = {
  title: "Packs",
  newPackCta: "Start a pack",
  newPackShort: "+ New",
  joinCta: "Run with a pack",
  joinShort: "Join",

  empty: {
    headline: "A pack of one isn't a pack.",
    body: "Start your own or run with someone else's. Either way, you don't do this alone.",
    primaryCta: "Start your pack",
    secondaryCta: "Run with a pack →",
  },

  packCard: {
    membersOf: "{count} of {max}", // "4 of 10"
    streak: "{days} days on the trail",
    todayProgress: "Today's hunt: {complete} of {total}",
    quietPack: "Quiet trail today",
    // Used on the home Pack card to summarize "no one in the pack has logged
    // anything yet this week." Different timing scope from quietPack (which
    // is about today specifically).
    quietWeek: "Quiet trail this week",
  },
} as const;

/* ============================================================
 * Pack detail (the Den)
 * ============================================================ */
export const den = {
  title: "The Den",
  // TODO: den.tabs is currently unused. The pack detail screen renders three
  // tabs (Compete / Chat / History) which don't match this set. Reconcile in
  // a future cleanup pass — either align the tab IA with these names, or
  // replace this block with the actual labels and drop the breadcrumb.
  tabs: {
    today: "Today",
    standings: "Standings",
    feed: "Feed",
    settings: "Settings",
  },

  todaysHunt: {
    title: "Today's Hunt",
    allComplete: "The whole pack ate today.",
    partialComplete: "{complete} of {total} hit targets.",
    noneComplete: "Quiet trail. Be the first scent.",
    yoursLeft: "{count} hunts left",
  },

  feed: {
    empty: {
      headline: "Quiet trail today.",
      body: "No one's moved yet. Be the first scent.",
      cta: "Log activity",
    },
    reactCta: "Howl back",
    pickedUpScent: "Picked up {name}'s scent",
    quietPackmate: "{name} has been quiet for {days} days",
    howlAtCta: "Howl at {name}",
  },

  standings: {
    title: "Standings",
    alpha: "Alpha",
    you: "You",
    weeklyReset: "Resets {day}",
  },

  // History tab — empty states for the past-runs list and the per-week
  // detail sheet. Reuse packs.packCard.quietWeek for the in-sheet "no
  // activity recorded yet" summary state; no duplicate key here.
  history: {
    empty: {
      headline: "No weeks on the trail yet.",
      body: "Your weekly hunts will land here.",
    },
    weekDetail: {
      emptyDays: "Day-by-day stats land here as the pack moves.",
    },
  },

  // Solo-pack hero — shown when the user is the only member. Brand-on
  // copy regardless of pack size; we don't gate brand voice behind
  // pack-size, that creates a two-tier brand experience.
  solo: {
    heroTitle: "Build your pack",
    heroSubtitle: "Invite a friend. Pack runs better in twos.",
  },

  // Transfer-ownership confirmation dialog body. Brand voice applies to
  // relational/social narrative in confirmations; mechanical narrative
  // (what's deleted/lost) stays generic in the Leave/Delete dialogs.
  transferConfirm:
    "{name} will become the new alpha. You'll still be a packmate but won't be able to delete the pack.",
} as const;

/* ============================================================
 * Activity logging
 * ============================================================ */
export const activity = {
  logSheet: {
    title: "Log activity",
    types: {
      steps: "Steps",
      workout: "Workout",
      calories: "Calories burned",
      water: "Water",
    },
  },

  logged: {
    toast: "Logged. The pack saw.",
    streakContinued: "{days} days on the trail",
    firstOfDay: "First scent of the day",
    fullPackToast: "The whole pack ate tonight.",
  },

  streak: {
    // Singular variant for count===1 (avoid "1 days" grammar bug). Caller
    // picks which key via ternary on the count value.
    day: "1 day streak",
    days: "{count} day streak",
    dayOf: "Day {current} of {total}",
    inDanger: "{hours} hours left on the trail",
    broken: "Off the trail. Get back on.",
    multiplier: "{multiplier}× points",
  },
} as const;

/* ============================================================
 * Pack recap — high-emotion week-end surface. Headline is
 * branched on run shape; subtitle adds margin context.
 * ============================================================ */
export const recap = {
  liveCta: "This week's hunt is on →",

  // Branched headline. Caller computes which key to render based on
  // run shape. fullPackHit branch is reserved for Pass 7 (achievement
  // wiring) — once daily_scores is denormalized into a per-run flag,
  // the recap can read it directly.
  // TODO(Pass 7): wire fullPackHit branch once pack_runs.full_pack_hit
  //   denormalization or equivalent flag exists.
  headline: {
    fullPackHit: "The whole pack ate this week.",
    runaway: "{winner} ran away with it.",
    photoFinish: "Decided in the last day.",
    tiedAtTop: "Two-way tie at the top.",
    solo: "You ran solo this week.",
    default: "{winner} took the trail this week.",
  },

  subtitle: {
    // Winner name comes from the headline above; subtitle is just margin.
    margin: "Won by {pts} pts.",
    soloPts: "{pts} pts on the trail.",
  },
} as const;

/* ============================================================
 * Pulls, loaders, transitions
 * ============================================================ */
export const ui = {
  pullToRefresh: "Picking up scent…",
  loading: "Loading…",
  saving: "Saving…",
  retry: "Try again",
  done: "Done",
  cancel: "Cancel",
  back: "Back",
} as const;

/* ============================================================
 * Limits & paywall (freemium messaging)
 * ============================================================ */
export const paywall = {
  packLimit: {
    headline: "You've hit the free pack limit.",
    body: "2 packs is the free tier. Run with more for $2.99/mo or $0.99 for one extra slot.",
    proCta: "Go Pro",
    onetimeCta: "Add one slot · $0.99",
  },
  memberLimit: {
    headline: "Pack's at capacity.",
    body: "10 members is the free tier. Bigger pack? Go Pro.",
    proCta: "Go Pro",
  },
  pro: {
    title: "Pack Pro",
    perks: [
      "Unlimited packs",
      "Larger pack size limits",
      "Priority on new features",
    ],
    monthlyPrice: "$2.99/month",
    cancelAnytime: "Cancel anytime.",
  },
} as const;

/* ============================================================
 * Errors — keep these dry and clear, NOT packed
 * ============================================================ */
export const errors = {
  generic: "Something went wrong. Try again.",
  network: "Couldn't reach the server. Check your connection.",
  authRequired: "Please sign in to continue.",
  permissionDenied: "You don't have access to this.",
  notFound: "We couldn't find that.",
  inviteCodeInvalid: "Invalid invite code.",
  inviteCodeExpired: "This invite code has expired.",
} as const;

/* ============================================================
 * Pack Edit (Pass 20c) — placeholder copy, defer to voice review.
 * Goal-target changes queue for next run; name applies immediately.
 * `goalsApplyAt` uses {date} interpolation token consumed by t().
 * ============================================================ */
export const packEdit = {
  menu: {
    label: "Edit Pack",
  },
  screen: {
    title: "Edit Pack",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    nameLabel: "Pack Name",
    goalTargetsHeader: "Goal Targets · Applies {date}",
    stepTargetLabel: "Step Target",
    calorieTargetLabel: "Calorie Target",
    waterTargetLabel: "Water Target (oz)",
    // Orphan — section header now carries the queueing message. Kept for
    // potential future reuse (e.g., banner on Pack Detail).
    queueHint: "Goal changes apply at the start of next week's run.",
  },
  toast: {
    nameUpdated: "Pack name updated",
    goalsApplyAt: "Goal changes apply {date}",
    bothChanged: "Pack updated · Goals apply {date}",
    noChanges: "No changes",
  },
  validation: {
    stepRange: "Step target must be between 1,000 and 50,000",
    calorieRange: "Calorie target must be between 100 and 2,000",
    waterRange: "Water target must be between 16 and 256 oz",
    nameRequired: "Pack name can't be empty",
  },
} as const;

/* ============================================================
 * User Profile (Pass 21b) — placeholder copy, defer to voice review.
 * Public profile of any user the caller shares an active pack with.
 * Stats are scoped to shared packs only.
 * ============================================================ */
export const userProfile = {
  screen: {
    title: "Profile",
    close: "Close",
    memberSince: "Joined {date}",
  },
  stats: {
    // Pass 21c — streaks row + 2x2 fitness totals.
    currentStreakLabel: "Current Streak",
    bestStreakLabel: "Best Streak",
    stepsLabel: "steps",
    workoutsLabel: "workouts",
    caloriesLabel: "cal",
    waterLabel: "oz water",
    // Legacy — kept as orphans for old-client compat during rollout.
    // Mirrors the queueHint orphan precedent from Pass 20e.
    streakLabel: "Streak",
    pointsLabel: "Points",
    packsInCommonLabel: "Packs in common",
    // Self-view variant — when the caller is viewing their own profile.
    packsInCommonSelfLabel: "In packs",
  },
  // Footer text below the fitness grid (Pass 21c).
  // Singular/plural handled per-variant; self vs other variant per
  // D-FOOTER-COPY decision matrix.
  // Legacy (Pass 21c orphans — kept per Pass 20e precedent).
  footer: {
    otherOne: "1 pack in common",
    otherMany: "{count} packs in common",
    selfOne: "1 pack",
    selfMany: "{count} packs",
  },
  // Pass 21d additions — streak line + sectioned shared-packs/lifetime layout.
  streakLine: {
    dayStreak: "{count} day streak",
    bestSuffix: "best {count}",
  },
  section: {
    sharedPacks: "Shared packs",
    sharedPack: "Shared pack",
    yourPacks: "Your packs",
    yourPack: "Your pack",
    lifetime: "Lifetime",
  },
  headToHead: {
    ahead: "You +{count}",
    behind: "Behind {count}",
    tied: "Tied",
    noActiveRun: "No active run",
    // Voice review queue: alternatives "#2 of 5", "Rank 2 of 5", "2nd / 5".
    selfRank: "{rank}{ord} of {count}",
  },
  lifetime: {
    // TODO(voice review): Pass 22 added daysLogged for self-profile
    // 5-row stat-sheet. Public profile uses 4 rows (no daysLogged).
    daysLogged: "Days Logged",
    steps: "Steps",
    workouts: "Workouts",
    calories: "Calories burned",
    water: "Water",
  },
  disclosure: {
    moreFmt: "+ {count} more",
  },
  errors: {
    notVisible: "You don't share a pack with this user.",
    notFound: "Profile not found.",
    network: "Couldn't load profile. Try again.",
    retry: "Try again",
  },
} as const;

/* ============================================================
 * Achievements — full catalog
 * ============================================================ */
export interface Achievement {
  id: string;
  name: string;
  trigger: string; // human-readable description of how to earn it
  copy: string; // shown when unlocked
}

export const achievements: Record<string, Achievement> = {
  firstHowl: {
    id: "firstHowl",
    name: "First Howl",
    trigger: "First activity logged",
    copy: "Welcome to the pack.",
  },
  loneWolf: {
    id: "loneWolf",
    name: "Lone Wolf",
    trigger: "Hit daily targets in a pack of one",
    copy: "No pack to answer to but yourself. Respect.",
  },
  alpha: {
    id: "alpha",
    name: "Alpha",
    trigger: "Top of pack 4 weeks running",
    copy: "The pack moves because you do.",
  },
  denMother: {
    id: "denMother",
    name: "Den Mother",
    trigger: "Founded a pack of 5+ active members",
    copy: "You built this. They came.",
  },
  trailBlazer: {
    id: "trailBlazer",
    name: "Trail Blazer",
    trigger: "30-day streak",
    copy: "A month on the trail. Most don't make it past week two.",
  },
  packHunter: {
    id: "packHunter",
    name: "Pack Hunter",
    trigger: "All packmates hit targets same day",
    copy: "The whole pack ate today.",
  },
  howlInTheDark: {
    id: "howlInTheDark",
    name: "Howl in the Dark",
    trigger: "Logged activity before 6am",
    copy: "While the pack slept, you moved.",
  },
  longHunter: {
    id: "longHunter",
    name: "Long Hunter",
    trigger: "100-day streak",
    copy: "A hundred days. The trail goes on.",
  },
  scentTracker: {
    id: "scentTracker",
    name: "Scent Tracker",
    trigger: "Reacted to 50 packmate activities",
    copy: "You see your pack. They feel it.",
  },
  returnOfTheWolf: {
    id: "returnOfTheWolf",
    name: "Return of the Wolf",
    trigger: "Came back after a 14+ day gap",
    copy: "The pack waited. So did the trail.",
  },
  twoPack: {
    id: "twoPack",
    name: "Two-Pack",
    trigger: "Active in 2 packs simultaneously",
    copy: "Loyal to one, running with two.",
  },
  firstHowlHeard: {
    id: "firstHowlHeard",
    name: "First Howl Heard",
    trigger: "Got your first reaction from a packmate",
    copy: "Someone in your pack saw what you did.",
  },
};

/* ============================================================
 * Fallback strings — used when canonical data isn't available
 * at copy-build time. Lifted out of inline magic strings so a
 * future voice-review pass can grep one location.
 * ============================================================ */
export const fallbacks = {
  // Used when firing a `new_member` push from a join site whose useCurrentUser
  // context hasn't yet hydrated displayName (brand-new social signup race).
  // Reaches the recipient as the {name} interpolation in push.newMemberJoined.
  newMemberName: "A new packmate",
} as const;

/* ============================================================
 * Push notifications — generators (not static strings)
 * Each takes context and returns title + body for the push payload.
 *
 * SINGLE SOURCE OF TRUTH for push copy. The Deno mirror at
 * supabase/functions/_shared/push-strings.ts duplicates a subset
 * of these for the Edge Function. Keep both in sync — drift is a
 * real bug class.
 * ============================================================ */

export interface PushPayload {
  title: string;
  body: string;
}

export const push = {
  streakInDanger: (hoursLeft: number, streakDays: number): PushPayload => ({
    title: `${hoursLeft} hours left on the trail`,
    body: `Your pack is at a ${streakDays}-day streak. Don't be the one who breaks it.`,
  }),

  packmateLoggedEarly: (name: string, time: string): PushPayload => ({
    title: `${name}'s already moving`,
    body: `Picked up their scent at ${time}. Pack's hunting early today.`,
  }),

  packmateQuiet: (name: string, daysQuiet: number): PushPayload => ({
    title: `${name}'s been quiet`,
    body: `${daysQuiet} days off the trail. Howl at them?`,
  }),

  fullPackHitTargets: (packSize: number): PushPayload => ({
    title: "The whole pack ate tonight",
    body: `All ${packSize} of you hit targets. Rare.`,
  }),

  comeback: (daysAway: number): PushPayload => ({
    title: "Welcome back",
    body: `${daysAway} days off. The pack noticed. Trail's still here.`,
  }),

  achievementUnlocked: (
    achievementName: string,
    copy: string,
  ): PushPayload => ({
    title: `${achievementName} unlocked`,
    body: copy,
  }),

  newMemberJoined: (name: string, packName: string): PushPayload => ({
    title: "New blood in the pack",
    body: `${name} joined ${packName}.`,
  }),

  almostMemberLimit: (
    current: number,
    max: number,
    packName: string,
  ): PushPayload => ({
    title: `${packName} is filling up`,
    body: `${current} of ${max} slots taken.`,
  }),
};

/* ============================================================
 * Helper: simple template interpolation
 * Replaces {key} placeholders with values from a vars object.
 * ============================================================ */
export function t(
  template: string,
  vars: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key];
    return value !== undefined ? String(value) : `{${key}}`;
  });
}

// Usage examples:
// t(packs.packCard.membersOf, { count: 4, max: 10 })  → "4 of 10"
// t(activity.streak.days, { count: 8 })               → "8 day streak"
// t(den.feed.howlAtCta, { name: 'Sarah' })            → "Howl at Sarah"
