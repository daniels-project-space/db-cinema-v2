import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { peak, type Iv } from "./availability";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { CANCELLATION_CREDIT_DAYS } from "../src/lib/cancellationPolicy";

const lineItem = v.object({
  listingId: v.id("listings"),
  title: v.string(),
  start: v.number(),
  end: v.number(),
  qty: v.number(),
  lineTotal: v.number(),
  dailyRate: v.optional(v.number()),
});

async function availableCreditFor(ctx: any, accountId: any): Promise<number> {
  const acct = await ctx.db.get(accountId);
  if (!acct) return 0;
  const now = Date.now();
  const credits = await ctx.db.query("credits")
    .withIndex("by_account", (q: any) => q.eq("accountId", accountId)).collect();
  const balance = credits.filter((c: any) => c.status === "active" && c.expiresAt > now)
    .reduce((n: number, c: any) => n + c.remaining, 0);
  const pending = await ctx.db.query("bookings")
    .withIndex("by_guestEmail", (q: any) => q.eq("guestEmail", acct.email.trim().toLowerCase())).collect();
  const reserved = pending.filter((b: any) => b.status === "pending_payment")
    .reduce((n: number, b: any) => n + (b.creditApplied ?? 0), 0);
  return Math.max(0, balance - reserved);
}

export const availableCheckoutCredit = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => availableCreditFor(ctx, accountId),
});

export const createPending = internalMutation({
  args: {
    customerEmail: v.string(),
    customerName: v.optional(v.string()),
    phone: v.optional(v.string()),
    fulfilment: v.union(v.literal("pickup"), v.literal("delivery")),
    address: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    deliveryFee: v.number(),
    lineItems: v.array(lineItem),
    subtotal: v.number(),
    depositAmount: v.number(),
    depositHoldAmount: v.optional(v.number()),
    promoCode: v.optional(v.string()),
    discount: v.optional(v.number()),
    total: v.number(),
    expectedTotalDue: v.number(),
    creditAccountId: v.optional(v.id("accounts")),
    currency: v.string(),
    agreementName: v.optional(v.string()),
    securityHoldConsent: v.optional(v.boolean()),
    laterChargeConsent: v.optional(v.boolean()),
    agreementDocs: v.optional(
      v.array(v.object({ kind: v.string(), version: v.string() })),
    ),
    protection: v.optional(v.string()),
    idVerifyStatus: v.optional(v.string()),
    verificationProvider: v.optional(v.string()),
    pickupTime: v.optional(v.string()),
    returnTime: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const customerEmail = a.customerEmail.trim().toLowerCase();
    if (!customerEmail) throw new Error("Customer email is required.");
    if (a.creditAccountId) {
      const creditAccount = await ctx.db.get(a.creditAccountId);
      if (!creditAccount || creditAccount.email.trim().toLowerCase() !== customerEmail)
        throw new Error("Account credit belongs to a different customer.");
    }
    let customer = await ctx.db
      .query("customers")
      .withIndex("by_email", (q) => q.eq("email", customerEmail))
      .first();
    if (!customer) {
      const id = await ctx.db.insert("customers", {
        email: customerEmail,
        name: a.customerName,
        phone: a.phone,
      });
      customer = await ctx.db.get(id);
    }

    // ── store-credit reservation (transactional, double-spend-safe) ──
    // Cap to the account's available balance MINUS credit already reserved by its other pending
    // checkouts, so two concurrent checkouts can't both spend the same credit (each serializable
    // mutation sees the other's reservation). An aborted/deleted pending booking releases its
    // reservation automatically; the actual decrement still happens on confirm.
    let creditApplied = 0;
    if (a.creditAccountId) {
      const available = await availableCreditFor(ctx, a.creditAccountId);
      creditApplied = Math.min(available, Math.max(0, a.total - a.depositAmount));
    }
    const chargedTotal = a.total - creditApplied;
    // Credit can be spent in another checkout between the preview and this mutation.
    // Reject atomically before a booking or Stripe session is created.
    if (Math.round(chargedTotal * 100) !== Math.round(a.expectedTotalDue * 100))
      throw new Error("Your available credit changed. Review the updated total before paying.");

    const bookingId = await ctx.db.insert("bookings", {
      customerId: customer!._id,
      guestEmail: customerEmail,
      status: "pending_payment",
      lineItems: a.lineItems,
      fulfilment: a.fulfilment,
      address: a.address,
      billingAddress: a.billingAddress,
      deliveryFee: a.deliveryFee,
      subtotal: a.subtotal,
      discount: a.discount ?? 0,
      promoCode: a.promoCode,
      depositAmount: a.depositAmount,
      depositHoldAmount: a.depositHoldAmount,
      depositHoldStatus: a.depositHoldAmount ? "awaiting_payment" : undefined,
      total: chargedTotal,
      creditApplied,
      currency: a.currency,
      agreementName: a.agreementName,
      agreementSignedAt: a.agreementName ? Date.now() : undefined,
      securityHoldConsentAt: a.securityHoldConsent ? Date.now() : undefined,
      laterChargeConsentAt: a.laterChargeConsent ? Date.now() : undefined,
      agreementDocs: a.agreementDocs,
      protection: a.protection,
      idVerifyStatus: a.idVerifyStatus ?? "required",
      verificationProvider: a.verificationProvider,
      verificationUpdatedAt: Date.now(),
      pickupTime: a.pickupTime,
      returnTime: a.returnTime,
    });
    return { bookingId, creditApplied };
  },
});

/** Soft holds: reserve the units for a TTL while the renter is at checkout, so
 *  two people can't grab the last unit at once. Released on confirm or by cron. */
