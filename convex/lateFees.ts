"use node";

import Stripe from "stripe";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sendMail } from "./lib/mailer";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const gbp = (value: number) => `£${value.toFixed(2)}`;
const londonTime = (ms: number) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(ms));

/** A separate notice for the late-time fee, regardless of funding source. */
export const sendNotice = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    if (!(await ctx.runMutation(internal.bookings.claimLateNotice, { bookingId }))) return;
    const b: any = await ctx.runQuery(internal.bookings.lateFeeContext, { bookingId });
    if (!b?.guestEmail || !b.lateFeeAmount) {
      await ctx.runMutation(internal.bookings.markLateNotice, { bookingId, sent: false });
      return;
    }
    const rows = b.lateFeeBreakdown.map((line: any) =>
      `<li>${esc(line.title)}: ${line.days} extra day${line.days === 1 ? "" : "s"} × ${gbp(line.dailyRate)} = ${gbp(line.amount)}</li>`,
    ).join("");
    let sent = false;
    try {
      sent = await sendMail({
        to: b.guestEmail,
        subject: `Db Cinema rental: separate ${gbp(b.lateFeeAmount)} late-time charge notice`,
        html: `<h2>Late rental time</h2><p>The equipment was recorded as returned ${londonTime(b.actualReturnedAt)} London time, after the agreed ${esc(b.agreedReturnTime ?? "booking")} London return slot on the booked end date. The separate late-time amount is <b>${gbp(b.lateFeeAmount)}</b>:</p><ul>${rows}</ul><p>This is a separately agreed charge. After seven days, an unused active security hold may be applied to this amount; any remaining balance may be attempted on the saved card. We will never collect the same amount twice, and will not attempt collection later than 30 days after return. Your bank may decline or request authentication.</p><p>If the return time or calculation is wrong, reply to this email within seven days. We will pause a disputed charge while we review it.</p>`,
      });
    } catch (e) { console.error("Late fee notice delivery failed", bookingId, e); }
    await ctx.runMutation(internal.bookings.markLateNotice, { bookingId, sent });
  },
});

/** Collect only after the separate notice window and only with an explicit
 * activation flag. Use an unused active hold first, then a separate saved-card
 * PaymentIntent for any remainder. Both operations have booking-scoped keys. */
export const collectOne = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    if (process.env.LATE_FEE_AUTOCOLLECT_ENABLED !== "true") return;
    if (!(await ctx.runMutation(internal.bookings.claimLateCharge, { bookingId }))) return;
    const b: any = await ctx.runQuery(internal.bookings.lateFeeContext, { bookingId });
    const key = process.env.STRIPE_SECRET_KEY;
    if (!b?.stripePaymentIntentId || !key) {
      await ctx.runMutation(internal.bookings.markLateCharge, {
        bookingId, status: "failed", note: "Saved payment method unavailable", paidFromHold: 0, paidFromCard: 0,
      });
      return;
    }
    const stripe = new Stripe(key);
    let paidFromHold = b.lateFeePaidFromHold ?? 0;
    let paidFromCard = 0;
    let intentId: string | undefined;
    let status = "failed";
    let note: string | undefined;
    if (b.depositKept === 0 && b.stripeDepositIntentId && paidFromHold === 0) {
      try {
        const hold = await stripe.paymentIntents.retrieve(b.stripeDepositIntentId);
        if (hold.status === "succeeded") {
          paidFromHold = Math.min(b.lateFeeAmount, hold.amount_received / 100);
        } else if (hold.status === "requires_capture") {
          paidFromHold = Math.min(b.lateFeeAmount, b.depositHoldAmount);
          await stripe.paymentIntents.capture(hold.id, { amount_to_capture: Math.round(paidFromHold * 100) },
            { idempotencyKey: `dbc-late-hold-capture-${bookingId}` });
          await ctx.runMutation(internal.bookings.setHold, { bookingId, intentId: hold.id, status: "captured" });
        }
      } catch (e: any) {
        // Stripe may have captured successfully while the Convex status update failed.
        // Re-read Stripe before attempting any separate card charge.
        try {
          const observed = await stripe.paymentIntents.retrieve(b.stripeDepositIntentId);
          paidFromHold = observed.status === "succeeded"
            ? Math.min(b.lateFeeAmount, observed.amount_received / 100) : 0;
        } catch {
          await ctx.runMutation(internal.bookings.markLateCharge, {
            bookingId, status: "failed", note: "Could not reconcile existing hold; card charge withheld", paidFromHold: 0, paidFromCard: 0,
          });
          return;
        }
        note = `Existing hold check: ${String(e?.message ?? "capture failed").slice(0, 200)}`;
      }
    }
    const remainder = Math.max(0, b.lateFeeAmount - paidFromHold);
    if (remainder === 0) {
      status = "paid";
    } else {
      try {
        const original = await stripe.paymentIntents.retrieve(b.stripePaymentIntentId);
        const customer = typeof original.customer === "string" ? original.customer : original.customer?.id;
        const method = typeof original.payment_method === "string" ? original.payment_method : original.payment_method?.id;
        if (!customer || !method) throw new Error("Saved card unavailable");
        const intent = await stripe.paymentIntents.create({
          amount: Math.round(remainder * 100), currency: "gbp", customer,
          payment_method: method, payment_method_types: ["card"],
          confirm: true, off_session: true,
          metadata: { bookingId, purpose: "late_rental_time_separate_charge", holdApplied: String(paidFromHold) },
          description: `Late rental time for booking ${bookingId}`,
        }, { idempotencyKey: `dbc-late-rental-${bookingId}` });
        intentId = intent.id;
        paidFromCard = intent.status === "succeeded" ? remainder : 0;
        status = intent.status === "succeeded" ? "paid" : intent.status === "requires_action" ? "requires_action" : "failed";
      } catch (e: any) {
        intentId = e?.raw?.payment_intent?.id ?? e?.payment_intent?.id;
        note = String(e?.message ?? "Issuer declined").slice(0, 300);
        if (intentId) {
          try {
            const observed = await stripe.paymentIntents.retrieve(intentId);
            paidFromCard = observed.status === "succeeded" ? Math.min(remainder, observed.amount_received / 100) : 0;
            status = observed.status === "succeeded" ? "paid"
              : observed.status === "requires_action" ? "requires_action" : "failed";
          } catch {
            status = "reconcile_needed";
            note = "Card result could not be reconciled; do not charge again until reviewed";
          }
        } else status = "failed";
      }
      if (paidFromHold > 0 && status === "failed") status = "partial";
    }
    await ctx.runMutation(internal.bookings.markLateCharge, { bookingId, status, intentId, note, paidFromHold, paidFromCard });
  },
});

