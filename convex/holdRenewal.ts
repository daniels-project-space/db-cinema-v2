"use node";

import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { sendMail } from "./lib/mailer";

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

function captureBefore(intent: Stripe.PaymentIntent): number | undefined {
  const charge = intent.latest_charge;
  if (!charge || typeof charge === "string") return undefined;
  const seconds = (charge as any).payment_method_details?.card?.capture_before;
  return typeof seconds === "number" ? seconds * 1000 : undefined;
}

async function notify(email: string | null, subject: string, html: string) {
  if (email) await sendMail({ to: email, subject, html });
}

async function releasePrevious(ctx: any, bookingId: any, ids: string[], sb: Stripe) {
  for (const id of ids) {
    try {
      const old = await sb.paymentIntents.retrieve(id);
      if (old.status === "requires_capture") await sb.paymentIntents.cancel(id);
      // Keep the cleanup record if Stripe could not be reached.
      await ctx.runMutation(internal.bookings.clearPreviousHold, { bookingId, intentId: id });
    } catch (error) {
      console.error("Unable to release superseded security hold", id, error);
    }
  }
}

async function reconcile(ctx: any, bookingId: any, oldId: string, newId: string, sb: Stripe): Promise<string> {
  const intent = await sb.paymentIntents.retrieve(newId, { expand: ["latest_charge"] });
  if (intent.status === "requires_capture") {
    const expiresAt = captureBefore(intent);
    if (!expiresAt || expiresAt <= Date.now()) {
      await sb.paymentIntents.cancel(newId).catch(console.error);
      await ctx.runMutation(internal.bookings.setRenewalResult, {
        bookingId, oldIntentId: oldId, intentId: newId, status: "failed",
      });
      return "failed";
    }
    const replaced: boolean = await ctx.runMutation(internal.bookings.replaceHold, {
      bookingId, oldIntentId: oldId, newIntentId: newId, expiresAt,
    });
    if (replaced) await releasePrevious(ctx, bookingId, [oldId], sb);
    else if ((await ctx.runQuery(internal.bookings.renewalContext, { bookingId }))?.oldIntentId !== newId) {
      // Booking ended or another worker won the race: never leave a new hold orphaned.
      await sb.paymentIntents.cancel(newId).catch(console.error);
    }
    return replaced ? "renewed" : "stale";
  }
  const status = intent.status === "requires_action" ? "requires_action" : "failed";
  await ctx.runMutation(internal.bookings.setRenewalResult, {
    bookingId, oldIntentId: oldId, intentId: newId, status,
  });
  return status;
}

export const renewOne = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    const sb = stripe();
    const before: any = await ctx.runQuery(internal.bookings.renewalContext, { bookingId });
    if (!before) return;
    await releasePrevious(ctx, bookingId, before.previousIntentIds, sb);
    if (!(await ctx.runMutation(internal.bookings.claimRenewal, { bookingId }))) return;
    const b: any = await ctx.runQuery(internal.bookings.renewalContext, { bookingId });
    if (!b?.oldIntentId) return;
    let nextId: string | undefined;
    try {
      const old = await sb.paymentIntents.retrieve(b.oldIntentId);
      const customer = typeof old.customer === "string" ? old.customer : old.customer?.id;
      const method = typeof old.payment_method === "string" ? old.payment_method : old.payment_method?.id;
      if (!customer || !method) throw new Error("Saved card is unavailable");
      let next: Stripe.PaymentIntent;
      try {
        next = await sb.paymentIntents.create({
          amount: Math.round(b.amount * 100), currency: "gbp", customer,
          payment_method: method, allowed_payment_method_types: ["card"],
          capture_method: "manual", confirm: true, off_session: true,
          ...(process.env.STRIPE_EXTENDED_AUTH_ENABLED === "true"
            ? { payment_method_options: { card: { request_extended_authorization: "if_available" as const } } }
            : {}),
          metadata: { bookingId, purpose: "security_hold_renewal", replaces: b.oldIntentId },
          expand: ["latest_charge"],
        }, { idempotencyKey: `dbc-hold-renew-${bookingId}-${b.oldIntentId}` });
      } catch (e: any) {
        const id = e?.raw?.payment_intent?.id ?? e?.payment_intent?.id;
        if (!id) throw e;
        next = await sb.paymentIntents.retrieve(id, { expand: ["latest_charge"] });
      }
      nextId = next.id;
      await ctx.runMutation(internal.bookings.setRenewalResult, {
        bookingId, oldIntentId: b.oldIntentId, intentId: nextId, status: "processing",
      });
      const status = await reconcile(ctx, bookingId, b.oldIntentId, next.id, sb);
      if (status === "requires_action") await notify(b.guestEmail,
        "Action needed to keep your rental security hold active",
        `<p>Your bank needs you to approve a replacement security hold of £${b.amount}. The earlier hold will be released after the new one is authorised. Please sign in at <a href="${process.env.APP_URL ?? "https://dbcinemarentals.com"}/account">your rental account</a> to approve it before the current hold expires. This is a hold, not a new payment.</p>`).catch(console.error);
      if (status === "failed") await notify(b.guestEmail,
        "Your rental security hold needs attention",
        `<p>We could not renew your £${b.amount} security hold. Please contact us before the existing hold expires. Your bank may require a new card or direct authentication.</p>`).catch(console.error);
    } catch (e: any) {
      await ctx.runMutation(internal.bookings.setRenewalResult, {
        bookingId, oldIntentId: b.oldIntentId, intentId: nextId,
        status: nextId ? "processing" : "failed",
      });
      if (!nextId) await notify(b.guestEmail, "Your rental security hold needs attention",
        `<p>We could not renew your £${b.amount} security hold. Please contact us before the existing hold expires.</p>`).catch(console.error);
      console.error("Security hold renewal failed", bookingId, e);
    }
  },
});

export const renewDue = internalAction({
  args: {},
  handler: async (ctx) => {
    const ids: any[] = await ctx.runQuery(internal.bookings.renewalCandidates, {});
    for (const bookingId of ids) await ctx.runAction(internal.holdRenewal.renewOne, { bookingId });
  },
});

async function owned(ctx: any, token: string, bookingId: any) {
  const account: any = await ctx.runQuery(api.accounts.me, { token });
  const b: any = await ctx.runQuery(internal.bookings.renewalContext, { bookingId });
  if (!account || !b || account.email?.trim().toLowerCase() !== b.guestEmail?.trim().toLowerCase())
    throw new Error("Booking access denied");
  return b;
}

export const resume = action({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    const b = await owned(ctx, token, bookingId);
    if (b.renewalStatus !== "requires_action" || !b.renewalIntentId) return { status: b.renewalStatus ?? "none" };
    const intent = await stripe().paymentIntents.retrieve(b.renewalIntentId);
    return { status: intent.status, clientSecret: intent.status === "requires_action" ? intent.client_secret : null };
  },
});

export const sync = action({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }): Promise<{ status: string }> => {
    const b = await owned(ctx, token, bookingId);
    if (!b.renewalIntentId || !b.oldIntentId) return { status: b.renewalStatus ?? "none" };
    const sb = stripe();
    const status: string = await reconcile(ctx, bookingId, b.oldIntentId, b.renewalIntentId, sb);
    return { status };
  },
});