export const placeHolds = internalMutation({
  args: { bookingId: v.id("bookings"), ttlMs: v.number() },
  handler: async (ctx, { bookingId, ttlMs }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) return;
    const now = Date.now();
    const expires = now + ttlMs;
    const ACTIVE = new Set(["confirmed", "active", "hold"]);

    // Gather this booking's demand per physical unit (BOM-aware) + the rows to insert.
    const demandByUnit = new Map<string, { ivs: Iv[]; title: string }>();
    const toInsert: { unitId: any; listingId: any; start: number; end: number; qty: number }[] = [];
    for (const li of booking.lineItems) {
      const listing = await ctx.db.get(li.listingId);
      if (!listing) continue;
      for (const comp of listing.components) {
        const uid = String(comp.inventoryUnitId);
        const qty = (comp.qty || 1) * (li.qty || 1);
        const d = demandByUnit.get(uid) ?? { ivs: [], title: li.title };
        d.ivs.push({ start: li.start, end: li.end, qty });
        demandByUnit.set(uid, d);
        toInsert.push({ unitId: comp.inventoryUnitId, listingId: li.listingId, start: li.start, end: li.end, qty });
      }
    }

    // ATOMIC, unit-aware re-check: existing ACTIVE (non-expired) reservations + this booking's
    // demand must not exceed owned stock for ANY shared unit. This runs inside the serializable
    // hold-insert mutation, so two concurrent checkouts for the last unit cannot both pass
    // (closes the action-level TOCTOU), and it catches cross-listing shared-unit demand.
    for (const [uid, d] of demandByUnit) {
      const unit: any = await ctx.db.get(uid as any);
      const owned = unit?.quantityOwned ?? 1;
      const lo = Math.min(...d.ivs.map((i) => i.start));
      const hi = Math.max(...d.ivs.map((i) => i.end));
      const existing: Iv[] = [];
      const rows = await ctx.db.query("reservations")
        .withIndex("by_unit", (q) => q.eq("inventoryUnitId", uid as any)).collect();
      for (const r of rows) {
        if (!ACTIVE.has(r.status) || r.start > hi || r.end < lo || r.bookingId === bookingId) continue;
        if (r.status === "hold" && (r.holdExpiresAt ?? 0) < now) {
          const pendingBooking = r.bookingId ? await ctx.db.get(r.bookingId) : null;
          if (pendingBooking?.status !== "pending_payment") continue;
        }
        existing.push({ start: r.start, end: r.end, qty: r.qty || 1 });
      }
      if (peak([...existing, ...d.ivs]) > owned) {
        throw new Error(`"${d.title}" was just taken for those dates — please adjust your dates or remove it.`);
      }
    }

    // All clear → place the soft holds.
    for (const ins of toInsert) {
      await ctx.db.insert("reservations", {
        inventoryUnitId: ins.unitId,
        listingId: ins.listingId,
        bookingId,
        start: ins.start,
        end: ins.end,
        qty: ins.qty,
        source: "site",
        status: "hold",
        holdExpiresAt: expires,
      });
    }
  },
});

export const releaseExpiredHolds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const holds = await ctx.db
      .query("reservations")
      .withIndex("by_status", (q) => q.eq("status", "hold"))
      .collect();
    let n = 0;
    for (const h of holds)
      if ((h.holdExpiresAt ?? 0) < now) {
        const booking = h.bookingId ? await ctx.db.get(h.bookingId) : null;
        // A pending payment can already be paid at Stripe while its webhook is
        // delayed. Only the Stripe reconciliation action may close that booking.
        if (booking?.status === "pending_payment") continue;
        await ctx.db.delete(h._id);
        n++;
      }
    return { released: n };
  },
});

/** Provider reconciliation reads these without trusting a booking's age as payment evidence. */
export const pendingCheckoutSessions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "pending_payment"))
      .collect();
    return rows.map((b) => ({
      bookingId: b._id,
      sessionId: b.stripeCheckoutSessionId ?? null,
      createdAt: b._creationTime,
    }));
  },
});

/** Called only after Stripe says the session is terminal and unpaid, or no
 * session was ever bound and the checkout action never returned a URL. */
export const expireUnpaidPending = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.optional(v.string()) },
  handler: async (ctx, { bookingId, sessionId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking || booking.status !== "pending_payment" ||
        (booking.stripeCheckoutSessionId ?? undefined) !== sessionId) return false;
    const res = await ctx.db.query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId)).collect();
    for (const hold of res) if (hold.status === "hold") await ctx.db.delete(hold._id);
    await ctx.db.patch(bookingId, { status: "cancelled", cancelledAt: Date.now() });
    return true;
  },
});

export const confirm = internalMutation({
  args: { bookingId: v.id("bookings"), paymentIntentId: v.optional(v.string()) },
  handler: async (ctx, { bookingId, paymentIntentId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) throw new Error("booking not found");
    if (booking.status === "cancelled" || booking.status === "returned")
      return { closed: true };
    if (booking.status === "confirmed" || booking.status === "active") {
      return { already: true };
    }
    // clear this booking's soft holds before writing the real reservations
    const holds = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    for (const h of holds) if (h.status === "hold") await ctx.db.delete(h._id);
    await ctx.db.patch(bookingId, {
      status: "confirmed",
      stripePaymentIntentId: paymentIntentId,
    });
    // write the reservation ledger (source:site) per BOM component
    for (const li of booking.lineItems) {
      const listing = await ctx.db.get(li.listingId);
      if (!listing) continue;
      for (const comp of listing.components) {
        await ctx.db.insert("reservations", {
          inventoryUnitId: comp.inventoryUnitId,
          listingId: li.listingId,
          bookingId,
          start: li.start,
          end: li.end,
          qty: comp.qty * li.qty,
          source: "site",
          status: "confirmed",
        });
      }
    }
    // record promo redemption (enforces one-time / once-a-month limits)
    if (booking.promoCode && booking.guestEmail) {
      await ctx.db.insert("promo_redemptions", {
        email: booking.guestEmail.trim().toLowerCase(),
        code: booking.promoCode,
        at: Date.now(),
      });
    }
    // decrement any store credit applied at checkout — only now that payment has succeeded (FIFO by expiry)
    if (booking.creditApplied && booking.creditApplied > 0 && booking.guestEmail) {
      const acct = await ctx.db
        .query("accounts")
        .withIndex("by_email", (q) => q.eq("email", booking.guestEmail!.trim().toLowerCase()))
        .first();
      if (acct) {
        const now = Date.now();
        const rows = (
          await ctx.db.query("credits").withIndex("by_account", (q) => q.eq("accountId", acct._id)).collect()
        )
          // Credit was reserved while valid at checkout. The provider webhook may
          // arrive after its expiry, so consume that reservation rather than
          // silently giving a discount without using the credit.
          .filter((c) => c.status === "active" && c.createdAt <= booking._creationTime &&
            c.expiresAt > booking._creationTime && c.remaining > 0)
          .sort((a, b) => a.expiresAt - b.expiresAt);
        let need = booking.creditApplied;
        for (const c of rows) {
          if (need <= 0) break;
          const take = Math.min(c.remaining, need);
          const rem = c.remaining - take;
          await ctx.db.patch(c._id, { remaining: rem, status: rem <= 0 ? "spent" : "active" });
          need -= take;
        }
      }
    }
    await ctx.scheduler.runAfter(0, internal.notify.bookingAlert, { bookingId });
    await ctx.scheduler.runAfter(0, internal.invoice.invoiceEmail, { bookingId });
    await ctx.scheduler.runAfter(0, internal.chat.postBookingMessages, { bookingId });
    await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId });
    return { already: false };
  },
});

export const bindCheckoutSession = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string() },
  handler: async (ctx, { bookingId, sessionId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.status !== "pending_payment") throw new Error("Checkout is no longer pending.");
    if (b.stripeCheckoutSessionId && b.stripeCheckoutSessionId !== sessionId)
      throw new Error("Checkout session already exists.");
    await ctx.db.patch(bookingId, { stripeCheckoutSessionId: sessionId });
  },
});

/** Booking context for the chat assistant (resolves the owning account). */
export const getForChat = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const acct = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()))
      .first();
    return {
      accountId: acct?._id ?? null,
      lineItems: b.lineItems,
      fulfilment: b.fulfilment,
      address: b.address ?? null,
      pickupTime: b.pickupTime ?? null,
    };
  },
});

