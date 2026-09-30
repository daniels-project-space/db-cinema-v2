"use node";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
const sb = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw Error("Stripe is not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};
const money = (n: number) => Math.round(n * 100);
function expires(intent: Stripe.PaymentIntent) {
  const c: any = intent.latest_charge;
  return typeof c === "object"
    ? c?.payment_method_details?.card?.capture_before * 1000 || undefined
    : undefined;
}
async function ensureSession(ctx: any, id: any) {
  const state: any = await ctx.runQuery(internal.rentalAdditionState.context, {
    id,
  });
  if (!state?.booking) throw Error("Rental addition missing");
  const { addition: r, booking: b } = state;
  if (r.sessionId) {
    const existing = await sb().checkout.sessions.retrieve(r.sessionId);
    return existing;
  }
  // The recovery worker follows the same original-payment preflight as the owner action.
  if (r.draftReplacement && r.baseSessionId) {
    const original = await sb().checkout.sessions.retrieve(r.baseSessionId);
    if (original.payment_status === "paid") {
      await ctx.runMutation(internal.rentalAdditionState.close, {
        id,
        refunded: false,
        preserveBooking: true,
      });
      await ctx.runAction(api.checkout.finalize, { sessionId: original.id });
      throw Error(
        "The original checkout completed; this replacement proposal was withdrawn.",
      );
    }
    if (original.status === "open")
      await sb().checkout.sessions.expire(original.id);
    else if (original.status !== "expired")
      throw Error("The original checkout payment is still processing.");
  }
  // Recover an uncertain create response before the fixed session expiry becomes invalid.
  if (Date.now() > r.createdAt + 23.5 * 3600000) {
    for await (const found of sb().checkout.sessions.list({
      created: { gte: Math.floor(r.createdAt / 1000) - 5 },
      limit: 100,
    })) {
      if (
        found.metadata?.rentalAdditionId === id ||
        found.metadata?.pendingAdditionId === id
      ) {
        await ctx.runMutation(internal.rentalAdditionState.bindSession, {
          id,
          sessionId: found.id,
          url: found.url ?? "",
        });
        return found;
      }
    }
    await ctx.runMutation(internal.rentalAdditionState.close, {
      id,
      refunded: false,
    });
    throw Error(
      "This saved proposal expired without payment. Start a new item addition.",
    );
  }
  const amount =
    (r.draftReplacement ? (r.baseTotal ?? 0) : 0) +
    r.lineTotal +
    r.securityCharge;
  if (!Number.isSafeInteger(money(amount)) || amount <= 0)
    throw Error("The rental update has no payable amount");
  const origin = new URL(process.env.APP_URL ?? "https://dbcinemarentals.com")
    .origin;
  const session = await sb().checkout.sessions.create(
    {
      integration_identifier: `db-rental-update-${Array.from(createHash("sha256").update(r.requestId).digest().subarray(0, 8), (n) => String.fromCharCode(97 + (n % 26))).join("")}`,
      custom_text: {
        submit: {
          message: `By paying you accept the updated rental under our [terms](${origin}/legal/terms), including the stated refundable security charge and full card hold. Documented late fees and damage are handled under your rental agreement.`,
        },
      },
      mode: "payment",
      expires_at: Math.floor(r.createdAt / 1000) + 24 * 60 * 60,
      payment_method_types: ["card"],
      customer_email: b.guestEmail,
      customer_creation: "always",
      payment_intent_data: { setup_future_usage: "off_session" },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: money(amount),
            product_data: {
              name: r.draftReplacement
                ? "Updated DB Cinema rental"
                : "DB Cinema rental item addition",
              description:
                `${r.qty}× ${r.title}. Rental £${r.lineTotal.toFixed(2)}; additional refundable security £${r.securityCharge.toFixed(2)}. Updated card hold £${r.holdTotal.toFixed(2)}.${r.draftReplacement ? ` Includes existing rental checkout £${(r.baseTotal ?? 0).toFixed(2)}.` : ""}`.slice(
                  0,
                  500,
                ),
            },
          },
        },
      ],
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/account?rental=${r.bookingId}#chat`,
      metadata: r.draftReplacement
        ? { bookingId: r.bookingId, pendingAdditionId: r._id }
        : { rentalAdditionId: r._id, additionBookingId: r.bookingId },
    },
    { idempotencyKey: `dbc-addition-checkout-${id}` },
  );
  if (!session.url) throw Error("Stripe did not provide a payment link");
  await ctx.runMutation(internal.rentalAdditionState.bindSession, {
    id,
    sessionId: session.id,
    url: session.url,
  });
  return session;
}
async function withdraw(ctx: any, id: any) {
  const state: any = await ctx.runQuery(internal.rentalAdditionState.context, {
    id,
  });
  if (!state) return;
  const r = state.addition;
  if (["applied", "applied_draft"].includes(r.status))
    throw Error(
      "This item is already part of the rental. Use rental refund or cancellation controls.",
    );
  if (["refunded", "expired"].includes(r.status)) return;
  if (
    !r.draftReplacement &&
    !r.sessionId &&
    !r.paymentIntentId &&
    r.lineTotal + r.securityCharge === 0
  ) {
    await ctx.runMutation(internal.rentalAdditionState.close, {
      id,
      refunded: false,
    });
    return;
  }
  const session = await ensureSession(ctx, id);
  if (session.status === "open")
    await sb().checkout.sessions.expire(session.id);
  else if (session.status !== "expired" && session.payment_status !== "paid")
    throw Error(
      "The addition payment is still processing. Wait for its provider result.",
    );
  const paid = session.payment_status === "paid";
  const payment =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (paid && payment) {
    await ctx.runMutation(internal.rentalAdditionState.markPaid, {
      id,
      paymentIntentId: payment,
    });
    const refund = await sb().refunds.create(
      { payment_intent: payment },
      { idempotencyKey: `dbc-addition-withdraw-${id}` },
    );
    if (refund.status === "failed" || refund.status === "canceled")
      throw Error(
        "The proposal refund failed. The rental remains locked until the payment is resolved.",
      );
  }
  if (r.holdIntentId && r.holdIntentId !== r.oldHoldId) {
    const hold = await sb().paymentIntents.retrieve(r.holdIntentId);
    if (
      [
        "requires_capture",
        "requires_action",
        "requires_confirmation",
        "requires_payment_method",
      ].includes(hold.status)
    )
      await sb().paymentIntents.cancel(
        hold.id,
        {},
        { idempotencyKey: `dbc-addition-hold-close-${id}` },
      );
  }
  await ctx.runMutation(internal.rentalAdditionState.close, {
    id,
    refunded: paid,
  });
}
async function releaseReplacedHold(ctx: any, r: any) {
  if (!r.holdIntentId || !r.oldHoldId || r.holdIntentId === r.oldHoldId) return;
  const old = await sb().paymentIntents.retrieve(r.oldHoldId);
  if (
    [
      "requires_capture",
      "requires_action",
      "requires_confirmation",
      "requires_payment_method",
    ].includes(old.status)
  )
    await sb().paymentIntents.cancel(
      old.id,
      {},
      { idempotencyKey: `dbc-addition-old-hold-${r._id}` },
    );
  await ctx.runMutation(internal.bookings.clearPreviousHold, {
    bookingId: r.bookingId,
    intentId: r.oldHoldId,
  });
}
async function finish(
  ctx: any,
  id: any,
  session: Stripe.Checkout.Session,
): Promise<{
  bookingId: string;
  status: string;
  clientSecret?: string;
  closed?: boolean;
}> {
  const state: any = await ctx.runQuery(internal.rentalAdditionState.context, {
    id,
  });
  if (!state) throw Error("Addition missing");
  const { addition: r, booking: b } = state;
  if (session.id !== r.sessionId || session.payment_status !== "paid")
    throw Error("Addition payment has not completed");
  if (["refunded", "expired"].includes(r.status))
    return { bookingId: r.bookingId, status: r.status, closed: true };
  if (["applied", "applied_draft"].includes(r.status)) {
    if (r.status === "applied") await releaseReplacedHold(ctx, r);
    return { bookingId: r.bookingId, status: "held" };
  }
  if (Date.now() > r.createdAt + 24 * 3600000) {
    await withdraw(ctx, id);
    return { bookingId: r.bookingId, status: "refunded", closed: true };
  }
  const payment =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!payment) throw Error("Paid addition has no card payment");
  if (
    session.amount_total !==
    money(
      (r.draftReplacement ? (r.baseTotal ?? 0) : 0) +
        r.lineTotal +
        r.securityCharge,
    )
  )
    throw Error("Addition paid amount does not match the saved order");
  await ctx.runMutation(internal.rentalAdditionState.markPaid, {
    id,
    paymentIntentId: payment,
  });
  if (
    !b ||
    b.cancellationDecision ||
    b.returnDecision ||
    !["pending_payment", "confirmed", "active"].includes(b.status)
  ) {
    await withdraw(ctx, id);
    return { bookingId: r.bookingId, status: "refunded", closed: true };
  }
  if (r.draftReplacement) {
    const applied = await ctx.runMutation(internal.rentalAdditionState.apply, {
      id,
    });
    if (applied.closed) {
      await withdraw(ctx, id);
      return { bookingId: r.bookingId, status: "refunded", closed: true };
    }
    return { bookingId: r.bookingId, status: "draft_applied" };
  }
  let intent: Stripe.PaymentIntent | null = null;
  if (r.holdTotal > 0) {
    if (r.holdIntentId)
      intent = await sb().paymentIntents.retrieve(r.holdIntentId, {
        expand: ["latest_charge"],
      });
    else if (
      r.holdTotal === (b.depositHoldAmount ?? 0) &&
      b.stripeDepositIntentId
    ) {
      const old = await sb().paymentIntents.retrieve(b.stripeDepositIntentId, {
        expand: ["latest_charge"],
      });
      if (old.status === "requires_capture" && (expires(old) ?? 0) > Date.now())
        intent = old;
    }
    if (!intent) {
      const paid = await sb().paymentIntents.retrieve(payment);
      const customer =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      const method =
        typeof paid.payment_method === "string"
          ? paid.payment_method
          : paid.payment_method?.id;
      if (!customer || !method)
        throw Error("Addition card details are unavailable");
      try {
        intent = await sb().paymentIntents.create(
          {
            amount: money(r.holdTotal),
            currency: "gbp",
            customer,
            payment_method: method,
            allowed_payment_method_types: ["card"],
            capture_method: "manual",
            confirm: true,
            off_session: true,
            expand: ["latest_charge"],
            metadata: {
              bookingId: r.bookingId,
              rentalAdditionId: id,
              purpose: "replacement_rental_security_hold",
            },
          },
          { idempotencyKey: `dbc-addition-security-${id}` },
        );
      } catch (e: any) {
        const failed = e?.raw?.payment_intent?.id ?? e?.payment_intent?.id;
        if (!failed) throw e;
        intent = await sb().paymentIntents.retrieve(failed, {
          expand: ["latest_charge"],
        });
      }
    }
    const status =
      intent.status === "requires_capture"
        ? "held"
        : intent.status === "requires_action"
          ? "requires_action"
          : "failed";
    const expiry = expires(intent);
    await ctx.runMutation(internal.rentalAdditionState.bindHold, {
      id,
      intentId: intent.id,
      status,
      expiresAt: expiry,
    });
    if (status !== "held")
      return {
        bookingId: r.bookingId,
        status,
        clientSecret:
          status === "requires_action"
            ? (intent.client_secret ?? undefined)
            : undefined,
      };
    if (!expiry || expiry <= Date.now())
      throw Error("The replacement card hold has expired");
  }
  const result = await ctx.runMutation(internal.rentalAdditionState.apply, {
    id,
  });
  if (result.closed) {
    await withdraw(ctx, id);
    return { bookingId: r.bookingId, status: "refunded", closed: true };
  }
  await releaseReplacedHold(ctx, {
    ...r,
    holdIntentId: intent?.id ?? r.holdIntentId,
  });
  return { bookingId: r.bookingId, status: "held" };
}
export const start = action({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    requestId: v.string(),
    listingId: v.id("listings"),
    qty: v.number(),
    reason: v.string(),
    start: v.optional(v.number()),
    end: v.optional(v.number()),
    complimentary: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; id: string; applied?: boolean }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, {
      token: args.token,
      fn: "rentalAdditions.start",
    });
    let r: any = await ctx.runQuery(internal.rentalAdditionState.existing, {
      requestId: args.requestId,
    });
    if (r && r.bookingId !== args.bookingId)
      throw Error("Request belongs to another rental");
    if (!r) {
      const b: any = await ctx.runQuery(
        internal.rentalOperations.refundContext,
        { bookingId: args.bookingId },
      );
      if (!b) throw Error("Rental missing");
      if (b.status === "pending_payment" && !b.stripeCheckoutSessionId)
        throw Error("The initial checkout is still being prepared");
      r = await ctx.runMutation(internal.rentalAdditionState.prepare, args);
    }
    // Reserve and validate the proposed order before expiring its original checkout.
    // Every retry attests the original provider state until the replacement is bound.
    if (r.draftReplacement && !r.sessionId && r.baseSessionId) {
      const original = await sb().checkout.sessions.retrieve(r.baseSessionId);
      if (original.payment_status === "paid") {
        await ctx.runMutation(internal.rentalAdditionState.close, {
          id: r._id,
          refunded: false,
          preserveBooking: true,
        });
        await ctx.runAction(api.checkout.finalize, { sessionId: original.id });
        throw Error(
          "The original checkout completed. Refresh the rental before adding items.",
        );
      }
      if (original.status === "open")
        await sb().checkout.sessions.expire(original.id);
      else if (original.status !== "expired")
        throw Error(
          "The original payment is processing. Retry this saved proposal after its provider result.",
        );
    }
    if (!r.draftReplacement && r.lineTotal + r.securityCharge === 0) {
      const state: any = await ctx.runQuery(
        internal.rentalAdditionState.context,
        { id: r._id },
      );
      const hold = state.booking?.stripeDepositIntentId
        ? await sb().paymentIntents.retrieve(
            state.booking.stripeDepositIntentId,
            { expand: ["latest_charge"] },
          )
        : null;
      if (
        !hold ||
        hold.status !== "requires_capture" ||
        (expires(hold) ?? 0) <= Date.now() ||
        r.holdTotal !== (state.booking.depositHoldAmount ?? 0)
      )
        throw Error(
          "Resolve the existing security hold before adding this complimentary item",
        );
      await ctx.runMutation(internal.rentalAdditionState.bindHold, {
        id: r._id,
        intentId: hold.id,
        status: "held",
        expiresAt: expires(hold),
      });
      const result = await ctx.runMutation(internal.rentalAdditionState.apply, {
        id: r._id,
      });
      if (result.closed)
        throw Error("This rental can no longer accept the item");
      return { url: "", id: r._id, applied: true };
    }
    const session = await ensureSession(ctx, r._id);
    if (!session.url) throw Error("The addition checkout is no longer open");
    return { url: session.url, id: r._id };
  },
});
export const withdrawByOwner = action({
  args: { token: v.string(), id: v.id("rental_additions") },
  handler: async (ctx, { token, id }) => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, {
      token,
      fn: "rentalAdditions.withdraw",
    });
    await withdraw(ctx, id);
    return { ok: true };
  },
});
export const finalizePaid = internalAction({
  args: { id: v.id("rental_additions"), sessionId: v.string() },
  handler: async (ctx, { id, sessionId }) =>
    finish(ctx, id, await sb().checkout.sessions.retrieve(sessionId)),
});
export const sync = action({
  args: { sessionId: v.string() },
  handler: async (
    ctx,
    { sessionId },
  ): Promise<{
    bookingId: string;
    status: string;
    clientSecret?: string;
    closed?: boolean;
  }> => {
    const session = await sb().checkout.sessions.retrieve(sessionId);
    const id = session.metadata?.rentalAdditionId;
    if (!id) throw Error("Not an item addition checkout");
    return finish(ctx, id, session);
  },
});
export const reconcile = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number }> => {
    const rows: any[] = await ctx.runQuery(
      internal.rentalAdditionState.open,
      {},
    );
    for (const r of rows) {
      try {
        if (Date.now() > r.createdAt + 24 * 3600000 && r.sessionId) {
          await withdraw(ctx, r._id);
          continue;
        }
        if (!r.draftReplacement && r.lineTotal + r.securityCharge === 0)
          continue;
        const session = await ensureSession(ctx, r._id);
        if (session.payment_status === "paid") {
          if (r.draftReplacement)
            await ctx.runAction(api.checkout.finalize, {
              sessionId: session.id,
            });
          else await finish(ctx, r._id, session);
        } else if (session.status === "expired")
          await ctx.runMutation(internal.rentalAdditionState.close, {
            id: r._id,
            refunded: false,
          });
      } catch (e) {
        console.error(
          "Rental addition reconciliation pending",
          r._id,
          String(e),
        );
      } finally {
        await ctx.runMutation(internal.rentalAdditionState.touch, {
          id: r._id,
        });
      }
    }
    return { checked: rows.length };
  },
});

/** Customer can approve the bank challenge for the owner's saved proposal, never edit it. */
export const resumeByCustomer = action({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (
    ctx,
    { token, bookingId },
  ): Promise<{ status: string; clientSecret?: string }> => {
    const r: any = await ctx.runQuery(api.rentalAdditionState.customerState, {
      token,
      bookingId,
    });
    if (!r?.sessionId)
      throw Error("No item addition is waiting for bank approval");
    const session = await sb().checkout.sessions.retrieve(r.sessionId);
    if (session.payment_status !== "paid")
      return { status: "awaiting_payment" };
    if (session.metadata?.pendingAdditionId) {
      const result = await ctx.runAction(api.checkout.finalize, {
        sessionId: session.id,
      });
      return {
        status: result.holdStatus ?? "pending",
        clientSecret: result.holdClientSecret,
      };
    }
    return finish(ctx, r.id, session);
  },
});