export const sendCollectionResult = internalAction({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    if (!(await ctx.runMutation(internal.bookings.claimLateFeeReceiptEmail, { bookingId }))) return;
    const b: any = await ctx.runQuery(internal.bookings.lateFeeContext, { bookingId });
    if (!b?.guestEmail) {
      await ctx.runMutation(internal.bookings.markLateFeeReceiptEmail, { bookingId, sent: false });
      return;
    }
    const rows = b.lateFeeBreakdown.map((line: any) =>
      `<li>${esc(line.title)}: ${line.days} extra day${line.days === 1 ? "" : "s"} × ${gbp(line.dailyRate)} = ${gbp(line.amount)}</li>`,
    ).join("");
    const paidHold = b.lateFeePaidFromHold ?? 0;
    const paidCard = b.lateFeePaidFromCard ?? 0;
    const fullyPaid = b.lateFeeStatus === "paid";
    let sent = false;
    try {
      sent = await sendMail({
        to: b.guestEmail,
        subject: fullyPaid ? "Db Cinema late rental charge receipt" : "Action needed: Db Cinema late rental payment",
        html: `<h2>Separate late rental time ${fullyPaid ? "receipt" : "update"}</h2><p>Itemised amount assessed: <b>${gbp(b.lateFeeAmount)}</b>.</p><ul>${rows}</ul><p>Paid from the unused authorised hold: ${gbp(paidHold)}. Paid by separate saved-card charge: ${gbp(paidCard)}. Remaining unpaid: ${gbp(Math.max(0, b.lateFeeAmount - paidHold - paidCard))}. No amount was collected twice.</p>${fullyPaid ? "<p>Db Cinema Rentals is not VAT registered, so no VAT was charged.</p>" : "<p>Your bank may require a new authentication or card. Reply to this email if the charge is disputed or you need help.</p>"}`,
      });
    } catch (error) { console.error("Late charge result email failed", bookingId, error); }
    await ctx.runMutation(internal.bookings.markLateFeeReceiptEmail, { bookingId, sent });
  },
});

export const processDue = internalAction({
  args: {},
  handler: async (ctx) => {
    const due: any[] = await ctx.runQuery(internal.bookings.dueLateFees, {});
    for (const item of due) {
      if (item.status === "notice_sent" || item.status === "charging") await ctx.runAction(internal.lateFees.collectOne, { bookingId: item.bookingId });
      else await ctx.runAction(internal.lateFees.sendNotice, { bookingId: item.bookingId });
    }
    const receipts: any[] = await ctx.runQuery(internal.bookings.dueLateFeeReceiptEmails, {});
    for (const bookingId of receipts) await ctx.runAction(internal.lateFees.sendCollectionResult, { bookingId });
  },
});