/** Attach a paid add-on to an existing booking (instant upsell checkout). */
export const attachAddon = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    listingId: v.id("listings"),
    title: v.string(),
    start: v.number(),
    end: v.number(),
    total: v.number(),
  },
  handler: async (ctx, { bookingId, listingId, title, start, end, total }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return;
    await ctx.db.patch(bookingId, {
      lineItems: [...b.lineItems, { listingId, title, start, end, qty: 1, lineTotal: total }],
      total: b.total + total,
    });
    const listing = await ctx.db.get(listingId);
    if (listing)
      for (const comp of listing.components) {
        await ctx.db.insert("reservations", {
          inventoryUnitId: comp.inventoryUnitId,
          listingId,
          bookingId,
          start,
          end,
          qty: comp.qty,
          source: "site",
          status: "confirmed",
        });
      }
    const acct = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()))
      .first();
    if (acct)
      await ctx.db.insert("messages", {
        accountId: acct._id,
        bookingId,
        sender: "system",
        text: `Added to your rental: ${title} ✓`,
        at: Date.now(),
        readByOwner: true,
      });
    // Status is unchanged, but lineItems/total moved — RMv2's availability and
    // revenue both read those, so this still needs to sync.
    await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId });
  },
});

export const adminList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) {
      return { authorized: false as const, items: [] };
    }
    const rows = await ctx.db.query("bookings").order("desc").take(100);
    const items = rows.map((b) => ({
      _id: b._id,
      status: b.status,
      guestEmail: b.guestEmail,
      lineItems: b.lineItems,
      fulfilment: b.fulfilment,
      address: b.address,
      subtotal: b.subtotal,
      depositAmount: b.depositAmount,
      depositHoldAmount: b.depositHoldAmount ?? 0,
      depositHoldStatus: b.depositHoldStatus ?? null,
      depositHoldExpiresAt: b.depositHoldExpiresAt ?? null,
      depositHoldRenewalStatus: b.depositHoldRenewalStatus ?? null,
      lateFeeAmount: b.lateFeeAmount ?? 0,
      lateFeeWaivedAmount: b.lateFeeWaivedAmount ?? 0,
      lateFeeStatus: b.lateFeeStatus ?? null,
      lateFeeBreakdown: b.lateFeeBreakdown ?? [],
      lateFeePaidFromHold: b.lateFeePaidFromHold ?? 0,
      lateFeePaidFromCard: b.lateFeePaidFromCard ?? 0,
      lateFeeReceiptEmailStatus: b.lateFeeReceiptEmailStatus ?? null,
      total: b.total,
      depositRefunded: b.depositRefunded ?? false,
      depositKept: b.depositKept ?? 0,
      depositRefundAmount: b.depositRefundAmount ?? 0,
      damageNoticeSentAt: b.damageNoticeSentAt ?? null,
      returnedAt: b.returnedAt ?? null,
      actualReturnedAt: b.actualReturnedAt ?? null,
      returnDecision: b.returnDecision ?? null,
      returnTime: b.returnTime ?? null,
      returnStatementEmailStatus: b.returnStatementEmailStatus ?? null,
      idVerifyStatus: b.idVerifyStatus ?? "required",
      verificationProvider: b.verificationProvider ?? "stripe",
      diditSessionId: b.diditSessionId ?? null,
      verificationNote: b.verificationNote ?? null,
      verificationUpdatedAt: b.verificationUpdatedAt ?? null,
      agreementName: b.agreementName ?? null,
      promoCode: b.promoCode ?? null,
      discount: b.discount ?? 0,
      at: b._creationTime,
    }));
    return { authorized: true as const, items };
  },
});

export const adminSetStatus = mutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    status: v.union(
      v.literal("confirmed"),
      v.literal("active"),
    ),
  },
  handler: async (ctx, { token, bookingId, status }) => {
    await assertAdmin(ctx, token, "bookings.adminSetStatus");
    const booking = await ctx.db.get(bookingId);
    if (!booking) throw new Error("Booking not found");
    if (["cancelled", "returned"].includes(booking.status) && booking.status !== status)
      throw new Error("A closed booking cannot be reopened by changing its status.");
    if (booking.status === "pending_payment" && status === "confirmed")
      throw new Error("Payment must be confirmed by Stripe before this booking is confirmed.");
    if (status === "active" && booking.verificationProvider === "didit" && booking.idVerifyStatus !== "verified")
      throw new Error("Identity and address verification must be approved before handover.");
    if (status === "active" && booking.depositHoldAmount &&
        (booking.depositHoldStatus !== "held" || (booking.depositHoldExpiresAt ?? 0) <= Date.now()))
      throw new Error("The card hold must be active before handover.");
    await ctx.db.patch(bookingId, { status });
    await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId });
  },
});

export const getForRefund = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      paymentIntentId: b.stripePaymentIntentId ?? null,
      depositAmount: b.depositAmount,
      depositHoldAmount: b.depositHoldAmount ?? 0,
      depositHoldStatus: b.depositHoldStatus ?? null,
      depositHoldIntentId: b.stripeDepositIntentId ?? null,
      depositHoldPreviousIntentIds: b.depositHoldPreviousIntentIds ?? [],
      lineItems: b.lineItems,
      returnTime: b.returnTime ?? null,
      guestEmail: b.guestEmail ?? null,
      returnDecision: b.returnDecision ?? null,
      depositRefunded: b.depositRefunded ?? false,
      depositKept: b.depositKept ?? 0,
      depositRefundAmount: b.depositRefundAmount ?? 0,
      damageNoticeSentAt: b.damageNoticeSentAt ?? null,
    };
  },
});

export const beginReturnDecision = internalMutation({
  args: { bookingId: v.id("bookings"), actualReturnedAt: v.number(), damageKept: v.number(), damageNote: v.optional(v.string()), chargeLate: v.boolean(), lateWaiverReason: v.optional(v.string()) },
  handler: async (ctx, { bookingId, actualReturnedAt, damageKept, damageNote, chargeLate, lateWaiverReason }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || !["confirmed", "active", "returned"].includes(b.status)) throw new Error("Booking is not available for return.");
    const saved = b.returnDecision;
    if (saved) {
      if (saved.actualReturnedAt !== actualReturnedAt || saved.damageKept !== damageKept ||
          (saved.damageNote ?? "") !== (damageNote ?? "") || saved.chargeLate !== chargeLate ||
          (saved.lateWaiverReason ?? "") !== (lateWaiverReason ?? ""))
        throw new Error("A return settlement is already in progress with different amounts. Resume the saved decision or contact support before changing it.");
      return;
    }
    await ctx.db.patch(bookingId, { returnDecision: { actualReturnedAt, damageKept, damageNote, chargeLate, lateWaiverReason, startedAt: Date.now() } });
  },
});

export const markDamageNoticeSent = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (b?.returnDecision && !b.damageNoticeSentAt)
      await ctx.db.patch(bookingId, { damageNoticeSentAt: Date.now() });
  },
});

