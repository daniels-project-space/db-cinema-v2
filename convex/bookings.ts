import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { peak, type Iv } from "./availability";

function assertAdmin(token: string) {
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    throw new Error("unauthorized");
  }
}

const lineItem = v.object({
  listingId: v.id("listings"),
  title: v.string(),
  start: v.number(),
  end: v.number(),
  qty: v.number(),
  lineTotal: v.number(),
});

export const createPending = internalMutation({
  args: {
    customerEmail: v.string(),
    customerName: v.optional(v.string()),
    phone: v.optional(v.string()),
    fulfilment: v.union(v.literal("pickup"), v.literal("delivery")),
    address: v.optional(v.string()),
    deliveryFee: v.number(),
    lineItems: v.array(lineItem),
    subtotal: v.number(),
    depositAmount: v.number(),
    promoCode: v.optional(v.string()),
    discount: v.optional(v.number()),
    total: v.number(),
    creditAccountId: v.optional(v.id("accounts")),
    currency: v.string(),
    agreementName: v.optional(v.string()),
    agreementDocs: v.optional(
      v.array(v.object({ kind: v.string(), version: v.string() })),
    ),
    protection: v.optional(v.string()),
    idVerifyStatus: v.optional(v.string()),
    pickupTime: v.optional(v.string()),
    returnTime: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    let customer = await ctx.db
      .query("customers")
      .withIndex("by_email", (q) => q.eq("email", a.customerEmail))
      .first();
    if (!customer) {
      const id = await ctx.db.insert("customers", {
        email: a.customerEmail,
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
      const acct: any = await ctx.db.get(a.creditAccountId);
      if (acct) {
        const now = Date.now();
        const credits = await ctx.db
          .query("credits")
          .withIndex("by_account", (q) => q.eq("accountId", a.creditAccountId!))
          .collect();
        const balance = credits
          .filter((c) => c.status === "active" && c.expiresAt > now)
          .reduce((n, c) => n + c.remaining, 0);
        const pending = await ctx.db
          .query("bookings")
          .withIndex("by_guestEmail", (q) => q.eq("guestEmail", acct.email))
          .collect();
        const reserved = pending
          .filter((b) => b.status === "pending_payment")
          .reduce((n, b) => n + (b.creditApplied ?? 0), 0);
        const available = Math.max(0, balance - reserved);
        creditApplied = Math.min(available, Math.max(0, a.total - a.depositAmount));
      }
    }
    const chargedTotal = a.total - creditApplied;

    const bookingId = await ctx.db.insert("bookings", {
      customerId: customer!._id,
      guestEmail: a.customerEmail,
      status: "pending_payment",
      lineItems: a.lineItems,
      fulfilment: a.fulfilment,
      address: a.address,
      deliveryFee: a.deliveryFee,
      subtotal: a.subtotal,
      discount: a.discount ?? 0,
      promoCode: a.promoCode,
      depositAmount: a.depositAmount,
      total: chargedTotal,
      creditApplied,
      currency: a.currency,
      agreementName: a.agreementName,
      agreementSignedAt: a.agreementName ? Date.now() : undefined,
      agreementDocs: a.agreementDocs,
      protection: a.protection,
      idVerifyStatus: a.idVerifyStatus ?? "required",
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
      const existing: Iv[] = (
        await ctx.db.query("reservations").withIndex("by_unit", (q) => q.eq("inventoryUnitId", uid as any)).collect()
      )
        .filter(
          (r: any) =>
            ACTIVE.has(r.status) && r.start <= hi && r.end >= lo && r.bookingId !== bookingId &&
            !(r.status === "hold" && (r.holdExpiresAt ?? 0) < now),
        )
        .map((r: any) => ({ start: r.start, end: r.end, qty: r.qty || 1 }));
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
        await ctx.db.delete(h._id);
        n++;
      }
    return { released: n };
  },
});

export const confirm = internalMutation({
  args: { bookingId: v.id("bookings"), paymentIntentId: v.optional(v.string()) },
  handler: async (ctx, { bookingId, paymentIntentId }) => {
    const booking = await ctx.db.get(bookingId);
    if (!booking) throw new Error("booking not found");
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
          .filter((c) => c.status === "active" && c.expiresAt > now && c.remaining > 0)
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
    return { already: false };
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
  },
});

export const adminList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
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
      total: b.total,
      depositRefunded: b.depositRefunded ?? false,
      idVerifyStatus: b.idVerifyStatus ?? "required",
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
      v.literal("returned"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, { token, bookingId, status }) => {
    assertAdmin(token);
    await ctx.db.patch(bookingId, { status });
    // free the ledger when a booking ends
    if (status === "returned" || status === "cancelled") {
      const res = await ctx.db
        .query("reservations")
        .withIndex("by_booking", (q) => q.eq("bookingId", bookingId))
        .collect();
      for (const r of res)
        await ctx.db.patch(r._id, {
          status: status === "returned" ? "returned" : "cancelled",
        });
    }
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
      depositRefunded: b.depositRefunded ?? false,
    };
  },
});

export const markDepositRefunded = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    await ctx.db.patch(bookingId, { depositRefunded: true });
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
      deliveryFee: b.deliveryFee,
      total: b.total,
      currency: b.currency,
      fulfilment: b.fulfilment,
      guestEmail: b.guestEmail,
      idVerifyStatus: b.idVerifyStatus ?? "required",
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
      const acct: any = s ? await ctx.db.get(s.accountId) : null;
      if (acct && acct.email === (b.guestEmail ?? "").trim().toLowerCase()) ok = true;
    }
    if (!ok) return null;
    const customer: any = b.customerId ? await ctx.db.get(b.customerId) : null;
    return {
      number: `DBC-${String(b._id).slice(-8).toUpperCase()}`,
      issuedAt: b._creationTime,
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
    };
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
  args: { token: v.string(), bookingId: v.id("bookings"), status: v.string() },
  handler: async (ctx, { token, bookingId, status }) => {
    assertAdmin(token);
    const prev = (await ctx.db.get(bookingId))?.idVerifyStatus ?? "required";
    await ctx.db.patch(bookingId, { idVerifyStatus: status });
    if (status === "verified") await markAccountVerified(ctx, bookingId);
    if (status !== prev && ["verified", "requires_input", "canceled"].includes(status))
      await ctx.scheduler.runAfter(0, internal.notify.verificationEmail, { bookingId, status });
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
      total: b.total,
      depositAmount: b.depositAmount,
      currency: b.currency ?? "GBP",
      stripePaymentIntentId: b.stripePaymentIntentId ?? null,
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
  },
  handler: async (ctx, { bookingId, accountId, mode, refundAmount, creditAmount, currency }) => {
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
        reason: `late_cancellation:${bookingId}`,
        bookingId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 90 * 86400000,
        status: "active",
      });
    }
    await ctx.db.patch(bookingId, {
      status: "cancelled",
      cancelledAt: Date.now(),
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
          ? `Your booking was cancelled. Your deposit is refunded to your card, and £${creditAmount} store credit (valid 90 days) has been added to your account.`
          : mode === "refund"
            ? `Your booking was cancelled and £${refundAmount} has been refunded to your card.`
            : `Your booking was cancelled.`;
      await ctx.db.insert("messages", { accountId, bookingId, sender: "system", text: note, at: Date.now(), readByOwner: true });
    }
    await ctx.scheduler.runAfter(0, internal.notify.cancellationEmail, { bookingId, mode, refundAmount, creditAmount });
    return { ok: true as const, creditId };
  },
});
