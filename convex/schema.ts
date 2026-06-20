import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Db Cinema Rentals v2 — standalone storefront schema.
 *
 * Three-layer availability model (SPEC §2):
 *   inventory_units (physical, quantity truth)
 *     ← listings (buyable bundles draw on units via a BOM)
 *       ← reservations (the single availability ledger; every hold from any
 *          source — site bookings, subscriptions, and Hygglo/RMv2 mirror)
 *
 * RMv2 (hearty-oyster-600) is the upstream availability source of truth; its
 * Hygglo reservations are mirrored into `reservations` (source:"hygglo") by a
 * Trigger sync job through an httpAction bridge. `rmv2_sync_state` tracks it.
 */
export default defineSchema({
  // ── Layer 1: physical stock (quantity truth) ──────────────────
  inventory_units: defineTable({
    sku: v.string(),
    name: v.string(),
    quantityOwned: v.number(),
    replacementCost: v.number(), // for deposit / value-cap math
    condition: v.optional(v.string()),
    category: v.optional(v.string()),
    rmv2ItemId: v.optional(v.string()), // link back to RMv2 items table
    hyggloProductId: v.optional(v.number()),
    active: v.boolean(),
  })
    .index("by_sku", ["sku"])
    .index("by_rmv2ItemId", ["rmv2ItemId"])
    .index("by_hyggloProductId", ["hyggloProductId"]),

  // ── Layer 2: buyable bundles (the product) ────────────────────
  listings: defineTable({
    slug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    category: v.string(),
    itemType: v.optional(v.string()),
    isPackage: v.optional(v.boolean()),
    knowledge: v.optional(v.any()),
    specs: v.optional(v.object({ mount: v.optional(v.string()), filterThreadMm: v.optional(v.number()), batteryType: v.optional(v.string()), includesLens: v.optional(v.boolean()), lensFocal: v.optional(v.string()), tier: v.optional(v.string()), lensClass: v.optional(v.string()), hasAutofocus: v.optional(v.boolean()) })),
    sizeScore: v.optional(v.number()),
    weightKg: v.optional(v.number()),
    heroImageR2Key: v.optional(v.string()),
    gallery: v.optional(v.array(v.string())),
    sourceImages: v.optional(v.array(v.string())),
    r2Images: v.optional(v.array(v.string())),
    pricing: v.object({
      daily: v.number(),
      day3: v.optional(v.number()),
      day7: v.optional(v.number()),
      day14: v.optional(v.number()),
      day30: v.optional(v.number()),
    }),
    depositAmount: v.number(),
    // bill-of-materials: which physical units this bundle consumes
    components: v.array(
      v.object({
        inventoryUnitId: v.id("inventory_units"),
        qty: v.number(),
      }),
    ),
    hyggloListingSlug: v.optional(v.string()),
    hyggloProductId: v.optional(v.number()),
    demandScore: v.optional(v.number()), // rental-history demand (set by sync.applyDemand)
    suppressed: v.optional(v.boolean()), // local marketing-only override — kept inactive every sync
    unavailableDates: v.optional(v.array(v.string())),
    publicUrl: v.optional(v.string()),
    minimumRentalDays: v.optional(v.number()),
    featured: v.optional(v.boolean()),
    active: v.boolean(),
  })
    .index("by_slug", ["slug"])
    .index("by_category", ["category"])
    .index("by_active", ["active"]),

  // ── Layer 3: the availability ledger (double-booking guard) ───
  reservations: defineTable({
    inventoryUnitId: v.id("inventory_units"),
    listingId: v.optional(v.id("listings")),
    bookingId: v.optional(v.id("bookings")),
    subscriptionId: v.optional(v.id("subscriptions")),
    start: v.number(), // epoch ms (UTC)
    end: v.number(),
    qty: v.number(),
    source: v.union(
      v.literal("site"),
      v.literal("subscription"),
      v.literal("hygglo"),
    ),
    status: v.union(
      v.literal("hold"), // soft cart TTL hold
      v.literal("confirmed"),
      v.literal("active"),
      v.literal("returned"),
      v.literal("cancelled"),
    ),
    holdExpiresAt: v.optional(v.number()),
    externalRef: v.optional(v.string()), // Hygglo order id when source=hygglo
  })
    .index("by_unit", ["inventoryUnitId"])
    .index("by_unit_and_start", ["inventoryUnitId", "start"])
    .index("by_booking", ["bookingId"])
    .index("by_source", ["source"])
    .index("by_status", ["status"]),

  // ── Commerce ──────────────────────────────────────────────────
  carts: defineTable({
    customerId: v.optional(v.id("customers")),
    guestToken: v.optional(v.string()), // anonymous cart key (cookie)
    lineItems: v.array(
      v.object({
        listingId: v.id("listings"),
        start: v.number(),
        end: v.number(),
        qty: v.number(),
      }),
    ),
    expiresAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_guestToken", ["guestToken"]),

  bookings: defineTable({
    customerId: v.optional(v.id("customers")),
    guestEmail: v.optional(v.string()),
    status: v.union(
      v.literal("pending_payment"),
      v.literal("confirmed"),
      v.literal("active"),
      v.literal("returned"),
      v.literal("cancelled"),
    ),
    lineItems: v.array(
      v.object({
        listingId: v.id("listings"),
        title: v.string(),
        start: v.number(),
        end: v.number(),
        qty: v.number(),
        lineTotal: v.number(),
      }),
    ),
    fulfilment: v.union(v.literal("pickup"), v.literal("delivery")),
    address: v.optional(v.string()),
    deliveryFee: v.number(),
    subtotal: v.number(),
    promoCode: v.optional(v.string()),
    discount: v.number(),
    depositAmount: v.number(),
    total: v.number(),
    currency: v.string(), // "GBP"
    stripePaymentIntentId: v.optional(v.string()),
    stripeDepositIntentId: v.optional(v.string()),
    idVerifyStatus: v.optional(v.string()),
    depositRefunded: v.optional(v.boolean()),
    agreementSignedAt: v.optional(v.number()),
    agreementName: v.optional(v.string()),
    agreementDocs: v.optional(
      v.array(v.object({ kind: v.string(), version: v.string() })),
    ),
    stripeIdentitySessionId: v.optional(v.string()),
    remindedPickup: v.optional(v.boolean()),
    remindedReturn: v.optional(v.boolean()),
    remindedReview: v.optional(v.boolean()),
    protection: v.optional(v.string()),
    pickupTime: v.optional(v.string()),
    returnTime: v.optional(v.string()),
  })
    .index("by_customer", ["customerId"])
    .index("by_status", ["status"])
    .index("by_stripePaymentIntentId", ["stripePaymentIntentId"])
    .index("by_guestEmail", ["guestEmail"]),

  customers: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    savedAddress: v.optional(v.string()),
    idVerified: v.optional(v.boolean()),
    stripeCustomerId: v.optional(v.string()),
  }).index("by_email", ["email"]),

  // ── Reviews (Hygglo seed + native post-rental) ────────────────
  reviews: defineTable({
    listingId: v.optional(v.id("listings")),
    source: v.union(v.literal("hygglo"), v.literal("native")),
    author: v.string(),
    authorImage: v.optional(v.string()),
    product: v.optional(v.string()),
    hyggloReviewId: v.optional(v.number()),
    listingSlug: v.optional(v.string()),
    rating: v.number(),
    text: v.optional(v.string()),
    date: v.number(),
    verifiedBookingId: v.optional(v.id("bookings")),
    published: v.boolean(),
  })
    .index("by_listing", ["listingId"])
    .index("by_published", ["published"]),

  // ── Pricing / promos ──────────────────────────────────────────
  promo_codes: defineTable({
    code: v.string(),
    type: v.union(v.literal("percent"), v.literal("fixed")),
    value: v.number(),
    expiry: v.optional(v.number()),
    maxUses: v.optional(v.number()),
    usedCount: v.number(),
    memberOnly: v.optional(v.boolean()),
    minTier: v.optional(v.string()),
    onceOnly: v.optional(v.boolean()),
    monthly: v.optional(v.boolean()),
    minSubtotal: v.optional(v.number()),
    active: v.boolean(),
  }).index("by_code", ["code"]),

  // ── Subscriptions (value-cap tiers) ───────────────────────────
  subscription_tiers: defineTable({
    name: v.string(), // Indie / Pro / Studio
    monthlyPrice: v.number(),
    valueCapReplacement: v.number(),
    maxItems: v.optional(v.number()),
    perDayDiscountPct: v.number(),
    perks: v.array(v.string()),
    stripePriceId: v.optional(v.string()),
    active: v.boolean(),
  }).index("by_name", ["name"]),

  subscriptions: defineTable({
    customerId: v.id("customers"),
    tierId: v.id("subscription_tiers"),
    status: v.union(
      v.literal("active"),
      v.literal("past_due"),
      v.literal("cancelled"),
    ),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    stripeSubscriptionId: v.optional(v.string()),
    depositIntentId: v.optional(v.string()),
  })
    .index("by_customer", ["customerId"])
    .index("by_status", ["status"]),

  subscription_selections: defineTable({
    subscriptionId: v.id("subscriptions"),
    listingIds: v.array(v.id("listings")),
    periodStart: v.number(),
    locked: v.boolean(),
  }).index("by_subscription", ["subscriptionId"]),

  // ── Contact + legal ───────────────────────────────────────────
  contact_messages: defineTable({
    name: v.string(),
    email: v.string(),
    message: v.string(),
    routedTo: v.optional(v.string()),
    handled: v.boolean(),
  }).index("by_handled", ["handled"]),

  legal_docs: defineTable({
    kind: v.union(
      v.literal("terms"),
      v.literal("rental"),
      v.literal("privacy"),
      v.literal("cancellation"),
    ),
    version: v.number(),
    body: v.string(),
    publishedAt: v.optional(v.number()),
  }).index("by_kind", ["kind"]),

  // ── RMv2 availability bridge state ────────────────────────────
  accounts: defineTable({
    email: v.string(),
    salt: v.string(),
    hash: v.string(),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    marketingEmails: v.optional(v.boolean()),
    favorites: v.optional(v.array(v.string())),
    idVerified: v.optional(v.boolean()),
    stripeCustomerId: v.optional(v.string()),
    membershipTier: v.optional(v.string()),
    membershipActive: v.optional(v.boolean()),
    freeAccessoryMonth: v.optional(v.string()),
    freeAccessoryUsed: v.optional(v.number()),
    stripeSubscriptionId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  sessions: defineTable({
    token: v.string(),
    accountId: v.id("accounts"),
    createdAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()), // sessions past this are swept by cron (Convex queries can't read the clock)
  }).index("by_token", ["token"]).index("by_expiry", ["expiresAt"]),

  messages: defineTable({
    accountId: v.id("accounts"),
    bookingId: v.optional(v.id("bookings")),
    sender: v.union(v.literal("renter"), v.literal("bot"), v.literal("system")),
    text: v.string(),
    meta: v.optional(v.any()),
    at: v.number(),
    readByOwner: v.optional(v.boolean()),
  })
    .index("by_account", ["accountId"])
    .index("by_unread", ["sender", "readByOwner"]),

  promo_redemptions: defineTable({
    email: v.string(),
    code: v.string(),
    at: v.number(),
  }).index("by_email", ["email"]),

  member_offers: defineTable({
    title: v.string(),
    blurb: v.string(),
    badge: v.string(),
    code: v.string(),
    active: v.boolean(),
  }),

  events: defineTable({
    type: v.string(),
    path: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    at: v.number(),
  }).index("by_type", ["type"]),

  settings: defineTable({
    deliveryMarginPct: v.optional(v.number()),
    deliveryMaxKm: v.optional(v.number()),
    openingHours: v.optional(v.string()),
    acceptingOrders: v.optional(v.boolean()),
    googleReviewUrl: v.optional(v.string()),
    businessAddress: v.optional(v.string()),
    businessPhone: v.optional(v.string()),
  }),

  rmv2_sync_state: defineTable({
    key: v.string(), // e.g. "hygglo-availability"
    lastSyncedAt: v.number(),
    status: v.string(),
    cursor: v.optional(v.string()),
    note: v.optional(v.string()),
  }).index("by_key", ["key"]),
});