export const holdContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      status: b.status,
      amount: b.depositHoldAmount ?? 0,
      intentId: b.stripeDepositIntentId ?? null,
      holdStatus: b.depositHoldStatus ?? null,
    };
  },
});

export const setHold = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    intentId: v.optional(v.string()),
    status: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { bookingId, intentId, status, expiresAt }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || !b.depositHoldAmount) return;
    if (b.stripeDepositIntentId && intentId && b.stripeDepositIntentId !== intentId)
      throw new Error("A different hold is already linked to this booking");
    await ctx.db.patch(bookingId, {
      stripeDepositIntentId: intentId ?? b.stripeDepositIntentId,
      depositHoldStatus: status,
      depositHoldExpiresAt: expiresAt,
    });
  },
});

export const renewalCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const confirmed = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "confirmed")).order("desc").take(1000);
    const active = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "active")).order("desc").take(1000);
    return [...confirmed, ...active]
      .filter((b) => (b.depositHoldPreviousIntentIds?.length ?? 0) > 0 ||
        (b.depositHoldAmount && b.depositHoldStatus === "held" && b.stripeDepositIntentId &&
        (b.depositHoldExpiresAt ?? 0) <= now + 24 * 3600000 &&
        Math.max(...b.lineItems.map((li) => li.end)) >= now - 30 * 86400000))
      .map((b) => b._id);
  },
});

export const renewalContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      status: b.status, guestEmail: b.guestEmail ?? null,
      amount: b.depositHoldAmount ?? 0, oldIntentId: b.stripeDepositIntentId ?? null,
      expiresAt: b.depositHoldExpiresAt ?? null,
      renewalIntentId: b.depositHoldRenewalIntentId ?? null,
      renewalStatus: b.depositHoldRenewalStatus ?? null,
      renewalAt: b.depositHoldRenewalAt ?? null,
      previousIntentIds: b.depositHoldPreviousIntentIds ?? [],
    };
  },
});

export const claimRenewal = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    const now = Date.now();
    if (!b || !["confirmed", "active"].includes(b.status) || !b.depositHoldAmount || b.depositHoldStatus !== "held" || !b.stripeDepositIntentId ||
      (b.depositHoldExpiresAt ?? 0) > now + 24 * 3600000 ||
      ["requires_action", "failed"].includes(b.depositHoldRenewalStatus ?? "") ||
      (b.depositHoldRenewalStatus === "starting" && (b.depositHoldRenewalAt ?? now) > now - 15 * 60000)) return false;
    await ctx.db.patch(bookingId, { depositHoldRenewalStatus: "starting", depositHoldRenewalAt: now });
    return true;
  },
});

export const setRenewalResult = internalMutation({
  args: { bookingId: v.id("bookings"), oldIntentId: v.string(), status: v.string(), intentId: v.optional(v.string()) },
  handler: async (ctx, { bookingId, oldIntentId, status, intentId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.stripeDepositIntentId !== oldIntentId) return;
    await ctx.db.patch(bookingId, { depositHoldRenewalStatus: status, depositHoldRenewalIntentId: intentId, depositHoldRenewalAt: Date.now() });
  },
});

export const replaceHold = internalMutation({
  args: { bookingId: v.id("bookings"), oldIntentId: v.string(), newIntentId: v.string(), expiresAt: v.number() },
  handler: async (ctx, { bookingId, oldIntentId, newIntentId, expiresAt }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.stripeDepositIntentId !== oldIntentId || !["confirmed", "active"].includes(b.status)) return false;
    await ctx.db.patch(bookingId, {
      stripeDepositIntentId: newIntentId,
      depositHoldStatus: "held",
      depositHoldExpiresAt: expiresAt,
      depositHoldRenewalIntentId: undefined,
      depositHoldRenewalStatus: "renewed",
      depositHoldRenewalAt: Date.now(),
      depositHoldPreviousIntentIds: [...(b.depositHoldPreviousIntentIds ?? []), oldIntentId],
    });
    return true;
  },
});

export const clearPreviousHold = internalMutation({
  args: { bookingId: v.id("bookings"), intentId: v.string() },
  handler: async (ctx, { bookingId, intentId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return;
    await ctx.db.patch(bookingId, {
      depositHoldPreviousIntentIds: (b.depositHoldPreviousIntentIds ?? []).filter((id) => id !== intentId),
    });
  },
});

/** Mark a booking returned + flip its reservations to returned (frees the inventory ledger). */
export const markReturnedStatus = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return;
    if (b.status !== "returned") await ctx.db.patch(bookingId, { status: "returned" });
    const res = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    for (const r of res) if (r.status !== "returned") await ctx.db.patch(r._id, { status: "returned" });
    await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId });
  },
});

/** Record that the deposit was released (depositKept = amount retained for damage). */
export const markDepositReleased = internalMutation({
  args: { bookingId: v.id("bookings"), kept: v.number(), refunded: v.number(), capturedFromHold: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, { bookingId, kept, refunded, capturedFromHold, note }) => {
    await ctx.db.patch(bookingId, { depositRefunded: true, depositKept: kept, depositRefundAmount: refunded, depositHoldCapturedForDamage: capturedFromHold, depositDeductionNote: note, returnedAt: Date.now() });
  },
});

const lateLine = v.object({ title: v.string(), days: v.number(), dailyRate: v.number(), amount: v.number() });

export const recordLateFee = internalMutation({
  args: { bookingId: v.id("bookings"), actualReturnedAt: v.number(), amount: v.number(), breakdown: v.array(lateLine), waivedAmount: v.optional(v.number()), waiverReason: v.optional(v.string()) },
  handler: async (ctx, { bookingId, actualReturnedAt, amount, breakdown, waivedAmount, waiverReason }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.actualReturnedAt) return;
    await ctx.db.patch(bookingId, {
      actualReturnedAt,
      lateFeeAmount: amount,
      lateFeeWaivedAmount: waivedAmount,
      lateFeeWaiverReason: waiverReason,
      lateFeeBreakdown: breakdown,
      lateFeeStatus: amount > 0 ? "notice_pending" : waivedAmount ? "waived" : "none",
    });
    const customer = b.customerId ? await ctx.db.get(b.customerId) : null;
    const issuedAt = Date.now();
    await ctx.db.patch(bookingId, {
      returnStatement: {
        number: `DBC-R-${String(bookingId).toUpperCase()}`, issuedAt, actualReturnedAt,
        agreedReturnTime: b.returnTime,
        supplierName: process.env.BUSINESS_LEGAL_NAME || "Db Cinema Rentals",
        supplierAddress: process.env.BUSINESS_INVOICE_ADDRESS || undefined,
        customerName: customer?.name || undefined,
        customerEmail: b.guestEmail ?? "",
        billingAddress: b.billingAddress ?? b.address,
        lineItems: b.lineItems.map((line) => ({ title: line.title, start: line.start, end: line.end, qty: line.qty, lineTotal: line.lineTotal })),
        subtotal: b.subtotal, discount: b.discount ?? 0, deliveryFee: b.deliveryFee ?? 0,
        creditApplied: b.creditApplied ?? 0, checkoutPaid: b.total,
        securityPaid: b.depositAmount, securityRefunded: b.depositRefundAmount ?? 0,
        holdStatus: b.depositHoldStatus,
        damageTotal: b.depositKept ?? 0, damageFromHold: b.depositHoldCapturedForDamage ?? 0,
        damageNote: b.depositDeductionNote,
        lateAssessed: amount, lateWaived: waivedAmount ?? 0, lateBreakdown: breakdown,
      },
      returnStatementEmailStatus: "pending",
    });
    if (amount > 0) await ctx.scheduler.runAfter(0, internal.lateFees.sendNotice, { bookingId });
    await ctx.scheduler.runAfter(0, internal.invoice.returnSettlementEmail, { bookingId });
  },
});

