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
    rentalContents: v.optional(v.object({
      included:v.array(v.string()), optional:v.array(v.string()), excluded:v.array(v.string()), notes:v.array(v.string()),
      status:v.union(v.literal("documented"),v.literal("unknown")),
      sources:v.array(v.object({account:v.string(),productId:v.number(),url:v.string(),checkedAt:v.number(),excerpt:v.string()})),
    })),
    specs: v.optional(v.object({ mount: v.optional(v.string()), filterThreadMm: v.optional(v.number()), batteryType: v.optional(v.string()), includesLens: v.optional(v.boolean()), lensFocal: v.optional(v.string()), tier: v.optional(v.string()), lensClass: v.optional(v.string()), hasAutofocus: v.optional(v.boolean()), coverage: v.optional(v.string()) })),
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
    quietDeal: v.optional(v.number()), // % off — auto-set on genuinely-idle items (catalog.refreshQuietDeals)
    suppressed: v.optional(v.boolean()), // local marketing-only override — kept inactive every sync
    unavailableDates: v.optional(v.array(v.string())),
    publicUrl: v.optional(v.string()),
    minimumRentalDays: v.optional(v.number()),
    featured: v.optional(v.boolean()),
    active: v.boolean(),
  })
    .index("by_slug", ["slug"])
    .index("by_category", ["category"])
    .index("by_active", ["active"])
    .index("by_hyggloProductId", ["hyggloProductId"]),

  // ── Layer 3: the availability ledger (double-booking guard) ───
  rental_change_requests: defineTable({
    requestId: v.string(), accountId: v.id("accounts"), bookingId: v.id("bookings"),
    kind: v.union(v.literal("dates"), v.literal("items"), v.literal("extension"), v.literal("cancel")),
    detail: v.string(), messageId: v.id("messages"), createdAt: v.number(),
  }).index("by_request", ["requestId"]).index("by_account", ["accountId"]),
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
    pricingVersion: v.optional(v.string()),benefitKind:v.optional(v.string()),
    refundCreditApplied:v.optional(v.number()),earnedCreditApplied:v.optional(v.number()),
    creditAllocations:v.optional(v.array(v.object({creditId:v.id("credits"),amount:v.number(),kind:v.union(v.literal("refund"),v.literal("earned"))}))),
    referralCode:v.optional(v.string()),referralRedemptionId:v.optional(v.id("referral_redemptions")),referralRewardId:v.optional(v.id("referral_rewards")),referralPaymentHash:v.optional(v.string()),
    membershipCheckoutId: v.optional(v.id("membership_checkouts")),
    rentalPaidPence: v.optional(v.number()),
    accountCreatedAtCheckout: v.optional(v.boolean()),
    accountAccessEmailSentAt: v.optional(v.number()),
    accountAccessRequired: v.optional(v.boolean()),
    deliveryBenefitAccountId: v.optional(v.id("accounts")),
    deliveryBenefitMonth: v.optional(v.string()),
    deliveryBenefitConsumed: v.optional(v.boolean()),
    securityWaiverReason: v.optional(v.string()),
    repeatSourceBookingId: v.optional(v.id("bookings")),
    repeatSourceFingerprint: v.optional(v.string()),
    pickedUpAt: v.optional(v.number()),
    checkoutExpiredAt: v.optional(v.number()),
    activeAdditionId:v.optional(v.id("rental_additions")),
    chatConfirmationMessageId: v.optional(v.id("messages")),
    chatUpdatedAt:v.optional(v.number()),chatUnreadOwner:v.optional(v.number()),chatUnreadRenter:v.optional(v.number()),
    cancellationDecision:v.optional(v.object({
      kind:v.union(v.literal("full_refund"),v.literal("store_credit")),createdAt:v.number(),
      fullCreditOfferId: v.optional(v.id("rental_credit_offers")),
      quote:v.optional(v.object({mode:v.union(v.literal("none"),v.literal("refund"),v.literal("credit")),refundAmount:v.number(),creditAmount:v.number(),paymentIntentId:v.optional(v.string()),allocations:v.optional(v.array(v.object({paymentIntentId:v.string(),amountPence:v.number()})))})),
    })),
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
        dailyRate: v.optional(v.number()),
      }),
    ),
    removedItems: v.optional(v.array(v.object({ listingId: v.id("listings"), title: v.string(), start: v.number(), end: v.number(), qty: v.number(), lineTotal: v.number(), removedAt: v.number(), reason: v.string(), requestId: v.string() }))),
    cancellationPolicyStart: v.optional(v.number()),
    fulfilment: v.union(v.literal("pickup"), v.literal("delivery")),
    address: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    deliveryFee: v.number(),
    subtotal: v.number(),
    promoCode: v.optional(v.string()),
    discount: v.number(),
    depositAmount: v.number(),
    depositHoldAmount: v.optional(v.number()),
    depositHoldStatus: v.optional(v.string()),
    depositHoldExpiresAt: v.optional(v.number()),
    depositHoldRenewalIntentId: v.optional(v.string()),
    depositHoldRenewalStatus: v.optional(v.string()),
    depositHoldRenewalAt: v.optional(v.number()),
    depositHoldPreviousIntentIds: v.optional(v.array(v.string())),
    total: v.number(),
    currency: v.string(), // "GBP"
    stripePaymentIntentId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeDepositIntentId: v.optional(v.string()),
    diditSessionId: v.optional(v.string()),
    diditEventId: v.optional(v.string()),
    diditEventAt: v.optional(v.number()),
    diditManualDecisionAt: v.optional(v.number()),
    diditReconciledAt: v.optional(v.number()),
    verificationProvider: v.optional(v.string()),
    verificationNote: v.optional(v.string()),
    verificationUpdatedAt: v.optional(v.number()),
    idVerifyStatus: v.optional(v.string()),
    idVerificationSource: v.optional(v.string()),
    idVerifiedAt: v.optional(v.number()),
    verificationExpiresAt: v.optional(v.number()),
    documentExpiresAt: v.optional(v.number()),
    verificationReusedFrom: v.optional(v.id("bookings")),
    depositRefunded: v.optional(v.boolean()),
    agreementSignedAt: v.optional(v.number()),
    securityHoldConsentAt: v.optional(v.number()),
    securityPolicyVersion: v.optional(v.string()),
    laterChargeConsentAt: v.optional(v.number()),
    agreementName: v.optional(v.string()),
    agreementDocs: v.optional(
      v.array(v.object({ kind: v.string(), version: v.string() })),
    ),
    stripeIdentitySessionId: v.optional(v.string()),
    remindedPickup: v.optional(v.boolean()),
    remindedReturn: v.optional(v.boolean()),
    remindedReview: v.optional(v.boolean()),
    reviewFollowUpStatus: v.optional(v.string()),
    reviewFollowUpReason: v.optional(v.string()),
    reviewFollowUpCheckedAt: v.optional(v.number()),
    reviewRefundConfirmedAt: v.optional(v.number()),
    reviewEligibilityFingerprint: v.optional(v.string()),
    reviewEligibilityCheckedAt: v.optional(v.number()),
    reviewInvitationMessageId: v.optional(v.id("messages")),
    reviewFollowUpDueAt: v.optional(v.number()),
    reviewFollowUpSentAt: v.optional(v.number()),
    protection: v.optional(v.string()),
    pickupTime: v.optional(v.string()),
    returnTime: v.optional(v.string()),
    // customer self-service cancellation bookkeeping (Phase 3)
    cancelledAt: v.optional(v.number()),
    adminCancellationReason: v.optional(v.string()),
    refundAmount: v.optional(v.number()),
    creditIssuedId: v.optional(v.id("credits")),
    creditApplied: v.optional(v.number()), // store credit redeemed at checkout (decremented on confirm)
    membershipCreditApplied: v.optional(v.number()), // first paid invoice credit spent in this checkout
    membershipCreditGrantId: v.optional(v.id("membership_credit_grants")),
    membershipSignupOfferSaving: v.optional(v.number()),
    starterOfferSaving: v.optional(v.number()), // accepted legacy receipts
    depositKept: v.optional(v.number()), // portion of the deposit retained for damage on return
    depositRefundAmount: v.optional(v.number()),
    depositHoldCapturedForDamage: v.optional(v.number()),
    depositDeductionNote: v.optional(v.string()),
    damageNoticeSentAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()), // when the rental was marked returned + deposit released
    actualReturnedAt: v.optional(v.number()),
    returnDecision: v.optional(v.object({
      actualReturnedAt: v.number(), damageKept: v.number(),
      damageNote: v.optional(v.string()), chargeLate: v.boolean(),
      lateWaiverReason: v.optional(v.string()), startedAt: v.number(),
    })),
    lateFeeAmount: v.optional(v.number()),
    lateFeeWaivedAmount: v.optional(v.number()),
    lateFeeWaiverReason: v.optional(v.string()),
    lateFeeStatus: v.optional(v.string()),
    lateFeeNoticeAt: v.optional(v.number()),
    lateFeeNoticeAttemptAt: v.optional(v.number()),
    lateFeeChargingAt: v.optional(v.number()),
    lateFeeIntentId: v.optional(v.string()),
    lateFeePaidFromHold: v.optional(v.number()),
    lateFeePaidFromCard: v.optional(v.number()),
    lateFeeReceiptEmailStatus: v.optional(v.string()),
    lateFeeReceiptEmailAttemptAt: v.optional(v.number()),
    lateFeeReceiptEmailedAt: v.optional(v.number()),
    lateFeeNote: v.optional(v.string()),
    lateFeeBreakdown: v.optional(v.array(v.object({ title: v.string(), days: v.number(), dailyRate: v.number(), amount: v.number() }))),
    returnStatement: v.optional(v.object({
      number: v.string(), issuedAt: v.number(), actualReturnedAt: v.number(),
      agreedReturnTime: v.optional(v.string()),
      supplierName: v.string(), supplierAddress: v.optional(v.string()),
      customerName: v.optional(v.string()), customerEmail: v.string(), billingAddress: v.optional(v.string()),
      lineItems: v.array(v.object({ title: v.string(), start: v.number(), end: v.number(), qty: v.number(), lineTotal: v.number() })),
      subtotal: v.number(), discount: v.number(), deliveryFee: v.number(), creditApplied: v.number(),
      checkoutPaid: v.number(), rentalRefunded:v.optional(v.number()), securityPaid: v.number(), securityRefunded: v.number(),
      holdStatus: v.optional(v.string()),
      damageTotal: v.number(), damageFromHold: v.number(), damageNote: v.optional(v.string()),
      lateAssessed: v.number(), lateWaived: v.number(),
      lateBreakdown: v.array(v.object({ title: v.string(), days: v.number(), dailyRate: v.number(), amount: v.number() })),
    })),
    returnStatementEmailStatus: v.optional(v.string()),
    returnStatementEmailAttemptAt: v.optional(v.number()),
    returnStatementEmailedAt: v.optional(v.number()),
  })
    .index("by_customer", ["customerId"])
    .index("by_chat_updated",["chatUpdatedAt"])
    .index("by_status_chat_updated",["status","chatUpdatedAt"])
    .index("by_guest_chat_updated",["guestEmail","chatUpdatedAt"])
    .index("by_owner_unread_updated",["chatUnreadOwner","chatUpdatedAt"])
    .index("by_status", ["status"])
    .index("by_verificationProvider_status", ["verificationProvider", "status"])
    .index("by_verification_reused", ["verificationReusedFrom"])
    .index("by_stripePaymentIntentId", ["stripePaymentIntentId"])
    .index("by_guestEmail", ["guestEmail"])
    .index("by_review_check", ["status", "reviewFollowUpCheckedAt"]),

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
    authorAccountId: v.optional(v.id("accounts")),
    product: v.optional(v.string()),
    hyggloReviewId: v.optional(v.number()),
    listingSlug: v.optional(v.string()),
    rating: v.number(),
    text: v.optional(v.string()),
    date: v.number(),
    verifiedBookingId: v.optional(v.id("bookings")),
    published: v.boolean(),
    incentivized: v.optional(v.boolean()),
  })
    .index("by_listing", ["listingId"])
    .index("by_booking", ["verifiedBookingId"])
    .index("by_published", ["published"]),

  // ── Crew for hire (booked THROUGH us — first name only, keep the middleman) ──
  review_prize_evidence: defineTable({storageId:v.id("_storage"),accountId:v.id("accounts"),claimedAt:v.number()}).index("by_storage",["storageId"]),
  review_prize_entries: defineTable({
    accountId:v.id("accounts"),bookingId:v.id("bookings"),reviewId:v.id("reviews"),roundKey:v.string(),
    story:v.string(),socialHandle:v.string(),postUrl:v.string(),evidenceStorageId:v.id("_storage"),
    status:v.string(),termsVersion:v.string(),followDeclared:v.boolean(),disclosureDeclared:v.boolean(),
    submittedAt:v.number(),updatedAt:v.number(),socialVerifiedAt:v.optional(v.number()),verificationNote:v.optional(v.string()),
    originality:v.optional(v.number()),craft:v.optional(v.number()),clarity:v.optional(v.number()),judgeName:v.optional(v.string()),judgingNote:v.optional(v.string()),judgedAt:v.optional(v.number()),
  }).index("by_round",["roundKey"]).index("by_booking",["bookingId"]).index("by_account",["accountId"]).index("by_post",["postUrl"]),
  review_prize_rounds: defineTable({
    key:v.string(),deadline:v.number(),announceBy:v.number(),payBy:v.number(),status:v.string(),
    winnerEntryId:v.optional(v.id("review_prize_entries")),selectedAt:v.optional(v.number()),winnerNotifiedAt:v.optional(v.number()),
    paidAt:v.optional(v.number()),paymentReference:v.optional(v.string()),
    reminderStage:v.optional(v.string()),mailLeaseUntil:v.optional(v.number()),mailAttempts:v.optional(v.number()),mailNextAt:v.optional(v.number()),
  }).index("by_key",["key"]),

  // ── Crew for hire (booked THROUGH us — first name only, keep the middleman) ──
  operators: defineTable({
    role: v.string(), // "cinematographer"
    roleLabel: v.string(), // "Cinematographer"
    firstName: v.string(),
    years: v.number(),
    age: v.optional(v.number()),
    tagline: v.string(),
    bio: v.optional(v.string()), // a few sentences for the expanded profile card
    tags: v.optional(v.array(v.string())), // quick descriptor chips
    headshot: v.optional(v.string()), // profile photo URL
    skills: v.array(v.string()),
    rateHourly: v.optional(v.number()),
    rateHalfDay: v.optional(v.number()),
    rateDay: v.optional(v.number()),
    portfolioUrl: v.optional(v.string()), // looping showreel preview (falls back to role clip)
    neon: v.string(), // hue key for the neon tile
    order: v.number(),
    active: v.boolean(),
  }).index("by_order", ["order"]),

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

  // ── Creative Collective applications (gear providers + professionals) ──
  // Nothing here is public until an admin approves it. Approving a
  // professional creates an `operators` row (first-name-only, booked through us).
  collective_applications: defineTable({
    kind: v.union(v.literal("gear-provider"), v.literal("professional")),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    // contact — internal only, never published
    fullName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    // professional profile
    role: v.optional(v.string()),
    roleLabel: v.optional(v.string()),
    firstName: v.optional(v.string()),
    years: v.optional(v.number()),
    age: v.optional(v.number()),
    tagline: v.optional(v.string()),
    bio: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    headshotStorageId: v.optional(v.id("_storage")),
    skills: v.optional(v.array(v.string())),
    rateHourly: v.optional(v.number()),
    rateHalfDay: v.optional(v.number()),
    rateDay: v.optional(v.number()),
    portfolio: v.optional(v.string()),
    // gear provider
    gearList: v.optional(v.string()),
    gearValue: v.optional(v.string()),
    agreementAccepted: v.optional(v.boolean()),
    // agreement + KYC (filled in onboarding / member profile)
    termsAgreed: v.optional(v.boolean()),
    bankAccountName: v.optional(v.string()),
    bankSortCode: v.optional(v.string()),
    bankAccountNumber: v.optional(v.string()),
    idStorageId: v.optional(v.id("_storage")),
    idStatus: v.optional(v.union(v.literal("none"), v.literal("submitted"), v.literal("verified"))),
    // shared
    notes: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    // complimentary membership grant (applied on approval — see convex/accounts.ts)
    grantedTier: v.optional(v.string()), // "pro" (professional) or "plus" (gear-provider)
    grantActive: v.optional(v.boolean()), // false once an admin deactivates the member
    operatorId: v.optional(v.id("operators")), // back-link to the roster row (professionals only)
  })
    .index("by_operator", ["operatorId"])
    .index("by_status", ["status"])
    .index("by_email", ["email"]),

  // ── RMv2 availability bridge state ────────────────────────────
  accounts: defineTable({
    membershipSignupOfferUsed: v.optional(v.boolean()),
    membershipPerksPendingBookingId: v.optional(v.id("bookings")),
    referralCode:v.optional(v.string()),referralFirstUsedAt:v.optional(v.number()),firstRentalPaidAt:v.optional(v.number()),referralRewardGrantedAt:v.optional(v.number()),referralRewardUsedAt:v.optional(v.number()),paymentIdentityHashes:v.optional(v.array(v.string())),
    loyaltyLevel:v.optional(v.number()),loyaltyCelebratedLevel:v.optional(v.number()),
    loyaltyUnlockedAt: v.optional(v.number()),
    loyaltyCelebratedAt: v.optional(v.number()),
    starterRentalOfferUsed: v.optional(v.boolean()), // accepted legacy receipts
    email: v.string(),
    salt: v.optional(v.string()), // optional: Google-only accounts have no password
    emailVerificationRequired: v.optional(v.boolean()),
    emailVerifiedAt: v.optional(v.number()),
    hash: v.optional(v.string()),
    googleId: v.optional(v.string()), // linked Google account (the OIDC `sub`)
    googleAvatarUrl: v.optional(v.string()), // Google profile photo, fallback when no uploaded avatar
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    marketingEmails: v.optional(v.boolean()),
    favorites: v.optional(v.array(v.string())),
    avatarStorageId: v.optional(v.id("_storage")), // profile photo (Convex storage)
    idVerified: v.optional(v.boolean()),
    rentalVerification: v.optional(v.object({ sourceBookingId: v.id("bookings"), name: v.string(), address: v.string(), verifiedAt: v.number(), expiresAt: v.number() })),
    idSessionId: v.optional(v.string()), // Stripe Identity session (account-level verification)
    stripeCustomerId: v.optional(v.string()),
    membershipTier: v.optional(v.string()),
    membershipActive: v.optional(v.boolean()),
    membershipStatus: v.optional(v.string()),
    membershipSubscriptionCreatedAt: v.optional(v.number()),
    checkoutSeedHash: v.optional(v.string()),
    membershipCreditDebtPence: v.optional(v.number()),
    membershipPaidThrough: v.optional(v.number()),
    membershipTrialEnd: v.optional(v.number()),
    membershipCancelAtPeriodEnd: v.optional(v.boolean()),
    membershipIntroUsed: v.optional(v.boolean()),
    membershipIntroChoice: v.optional(v.string()),
    membershipSource: v.optional(v.string()), // "collective-comp" = free grant from Creative Collective approval; undefined = real Stripe subscription
    freeAccessoryMonth: v.optional(v.string()),
    freeAccessoryUsed: v.optional(v.number()),
    stripeSubscriptionId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_email", ["email"]).index("by_referral_code",["referralCode"]).index("by_subscription", ["stripeSubscriptionId"]),

  sessions: defineTable({
    token: v.string(),
    accountId: v.id("accounts"),
    createdAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()), // sessions past this are swept by cron (Convex queries can't read the clock)
  }).index("by_token", ["token"]).index("by_expiry", ["expiresAt"]).index("by_account",["accountId"]),

  messages: defineTable({
    accountId: v.id("accounts"),
    bookingId: v.optional(v.id("bookings")),
    sender: v.union(v.literal("renter"), v.literal("bot"), v.literal("system"), v.literal("owner")),
    text: v.string(),
    meta: v.optional(v.any()),
    at: v.number(),
    readByOwner: v.optional(v.boolean()),
    threadCounted: v.optional(v.boolean()),
  })
    .index("by_account", ["accountId"])
    .index("by_unread", ["sender", "readByOwner"])
    .index("by_booking_at", ["bookingId", "at"])
    .index("by_account_at", ["accountId", "at"]),

  admin_push_subscriptions: defineTable({
    deviceId: v.string(), endpoint: v.string(), p256dh: v.string(), auth: v.string(),
    enabled: v.boolean(), createdAt: v.number(), updatedAt: v.number(), lastError: v.optional(v.string()),
  }).index("by_device", ["deviceId"]).index("by_enabled", ["enabled"]),
  admin_notifications: defineTable({
    eventKey: v.string(), kind: v.string(), accountId: v.id("accounts"), bookingId: v.optional(v.id("bookings")),
    title: v.string(), body: v.string(), createdAt: v.number(), read: v.boolean(),
  }).index("by_event", ["eventKey"]).index("by_read_created", ["read", "createdAt"])
    .index("by_account_booking_read", ["accountId", "bookingId", "read"]),
  admin_push_deliveries: defineTable({
    notificationId: v.id("admin_notifications"), subscriptionId: v.id("admin_push_subscriptions"),
    status: v.string(), attempts: v.number(), nextAttemptAt: v.number(), updatedAt: v.number(),
    claimId: v.optional(v.string()), claimedAt: v.optional(v.number()), lastError: v.optional(v.string()),
    subscriptionUpdatedAt: v.optional(v.number()),
  }).index("by_status_due", ["status", "nextAttemptAt"]),

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
    listingId: v.optional(v.string()), // for add_to_cart: which item
    title: v.optional(v.string()), // item name at add time (incl. marketing-only items)
    qty: v.optional(v.number()), // units added
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

  // ── Store credit (Phase 3) — issued on late cancellation, one-year expiry ──
  rental_credit_offers: defineTable({
    accountId: v.id("accounts"), bookingId: v.id("bookings"),
    amountPence: v.number(), fingerprint: v.string(), createdAt: v.number(), expiresAt: v.number(),
    status: v.union(v.literal("offered"), v.literal("accepted")),
    acceptedAt: v.optional(v.number()),
  }).index("by_booking", ["bookingId"]),
  credits: defineTable({
    accountId: v.id("accounts"),
    amount: v.number(), // original issued (GBP)
    remaining: v.number(), // after partial redemption
    currency: v.string(),
    kind:v.optional(v.union(v.literal("refund"),v.literal("earned"))),
    reason: v.string(), // e.g. "late_cancellation:<bookingId>"
    membershipInvoiceId: v.optional(v.string()),
    membershipGrantId: v.optional(v.id("membership_credit_grants")),
    revokedAmount: v.optional(v.number()),
    revokedPendingPence: v.optional(v.number()),
    bookingId: v.optional(v.id("bookings")),
    createdAt: v.number(),
    expiresAt: v.number(), // createdAt + 365d
    status: v.union(v.literal("active"), v.literal("spent"), v.literal("expired")),
  })
    .index("by_account", ["accountId"])
    .index("by_status", ["status"]),

  referral_redemptions:defineTable({referrerAccountId:v.id("accounts"),friendAccountId:v.id("accounts"),bookingId:v.id("bookings"),code:v.string(),discount:v.number(),state:v.union(v.literal("reserved"),v.literal("paid"),v.literal("qualified"),v.literal("void")),createdAt:v.number(),paidAt:v.optional(v.number()),qualifiedAt:v.optional(v.number()),paymentHash:v.optional(v.string()),rejectionReason:v.optional(v.string())}).index("by_friend",["friendAccountId"]).index("by_booking",["bookingId"]).index("by_referrer",["referrerAccountId"]).index("by_state",["state"]),
  referral_rewards:defineTable({accountId:v.id("accounts"),redemptionId:v.id("referral_redemptions"),percent:v.number(),state:v.union(v.literal("available"),v.literal("used"),v.literal("expired")),createdAt:v.number(),expiresAt:v.number(),reservedBookingId:v.optional(v.id("bookings")),usedBookingId:v.optional(v.id("bookings")),usedAt:v.optional(v.number())}).index("by_account",["accountId"]).index("by_state_expiry",["state","expiresAt"]),
  referral_campaigns:defineTable({createdAt:v.number(),enqueuedAt:v.optional(v.number()),status:v.union(v.literal("queued"),v.literal("complete"),v.literal("stopped")),recipientCount:v.number(),sent:v.number(),failed:v.number()}),
  referral_campaign_messages:defineTable({campaignId:v.id("referral_campaigns"),accountId:v.id("accounts"),state:v.union(v.literal("pending"),v.literal("sending"),v.literal("sent"),v.literal("stopped")),dueAt:v.number(),attempts:v.number(),leaseUntil:v.optional(v.number()),sentAt:v.optional(v.number())}).index("by_campaign_account",["campaignId","accountId"]).index("by_state_due",["state","dueAt"]),
  rental_additions:defineTable({
    bookingId:v.id("bookings"),requestId:v.string(),listingId:v.id("listings"),title:v.string(),
    start:v.number(),end:v.number(),qty:v.number(),dailyRate:v.number(),lineTotal:v.number(),
    complimentary:v.optional(v.boolean()),draftReplacement:v.optional(v.boolean()),baseTotal:v.optional(v.number()),baseSecurity:v.optional(v.number()),baseSessionId:v.optional(v.string()),
    membershipCheckoutId:v.optional(v.id("membership_checkouts")),membershipFee:v.optional(v.number()),membershipSessionParams:v.optional(v.string()),
    securityCharge:v.number(),holdTotal:v.number(),oldHoldId:v.optional(v.string()),
    status:v.string(),reason:v.string(),createdAt:v.number(),updatedAt:v.number(),
    sessionId:v.optional(v.string()),paymentUrl:v.optional(v.string()),paymentIntentId:v.optional(v.string()),
    holdIntentId:v.optional(v.string()),holdExpiresAt:v.optional(v.number()),
  }).index("by_booking",["bookingId"]).index("by_request",["requestId"]).index("by_session",["sessionId"]).index("by_status",["status"]).index("by_status_updated",["status","updatedAt"]),

  rental_refunds: defineTable({
    bookingId:v.id("bookings"),requestId:v.string(),amountPence:v.number(),reason:v.string(),
    status:v.union(v.literal("prepared"),v.literal("pending"),v.literal("succeeded"),v.literal("failed")),
    allocations:v.optional(v.array(v.object({paymentIntentId:v.string(),amountPence:v.number()}))),
    parts:v.optional(v.array(v.object({paymentIntentId:v.string(),stripeRefundId:v.string(),status:v.string(),amountPence:v.number()}))),
    stripeRefundId:v.optional(v.string()),createdAt:v.number(),updatedAt:v.number(),
  }).index("by_booking",["bookingId"]).index("by_request",["requestId"]),

  // ── Reschedule / item-level extend requests (Phase 3b) ──────────
  booking_change_requests: defineTable({
    bookingId: v.id("bookings"),
    accountId: v.id("accounts"),
    type: v.union(v.literal("reschedule"), v.literal("extend")),
    // which line items the change targets (empty/undefined = whole booking). Other items unchanged.
    lineItemIndexes: v.optional(v.array(v.number())),
    requestedStart: v.optional(v.number()), // reschedule
    requestedEnd: v.optional(v.number()), // reschedule
    extraDays: v.optional(v.number()), // extend
    note: v.optional(v.string()),
    status: v.union(
      v.literal("pending"), // awaiting admin
      v.literal("approved"), // reschedule applied directly
      v.literal("awaiting_payment"), // extend — pay-link issued
      v.literal("declined"),
      v.literal("applied"), // extend paid + applied
    ),
    priceDelta: v.optional(v.number()),
    stripePaymentLinkId: v.optional(v.string()),
    paymentLinkUrl: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_booking", ["bookingId"])
    .index("by_status", ["status"]),

  // ── Rental-chat escalation state (Phase 4: Gaffer AI + human handoff) ──
  chat_threads: defineTable({
    accountId: v.id("accounts"),
    bookingId: v.optional(v.id("bookings")),
    unreadOwner: v.optional(v.number()),
    unreadRenter: v.optional(v.number()),
    ownerReadAt: v.optional(v.number()),
    renterReadAt: v.optional(v.number()),
    lastMessage: v.optional(v.string()),
    lastSender: v.optional(v.string()),
    gafferReplyTo: v.optional(v.id("messages")),
    escalated: v.boolean(), // true → a human is handling it; Gaffer stops auto-replying
    tgMessageId: v.optional(v.number()), // the Telegram alert msg id (admin replies to it → thread)
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_tgMessageId", ["tgMessageId"])
    .index("by_account_booking", ["accountId", "bookingId"])
    .index("by_updated", ["updatedAt"]),

  // Fixed-window API rate limiting (per IP + bucket) for the public endpoints.
  rate_limits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // Audit trail for owner/admin passcode checks (mutation call sites only — Convex
  // queries can't write, so read-side checks aren't logged here).
  admin_audit_log: defineTable({
    at: v.number(),
    success: v.boolean(),
    limited: v.boolean(),
    fn: v.string(),
  }).index("by_at", ["at"]),

  // Every fetch of /api/swml/inbound by SignalWire, recorded so the inbound
  // phone path is observable without Vercel log access: a row here proves
  // SignalWire ran the call script, and its absence proves it never did.
  swml_hits: defineTable({
    at: v.number(),
    method: v.string(),
    ip: v.optional(v.string()),
    ua: v.optional(v.string()),
    detail: v.optional(v.string()), // JSON blob: query params + POST body
  }).index("by_at", ["at"]),

  // Written follow-ups Gaffer promised on a voice call.
  //
  // A call leaves the customer nothing to refer back to, so anything that needs
  // chasing has to land somewhere durable. `replyKey` is the thread handle: it
  // goes out in the reply-to address, and inbound replies are matched back on it
  // so an email answer continues the same conversation instead of arriving as an
  // orphan in the owner's inbox.
  gaffer_follow_ups: defineTable({
    at: v.number(),
    email: v.string(),
    name: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    replyKey: v.string(),
    // set once the caller turns into a registered customer, so their email
    // thread and their in-app chat are the same conversation
    accountId: v.optional(v.id("accounts")),
    direction: v.string(), // "out" (Gaffer -> customer) | "in" (customer reply)
    handled: v.boolean(),
  })
    .index("by_replyKey", ["replyKey"])
    .index("by_email", ["email"])
    .index("by_at", ["at"]),

  // "Notify me when available" requests for booked-out gear.
  availability_waitlist: defineTable({
    email: v.string(),
    listingId: v.id("listings"),
    listingTitle: v.string(),
    slug: v.string(),
    start: v.number(),
    end: v.number(),
    createdAt: v.number(),
    notified: v.boolean(),
    accountId: v.optional(v.id("accounts")),
    cancelled: v.optional(v.boolean()),
    deliveredAt: v.optional(v.number()),
    leaseUntil: v.optional(v.number()),
    attempts: v.optional(v.number()),
  }).index("by_notified", ["notified"]).index("by_email", ["email"]),

  kit_plans: defineTable({
    accountId: v.id("accounts"), title: v.string(),
    lines: v.array(v.object({ listingId: v.id("listings"), qty: v.number() })),
    start: v.optional(v.number()), end: v.optional(v.number()),
    shareKey: v.optional(v.string()), updatedAt: v.number(),
  }).index("by_account", ["accountId"]).index("by_share", ["shareKey"]),
  checkout_recoveries: defineTable({
    accountId: v.id("accounts"),
    lines: v.array(v.object({ listingId: v.id("listings"), qty: v.number(), start: v.number(), end: v.number() })),
    consentAt: v.number(), updatedAt: v.number(), dueAt: v.number(), expiresAt: v.number(),
    state: v.union(v.literal("waiting"), v.literal("sent"), v.literal("stopped")),
    leaseUntil: v.optional(v.number()), attempts: v.number(), deliveredAt: v.optional(v.number()),
    bookingId: v.optional(v.id("bookings")),
  }).index("by_account", ["accountId"]).index("by_state_due", ["state", "dueAt"]),
  account_access_links: defineTable({accountId:v.id("accounts"),bookingId:v.optional(v.id("bookings")),secretHash:v.string(),purpose:v.optional(v.literal("signup")),credentialHash:v.optional(v.string()),expiresAt:v.number(),usedAt:v.optional(v.number()),createdAt:v.number()}).index("by_hash",["secretHash"]).index("by_booking",["bookingId"]).index("by_account",["accountId"]),
  film_fund_rounds: defineTable({
    slug:v.string(),name:v.string(),state:v.union(v.literal("coming_soon"),v.literal("open"),v.literal("closed")),
    opensAt:v.number(),deadline:v.number(),announcementAt:v.number(),updatedAt:v.number(),closedAt:v.optional(v.number()),
  }).index("by_slug",["slug"]),
  film_fund_signups: defineTable({email:v.string(),consentAt:v.number(),createdAt:v.number(),active:v.boolean()}).index("by_email",["email"]),
  film_fund_announcements: defineTable({
    roundSlug:v.string(),signupId:v.id("film_fund_signups"),
    state:v.union(v.literal("pending"),v.literal("sending"),v.literal("sent"),v.literal("stopped")),
    dueAt:v.number(),attempts:v.number(),createdAt:v.number(),leaseUntil:v.optional(v.number()),sentAt:v.optional(v.number()),
  }).index("by_round_signup",["roundSlug","signupId"]).index("by_state_due",["state","dueAt"]),
  film_fund_projects: defineTable({
    accountId:v.id("accounts"),projectKey:v.string(),title:v.string(),synopsis:v.string(),tags:v.array(v.string()),letter:v.string(),
    crew:v.array(v.object({name:v.string(),role:v.string(),profile:v.string(),bio:v.string()})),
    scriptId:v.optional(v.id("film_fund_uploads")),moodboardId:v.optional(v.id("film_fund_uploads")),documentIds:v.array(v.id("film_fund_uploads")),videoId:v.optional(v.id("film_fund_uploads")),
    state:v.union(v.literal("draft"),v.literal("submitted")),roundSlug:v.optional(v.string()),submittedAt:v.optional(v.number()),termsVersion:v.optional(v.string()),
    entryPaid:v.optional(v.boolean()),entrySessionId:v.optional(v.string()),entryPaymentIntentId:v.optional(v.string()),entryIncluded:v.optional(v.boolean()),entryRoundSlug:v.optional(v.string()),entryRefundedAt:v.optional(v.number()),createdAt:v.number(),updatedAt:v.number(),
    reviewStatus:v.optional(v.string()),reviewNote:v.optional(v.string()),
  }).index("by_account",["accountId"]).index("by_project",["accountId","projectKey"]).index("by_round",["roundSlug"]),
  film_fund_entries: defineTable({
    projectId:v.id("film_fund_projects"),accountId:v.id("accounts"),roundSlug:v.string(),termsVersion:v.string(),consentAt:v.number(),amountPence:v.optional(v.number()),
    state:v.union(v.literal("creating"),v.literal("open"),v.literal("paid"),v.literal("expired"),v.literal("refunded")),
    createdAt:v.number(),expiresAt:v.number(),sessionId:v.optional(v.string()),paymentIntentId:v.optional(v.string()),sessionParams:v.optional(v.string()),
  }).index("by_project",["projectId"]).index("by_session",["sessionId"]),
  film_fund_uploads: defineTable({accountId:v.id("accounts"),projectId:v.id("film_fund_projects"),kind:v.string(),storageId:v.id("_storage"),name:v.string(),size:v.number(),contentType:v.string(),sha256:v.string(),durationSeconds:v.optional(v.number()),createdAt:v.number()}).index("by_storage",["storageId"]).index("by_project",["projectId"]),
  membership_checkouts: defineTable({
    accountId:v.id("accounts"),tier:v.string(),intro:v.string(),requestId:v.string(),createdAt:v.number(),expiresAt:v.number(),
    state:v.union(v.literal("creating"),v.literal("open"),v.literal("complete"),v.literal("expired")),
    sessionId:v.optional(v.string()),subscriptionId:v.optional(v.string()),bookingId:v.optional(v.id("bookings")),
    termsVersion:v.string(),consentAt:v.number(),sessionParams:v.optional(v.string()),
    starterOfferSaving:v.optional(v.number()),membershipSignupOfferSaving:v.optional(v.number()),initialCreditAppliedPence:v.optional(v.number()),initialCreditInvoiceId:v.optional(v.string()),
  }).index("by_account",["accountId"]).index("by_session",["sessionId"]).index("by_request",["requestId"]),
  membership_credit_grants: defineTable({
    accountId:v.id("accounts"),subscriptionId:v.string(),invoiceId:v.string(),paidMembershipPence:v.number(),creditPence:v.number(),earnedCreditPence:v.optional(v.number()),
    bonusPence:v.number(),revokedPence:v.number(),membershipRefundedPence:v.optional(v.number()),periodEnd:v.number(),createdAt:v.number(),creditId:v.optional(v.id("credits")),bonusCreditId:v.optional(v.id("credits")),
    initialCreditAppliedPence:v.optional(v.number()),
  }).index("by_invoice",["invoiceId"]).index("by_account",["accountId"]),

});