export const lateFeeContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      status: b.status, guestEmail: b.guestEmail ?? null,
      lateFeeAmount: b.lateFeeAmount ?? 0, lateFeeStatus: b.lateFeeStatus ?? null,
      lateFeeBreakdown: b.lateFeeBreakdown ?? [], lateFeeNoticeAt: b.lateFeeNoticeAt ?? null,
      stripePaymentIntentId: b.stripePaymentIntentId ?? null,
      actualReturnedAt: b.actualReturnedAt ?? null,
      agreedReturnTime: b.returnTime ?? null,
      stripeDepositIntentId: b.stripeDepositIntentId ?? null,
      depositHoldAmount: b.depositHoldAmount ?? 0,
      depositKept: b.depositKept ?? 0,
      lateFeePaidFromHold: b.lateFeePaidFromHold ?? 0,
      lateFeePaidFromCard: b.lateFeePaidFromCard ?? 0,
      lateFeeIntentId: b.lateFeeIntentId ?? null,
    };
  },
});

/** A bank challenge can finish after the renter closes the page. Reconcile its
 * existing PaymentIntent only; never create a second charge. */
export const pendingLateAuthentications = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "returned"))
      .order("desc").take(1000);
    return rows.filter((b) => b.lateFeeIntentId &&
      ["requires_action", "processing"].includes(b.lateFeeStatus ?? ""))
      .map((b) => b._id);
  },
});

export const settleAuthenticatedLateCharge = internalMutation({
  args: {
    bookingId: v.id("bookings"), intentId: v.string(), status: v.string(),
    paidFromCard: v.number(), note: v.optional(v.string()),
  },
  handler: async (ctx, { bookingId, intentId, status, paidFromCard, note }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.status !== "returned" || b.lateFeeIntentId !== intentId ||
      !["requires_action", "processing"].includes(b.lateFeeStatus ?? "")) return false;
    if (!Number.isFinite(paidFromCard) || paidFromCard < 0 ||
      paidFromCard > Math.max(0, (b.lateFeeAmount ?? 0) - (b.lateFeePaidFromHold ?? 0)))
      throw new Error("Late charge settlement amount is invalid.");
    if (status === b.lateFeeStatus && paidFromCard === (b.lateFeePaidFromCard ?? 0)) return false;
    await ctx.db.patch(bookingId, {
      lateFeeStatus: status,
      lateFeePaidFromCard: paidFromCard,
      lateFeeNote: note?.slice(0, 400),
      lateFeeReceiptEmailStatus: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.lateFees.sendCollectionResult, { bookingId });
    return true;
  },
});

export const claimLateNotice = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || !b.lateFeeAmount || !(
      ["notice_pending", "notice_failed"].includes(b.lateFeeStatus ?? "") ||
      (b.lateFeeStatus === "sending_notice" && (b.lateFeeNoticeAttemptAt ?? 0) < Date.now() - 15 * 60000)
    )) return false;
    await ctx.db.patch(bookingId, { lateFeeStatus: "sending_notice", lateFeeNoticeAttemptAt: Date.now() });
    return true;
  },
});

export const markLateNotice = internalMutation({
  args: { bookingId: v.id("bookings"), sent: v.boolean() },
  handler: async (ctx, { bookingId, sent }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.lateFeeStatus !== "sending_notice") return;
    await ctx.db.patch(bookingId, {
      lateFeeStatus: sent ? "notice_sent" : "notice_failed",
      lateFeeNoticeAt: sent ? Date.now() : undefined,
    });
  },
});

export const dueLateFees = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "returned")).order("desc").take(1000);
    const now = Date.now();
    return rows.filter((b) =>
      b.lateFeeStatus === "notice_pending" || b.lateFeeStatus === "notice_failed" ||
      (b.lateFeeStatus === "sending_notice" && (b.lateFeeNoticeAttemptAt ?? 0) <= now - 15 * 60000) ||
      (b.lateFeeStatus === "notice_sent" && (b.lateFeeNoticeAt ?? now) <= now - 7 * 86400000) ||
      (b.lateFeeStatus === "charging" && (b.lateFeeChargingAt ?? now) <= now - 15 * 60000),
    ).map((b) => ({ bookingId: b._id, status: b.lateFeeStatus }));
  },
});

export const claimLateCharge = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (b?.actualReturnedAt && Date.now() > b.actualReturnedAt + 30 * 86400000) {
      await ctx.db.patch(bookingId, { lateFeeStatus: "expired", lateFeeNote: "30-day collection window elapsed" });
      return false;
    }
    if (!b || b.status !== "returned" || !["notice_sent", "charging"].includes(b.lateFeeStatus ?? "") || !b.lateFeeAmount ||
      !b.lateFeeNoticeAt || b.lateFeeNoticeAt > Date.now() - 7 * 86400000) return false;
    if (b.lateFeeStatus === "charging" && (b.lateFeeChargingAt ?? Date.now()) > Date.now() - 15 * 60000) return false;
    await ctx.db.patch(bookingId, { lateFeeStatus: "charging", lateFeeChargingAt: Date.now() });
    return true;
  },
});

export const markLateCharge = internalMutation({
  args: { bookingId: v.id("bookings"), status: v.string(), intentId: v.optional(v.string()), note: v.optional(v.string()), paidFromHold: v.number(), paidFromCard: v.number() },
  handler: async (ctx, { bookingId, status, intentId, note, paidFromHold, paidFromCard }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.lateFeeStatus !== "charging") return;
    await ctx.db.patch(bookingId, {
      lateFeeStatus: status, lateFeeIntentId: intentId,
      lateFeeNote: note?.slice(0, 400),
      lateFeePaidFromHold: paidFromHold,
      lateFeePaidFromCard: paidFromCard,
      lateFeeReceiptEmailStatus: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.lateFees.sendCollectionResult, { bookingId });
  },
});

export const claimLateFeeReceiptEmail = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || !["pending", "failed", "sending"].includes(b.lateFeeReceiptEmailStatus ?? "") ||
      (b.lateFeeReceiptEmailStatus === "sending" && (b.lateFeeReceiptEmailAttemptAt ?? 0) > Date.now() - 15 * 60000)) return false;
    await ctx.db.patch(bookingId, { lateFeeReceiptEmailStatus: "sending", lateFeeReceiptEmailAttemptAt: Date.now() });
    return true;
  },
});

export const markLateFeeReceiptEmail = internalMutation({
  args: { bookingId: v.id("bookings"), sent: v.boolean() },
  handler: async (ctx, { bookingId, sent }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.lateFeeReceiptEmailStatus !== "sending") return;
    await ctx.db.patch(bookingId, { lateFeeReceiptEmailStatus: sent ? "sent" : "failed", lateFeeReceiptEmailedAt: sent ? Date.now() : undefined });
  },
});

export const dueLateFeeReceiptEmails = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "returned")).order("desc").take(1000);
    return rows.filter((b) => b.lateFeeReceiptEmailStatus === "pending" || b.lateFeeReceiptEmailStatus === "failed" ||
      (b.lateFeeReceiptEmailStatus === "sending" && (b.lateFeeReceiptEmailAttemptAt ?? 0) <= now - 15 * 60000))
      .map((b) => b._id);
  },
});

export const adminPauseLateFee = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), reason: v.string() },
  handler: async (ctx, { token, bookingId, reason }) => {
    await assertAdmin(ctx, token, "bookings.adminPauseLateFee");
    if (reason.trim().length < 5) throw new Error("Record the dispute or waiver reason.");
    const b = await ctx.db.get(bookingId);
    if (!b || !["notice_pending", "notice_failed", "notice_sent"].includes(b.lateFeeStatus ?? ""))
      throw new Error("This late charge can no longer be paused.");
    await ctx.db.patch(bookingId, { lateFeeStatus: "paused", lateFeeNote: reason.trim().slice(0, 400) });
    await ctx.scheduler.runAfter(0, internal.checkout.releasePausedLateHold, { bookingId });
  },
});

export const remindersFeed = internalQuery({
  args: {},
  handler: async (ctx) => {
    const confirmed = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "confirmed"))
      .collect();
    const active = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const returned = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "returned"))
      .collect();
    const out = [];
    for (const b of [...confirmed, ...active, ...returned]) {
      if (!b.guestEmail) continue;
      const acct = await ctx.db
        .query("accounts")
        .withIndex("by_email", (q) => q.eq("email", b.guestEmail!.trim().toLowerCase()))
        .first();
      out.push({
        _id: b._id,
        start: Math.min(...b.lineItems.map((li) => li.start)),
        end: Math.max(...b.lineItems.map((li) => li.end)),
        guestEmail: b.guestEmail,
        accountId: acct?._id ?? null,
        fulfilment: b.fulfilment,
        pickupTime: b.pickupTime ?? null,
        returnTime: b.returnTime ?? null,
        remindedPickup: b.remindedPickup ?? false,
        remindedReturn: b.remindedReturn ?? false,
        remindedReview: b.remindedReview ?? false,
        summary: b.lineItems.map((li) => li.title).join(", "),
      });
    }
    return out;
  },
});

export const markReminded = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    which: v.union(v.literal("pickup"), v.literal("return"), v.literal("review")),
  },
  handler: async (ctx, { bookingId, which }) => {
    const patch =
      which === "pickup"
        ? { remindedPickup: true }
        : which === "return"
          ? { remindedReturn: true }
          : { remindedReview: true };
    await ctx.db.patch(bookingId, patch);
  },
});

export const get = query({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      _id: b._id,
      status: b.status,
      lineItems: b.lineItems,
      subtotal: b.subtotal,
      depositAmount: b.depositAmount,
      depositHoldAmount: b.depositHoldAmount ?? 0,
      depositHoldStatus: b.depositHoldStatus ?? null,
      deliveryFee: b.deliveryFee,
      total: b.total,
      currency: b.currency,
      fulfilment: b.fulfilment,
      guestEmail: b.guestEmail,
      idVerifyStatus: b.idVerifyStatus ?? "required",
      verificationProvider: b.verificationProvider ?? "stripe",
      verificationNote: b.verificationNote ?? null,
      agreementName: b.agreementName ?? null,
      agreementSignedAt: b.agreementSignedAt ?? null,
    };
  },
});

/** Invoice/receipt payload. Authorised by the server INVOICE_SECRET (for the email
 *  attachment fetch) OR a session token whose account owns the booking (customer download). */
export const invoiceData = query({
  args: { bookingId: v.id("bookings"), token: v.optional(v.string()), key: v.optional(v.string()) },
  handler: async (ctx, { bookingId, token, key }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    let ok = false;
    if (key && process.env.INVOICE_SECRET && key === process.env.INVOICE_SECRET) {
      ok = true;
    } else if (token) {
      const s = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", token)).first();
      const acct: any = s && (s.expiresAt ?? 0) > Date.now() ? await ctx.db.get(s.accountId) : null;
      if (acct && acct.email === (b.guestEmail ?? "").trim().toLowerCase()) ok = true;
    }
    if (!ok) return null;
    const customer: any = b.customerId ? await ctx.db.get(b.customerId) : null;
    return {
      number: `DBC-${String(b._id).slice(-8).toUpperCase()}`,
      issuedAt: b._creationTime,
      supplierName: process.env.BUSINESS_LEGAL_NAME || "Db Cinema Rentals",
      supplierAddress: process.env.BUSINESS_INVOICE_ADDRESS || undefined,
      status: b.status,
      customerName: customer?.name ?? null,
      email: b.guestEmail ?? null,
      fulfilment: b.fulfilment,
      address: b.address ?? null,
      currency: b.currency ?? "GBP",
      lineItems: b.lineItems.map((li) => ({ title: li.title, start: li.start, end: li.end, qty: li.qty, lineTotal: li.lineTotal })),
      subtotal: b.subtotal,
      discount: b.discount ?? 0,
      deliveryFee: b.deliveryFee ?? 0,
      creditApplied: b.creditApplied ?? 0,
      depositAmount: b.depositAmount,
      total: b.total,
      promoCode: b.promoCode ?? null,
      returnStatement: b.returnStatement ?? null,
    };
  },
});

export const returnStatementContext = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    return b?.returnStatement ? { statement: b.returnStatement, status: b.returnStatementEmailStatus ?? "pending" } : null;
  },
});

export const claimReturnStatementEmail = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b?.returnStatement || b.returnStatementEmailStatus === "sent" ||
      (b.returnStatementEmailStatus === "sending" && (b.returnStatementEmailAttemptAt ?? 0) > Date.now() - 15 * 60000)) return false;
    await ctx.db.patch(bookingId, { returnStatementEmailStatus: "sending", returnStatementEmailAttemptAt: Date.now() });
    return true;
  },
});

export const markReturnStatementEmail = internalMutation({
  args: { bookingId: v.id("bookings"), sent: v.boolean() },
  handler: async (ctx, { bookingId, sent }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.returnStatementEmailStatus !== "sending") return;
    await ctx.db.patch(bookingId, { returnStatementEmailStatus: sent ? "sent" : "failed", returnStatementEmailedAt: sent ? Date.now() : undefined });
  },
});

export const dueReturnStatementEmails = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "returned")).order("desc").take(1000);
    return rows.filter((b) => b.returnStatement &&
      (["pending", "failed"].includes(b.returnStatementEmailStatus ?? "") ||
        (b.returnStatementEmailStatus === "sending" && (b.returnStatementEmailAttemptAt ?? 0) <= now - 15 * 60000)))
      .map((b) => b._id);
  },
});

export const getIdentity = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    return {
      sessionId: b.stripeIdentitySessionId ?? null,
      status: b.idVerifyStatus ?? "required",
    };
  },
});

export const verificationAccess = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const customer = b.customerId ? await ctx.db.get(b.customerId) : null;
    return { guestEmail: b.guestEmail, status: b.status, verificationProvider: b.verificationProvider,
      idVerifyStatus: b.idVerifyStatus, diditSessionId: b.diditSessionId,
      renterName: b.agreementName || customer?.name, billingAddress: b.billingAddress };
  },
});

/** Oldest checked first so a failed provider request cannot starve other rentals. */
export const diditReconcileCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const confirmed = await ctx.db.query("bookings")
      .withIndex("by_verificationProvider_status", (q) => q.eq("verificationProvider", "didit").eq("status", "confirmed")).collect();
    const active = await ctx.db.query("bookings")
      .withIndex("by_verificationProvider_status", (q) => q.eq("verificationProvider", "didit").eq("status", "active")).collect();
    return [...confirmed, ...active]
      .filter((b) => !!b.diditSessionId && !!b.guestEmail)
      .sort((a, b) => (a.diditReconciledAt ?? 0) - (b.diditReconciledAt ?? 0))
      .slice(0, 50)
      .map((b) => ({ bookingId: b._id, sessionId: b.diditSessionId!, email: b.guestEmail! }));
  },
});

export const markDiditReconciled = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string(), attemptedAt: v.number() },
  handler: async (ctx, { bookingId, sessionId, attemptedAt }) => {
    const b = await ctx.db.get(bookingId);
    if (b?.diditSessionId === sessionId)
      await ctx.db.patch(bookingId, { diditReconciledAt: attemptedAt });
  },
});

export const setIdentity = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    sessionId: v.optional(v.string()),
    status: v.string(),
  },
  handler: async (ctx, { bookingId, sessionId, status }) => {
    const prev = (await ctx.db.get(bookingId))?.idVerifyStatus ?? "required";
    const patch: any = { idVerifyStatus: status };
    if (sessionId) patch.stripeIdentitySessionId = sessionId;
    await ctx.db.patch(bookingId, patch);
    if (status === "verified") await markAccountVerified(ctx, bookingId);
    if (status !== prev && ["verified", "requires_input", "canceled"].includes(status))
      await ctx.scheduler.runAfter(0, internal.notify.verificationEmail, { bookingId, status });
  },
});

/** Bind a Didit session to the paid booking before any result can be accepted. */
export const setDiditSession = internalMutation({
  args: { bookingId: v.id("bookings"), sessionId: v.string() },
  handler: async (ctx, { bookingId, sessionId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.verificationProvider !== "didit" || !["confirmed", "active"].includes(b.status) ||
        !["required", "processing", "requires_input"].includes(b.idVerifyStatus ?? "required")) return false;
    if (b.diditSessionId !== sessionId) {
      await ctx.db.patch(bookingId, {
        diditSessionId: sessionId,
        diditEventId: undefined,
        diditEventAt: undefined,
        diditManualDecisionAt: undefined,
        diditReconciledAt: undefined,
        idVerifyStatus: "processing",
        verificationUpdatedAt: Date.now(),
      });
    }
    return true;
  },
});

/** Didit webhooks are signed in the node action. Never accept browser results. */
export const setDiditResult = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    sessionId: v.string(),
    eventId: v.string(),
    status: v.union(v.literal("processing"), v.literal("manual_review"), v.literal("verified"), v.literal("requires_input"), v.literal("rejected")),
    providerStatus: v.optional(v.string()),
    note: v.optional(v.string()),
    poaPostcodes: v.array(v.string()),
    eventAt: v.number(),
  },
  handler: async (ctx, { bookingId, sessionId, eventId, status, providerStatus, note, poaPostcodes, eventAt }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.verificationProvider !== "didit" || b.diditSessionId !== sessionId) return false;
    if (b.diditEventId === eventId || (b.diditEventAt ?? 0) > eventAt ||
        (b.diditManualDecisionAt ?? 0) >= eventAt) return true;
    // The provider checks the bill and its holder. Also require its UK postcode
    // to match the address this renter supplied for the booking.
    const postcode = (s: string) => s.toUpperCase().match(/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/)?.[0].replace(/\s/g, "") ?? "";
    if (status === "verified" && (!postcode(b.billingAddress ?? "") || !poaPostcodes.length ||
        !poaPostcodes.every((p) => postcode(p) === postcode(b.billingAddress ?? "")))) {
      status = "manual_review";
      note = "The verified address does not match the booking address. Please contact us.";
    }
    // A deliberate admin approval can override a feature-level review. Didit
    // still sends top-level Approved with the original feature decisions; keep
    // that human decision, while allowing an actual later decline to revoke it.
    if (b.idVerificationSource === "manual" && b.idVerifyStatus === "verified" &&
        providerStatus === "Approved" && status === "manual_review") {
      await ctx.db.patch(bookingId, { diditEventId: eventId, diditEventAt: eventAt });
      return true;
    }
    if (b.idVerifyStatus === "verified" && status === "processing") {
      await ctx.db.patch(bookingId, { diditEventId: eventId, diditEventAt: eventAt });
      return true;
    }
    const previous = b.idVerifyStatus;
    await ctx.db.patch(bookingId, {
      diditEventId: eventId,
      diditEventAt: eventAt,
      idVerifyStatus: status,
      idVerificationSource: "didit",
      idVerifiedAt: status === "verified" ? Date.now() : undefined,
      verificationNote: note?.slice(0, 400),
      verificationUpdatedAt: Date.now(),
    });
    if (status === "verified") await markAccountVerified(ctx, bookingId);
    if (previous !== status && ["verified", "manual_review", "requires_input", "rejected"].includes(status))
      await ctx.scheduler.runAfter(0, internal.notify.verificationEmail, { bookingId, status });
    if (previous !== status && status === "manual_review")
      await ctx.scheduler.runAfter(0, internal.notify.verificationReviewAlert, { bookingId });
    return true;
  },
});

async function markAccountVerified(ctx: any, bookingId: any) {
  const b = await ctx.db.get(bookingId);
  if (!b?.guestEmail) return;
  const acct = await ctx.db
    .query("accounts")
    .withIndex("by_email", (q: any) => q.eq("email", b.guestEmail.trim().toLowerCase()))
    .first();
  if (acct) await ctx.db.patch(acct._id, { idVerified: true });
}

export const adminSetIdStatus = mutation({
  args: { token: v.string(), bookingId: v.id("bookings"), status: v.string(), note: v.string() },
  handler: async (ctx, { token, bookingId, status, note }) => {
    await assertAdmin(ctx, token, "bookings.adminSetIdStatus");
    const b = await ctx.db.get(bookingId);
    if (!b || !["confirmed", "active"].includes(b.status))
      throw new Error("Only a paid, open rental can receive a manual verification decision.");
    if (b.verificationProvider === "didit")
      throw new Error("Use the Didit review action so the provider and booking stay in sync.");
    const prev = b.idVerifyStatus ?? "required";
    if (!["verified", "requires_input", "rejected"].includes(status)) throw new Error("Invalid review decision");
    if (note.trim().length < 5) throw new Error("Record why the manual decision was made.");
    await ctx.db.patch(bookingId, {
      idVerifyStatus: status,
      idVerificationSource: "manual",
      idVerifiedAt: status === "verified" ? Date.now() : undefined,
      verificationUpdatedAt: Date.now(),
      verificationNote: note.trim().slice(0, 400),
    });
    if (status === "verified") await markAccountVerified(ctx, bookingId);
    if (status !== prev && ["verified", "requires_input", "canceled"].includes(status))
      await ctx.scheduler.runAfter(0, internal.notify.verificationEmail, { bookingId, status });
  },
});

/** Called only after the authenticated admin action has read and, when needed,
 * updated this exact Didit session. A signed webhook may arrive first. */
export const setDiditManualReview = internalMutation({
  args: {
    bookingId: v.id("bookings"), sessionId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("resubmit"), v.literal("decline")),
    note: v.string(),
  },
  handler: async (ctx, { bookingId, sessionId, decision, note }) => {
    const b = await ctx.db.get(bookingId);
    if (!b || b.verificationProvider !== "didit" || b.diditSessionId !== sessionId ||
        !["confirmed", "active"].includes(b.status)) return false;
    const previous = b.idVerifyStatus ?? "required";
    if (decision === "approve" && !["manual_review", "rejected", "verified"].includes(previous)) return false;
    if (decision !== "approve" && !["manual_review", "rejected", "requires_input"].includes(previous)) return false;
    const status = decision === "approve" ? "verified" : decision === "resubmit" ? "requires_input" : "rejected";
    await ctx.db.patch(bookingId, {
      idVerifyStatus: status,
      idVerificationSource: "manual",
      diditManualDecisionAt: Date.now(),
      idVerifiedAt: status === "verified" ? Date.now() : undefined,
      verificationUpdatedAt: Date.now(),
      verificationNote: decision === "resubmit" ? "Please replace the requested verification document."
        : decision === "decline" ? "Identity and address verification was declined. Please contact us."
        : note.trim().slice(0, 400),
    });
    if (status === "verified") await markAccountVerified(ctx, bookingId);
    if (status !== previous)
      await ctx.scheduler.runAfter(0, internal.notify.verificationEmail, { bookingId, status });
    return true;
  },
});

// ── Customer self-service cancellation (Phase 3) ──────────────────
/** Read-only context the cancel action needs (ownership, amounts, window, site-only check). */
export const getForCancel = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return null;
    const acct = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()))
      .first();
    const res = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    return {
      accountId: acct?._id ?? null,
      guestEmail: (b.guestEmail ?? "").trim().toLowerCase(),
      status: b.status,
      stripeCheckoutSessionId: b.stripeCheckoutSessionId ?? null,
      total: b.total,
      creditApplied: b.creditApplied ?? 0,
      depositAmount: b.depositAmount,
      currency: b.currency ?? "GBP",
      stripePaymentIntentId: b.stripePaymentIntentId ?? null,
      stripeDepositIntentId: b.stripeDepositIntentId ?? null,
      depositHoldRenewalIntentId: b.depositHoldRenewalIntentId ?? null,
      depositHoldPreviousIntentIds: b.depositHoldPreviousIntentIds ?? [],
      cancelledAt: b.cancelledAt ?? null,
      earliestStart: b.lineItems.length ? Math.min(...b.lineItems.map((li) => li.start)) : null,
      siteOnly: res.every((r) => r.source === "site"), // never customer-cancel Hygglo-sourced rows
    };
  },
});

/** Atomically finalise a cancellation: flip status, free the ledger, issue store credit if late,
 *  post a chat note, schedule the email. Idempotent (no-op if already cancelled). The Stripe
 *  refund itself is done by the action before calling this. */
export const _finalizeCancellation = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    accountId: v.optional(v.id("accounts")),
    mode: v.union(v.literal("none"), v.literal("refund"), v.literal("credit")),
    refundAmount: v.number(),
    creditAmount: v.number(),
    currency: v.string(),
    adminReason: v.optional(v.string()),
  },
  handler: async (ctx, { bookingId, accountId, mode, refundAmount, creditAmount, currency, adminReason }) => {
    const b = await ctx.db.get(bookingId);
    if (!b) return { ok: false as const };
    if (b.status === "cancelled") return { ok: true as const, already: true };

    let creditId: any = undefined;
    if (creditAmount > 0 && accountId) {
      creditId = await ctx.db.insert("credits", {
        accountId,
        amount: creditAmount,
        remaining: creditAmount,
        currency,
        reason: `${mode === "refund" ? "restored_credit" : "late_cancellation"}:${bookingId}`,
        bookingId,
        createdAt: Date.now(),
        expiresAt: Date.now() + CANCELLATION_CREDIT_DAYS * 86400000,
        status: "active",
      });
    }
    await ctx.db.patch(bookingId, {
      status: "cancelled",
      cancelledAt: Date.now(),
      adminCancellationReason: adminReason,
      refundAmount,
      creditIssuedId: creditId,
      depositRefunded: mode !== "none" ? true : (b.depositRefunded ?? false),
    });
    const res = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
      .collect();
    for (const r of res) {
      if (r.status === "hold") await ctx.db.delete(r._id);
      else await ctx.db.patch(r._id, { status: "cancelled" });
    }
    if (accountId) {
      const note =
        mode === "credit"
          ? `Your booking was cancelled. £${refundAmount} is being returned to your card, and £${creditAmount} account credit (valid ${CANCELLATION_CREDIT_DAYS} days) has been added to your account.`
          : mode === "refund"
            ? `Your booking was cancelled. £${refundAmount} is being returned to your card.${creditAmount > 0 ? ` £${creditAmount} of previously used credit has been restored to your account for ${CANCELLATION_CREDIT_DAYS} days.` : ""}`
            : `Your booking was cancelled.`;
      await ctx.db.insert("messages", { accountId, bookingId, sender: "system", text: note, at: Date.now(), readByOwner: true });
    }
    await ctx.scheduler.runAfter(0, internal.notify.cancellationEmail, { bookingId, mode, refundAmount, creditAmount });
    await ctx.scheduler.runAfter(0, internal.rmv2_webhook.push, { bookingId });
    return { ok: true as const, creditId };
  },
});
