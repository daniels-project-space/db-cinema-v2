import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { queueOwnerNotification } from "./lib/adminPush";

function disputeStatusRank(status?: string) {
  if (["needs_response", "warning_needs_response"].includes(status ?? "")) return 0;
  if (["under_review", "warning_under_review"].includes(status ?? "")) return 1;
  if (["won", "lost", "charge_refunded", "prevented", "warning_closed"].includes(status ?? "")) return 2;
  return -1;
}

function shouldApplyState(existingAt: number, existingStatus: string | undefined, incomingAt: number, incomingStatus: string | undefined) {
  const existingRank = disputeStatusRank(existingStatus);
  const incomingRank = disputeStatusRank(incomingStatus);
  return incomingRank > existingRank || incomingRank === existingRank && incomingAt > existingAt;
}

export const record = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.union(v.literal("charge.dispute.created"), v.literal("charge.dispute.updated"), v.literal("charge.dispute.closed"),
      v.literal("charge.dispute.funds_withdrawn"), v.literal("charge.dispute.funds_reinstated")),
    paymentIntentId: v.optional(v.string()),
    chargeId: v.optional(v.string()),
    disputeId: v.optional(v.string()),
    status: v.optional(v.string()),
    reason: v.optional(v.string()),
    eventCreatedAt: v.optional(v.number()),
    paymentLookupFailed: v.optional(v.boolean()),
  },
  handler: async (ctx, { eventId, eventType, paymentIntentId, chargeId, disputeId, status, reason, eventCreatedAt, paymentLookupFailed }) => {
    if (!/^evt_[A-Za-z0-9_]+$/.test(eventId) || eventId.length > 200) throw Error("Invalid dispute event.");
    const intent = paymentIntentId && /^pi_[A-Za-z0-9_]+$/.test(paymentIntentId) && paymentIntentId.length <= 200 ? paymentIntentId : undefined;
    const safeChargeId = chargeId && /^ch_[A-Za-z0-9_]+$/.test(chargeId) && chargeId.length <= 200 ? chargeId : undefined;
    const safeDisputeId = disputeId && /^dp_[A-Za-z0-9_]+$/.test(disputeId) && disputeId.length <= 200 ? disputeId : undefined;
    const safeStatus = typeof status === "string" && /^[a-z_]{1,64}$/.test(status) ? status : undefined;
    const safeReason = typeof reason === "string" && /^[a-z_]{1,80}$/.test(reason) ? reason : undefined;
    const eventAt = Number.isSafeInteger(eventCreatedAt) && eventCreatedAt! > 0 ? eventCreatedAt! * 1000 : Date.now();
    const disputeKey = safeDisputeId ?? `unidentified:${eventId}`;
    const existingCase = await ctx.db.query("stripe_dispute_cases").withIndex("by_dispute_id", query => query.eq("disputeId", disputeKey)).first();
    const priorIntentConflict = !!existingCase?.paymentIntentId && !!intent && existingCase.paymentIntentId !== intent;
    const [bookingMatches, chargeMatches] = intent ? await Promise.all([
      ctx.db.query("bookings").withIndex("by_stripePaymentIntentId", query => query.eq("stripePaymentIntentId", intent)).take(2),
      ctx.db.query("rental_security_charges").withIndex("by_intent", query => query.eq("intentId", intent)).take(2),
    ]) : [[], []];
    // Stripe payment intents are unique, but do not guess if our local records are ambiguous
    // or the same provider reference appears in both payment ledgers.
    const ambiguous = bookingMatches.length > 1 || chargeMatches.length > 1 || bookingMatches.length > 0 && chargeMatches.length > 0 || priorIntentConflict;
    const charge = !ambiguous && chargeMatches.length === 1 ? chargeMatches[0] : undefined;
    const booking = !ambiguous
      ? bookingMatches.length === 1 ? bookingMatches[0] : charge ? await ctx.db.get(charge.bookingId) : undefined
      : undefined;
    if (!ambiguous && charge) {
      const existingAt = charge.stripeDisputeUpdatedAt ?? 0;
      if (shouldApplyState(existingAt, charge.stripeDisputeStatus, eventAt, safeStatus)) {
        await ctx.db.patch(charge._id, {
          ...(safeDisputeId ? { stripeDisputeId: safeDisputeId } : {}),
          ...(safeStatus ? { stripeDisputeStatus: safeStatus } : {}),
          ...(safeReason ? { stripeDisputeReason: safeReason } : {}),
          stripeDisputeEventId: eventId,
          stripeDisputeUpdatedAt: Math.max(existingAt, eventAt),
          disputedAt: charge.disputedAt ?? eventAt,
          updatedAt: Math.max(charge.updatedAt ?? 0, eventAt),
        });
      }
    }
    if (!ambiguous && booking) {
      const existingAt = booking.stripeDisputeUpdatedAt ?? 0;
      if (shouldApplyState(existingAt, booking.stripeDisputeStatus, eventAt, safeStatus)) {
        await ctx.db.patch(booking._id, {
          stripeDisputedAt: booking.stripeDisputedAt ?? eventAt,
          ...(safeDisputeId ? { stripeDisputeId: safeDisputeId } : {}),
          ...(safeStatus ? { stripeDisputeStatus: safeStatus } : {}),
          ...(safeReason ? { stripeDisputeReason: safeReason } : {}),
          stripeDisputeEventId: eventId,
          stripeDisputeUpdatedAt: Math.max(existingAt, eventAt),
        });
      }
    }
    const linked = !ambiguous && (!!booking || !!charge);
    const caseAt = existingCase?.eventCreatedAt ?? 0;
    const caseStatus = existingCase?.status;
    const applyCaseState = !existingCase || shouldApplyState(caseAt, caseStatus, eventAt, safeStatus);
    const casePatch = {
      eventId: applyCaseState ? eventId : existingCase?.eventId ?? eventId,
      eventType: applyCaseState ? eventType : existingCase?.eventType ?? eventType,
      ...(priorIntentConflict && existingCase?.paymentIntentId ? { paymentIntentId: existingCase.paymentIntentId } : intent ? { paymentIntentId: intent } : existingCase?.paymentIntentId ? { paymentIntentId: existingCase.paymentIntentId } : {}),
      ...(safeChargeId ? { chargeId: safeChargeId } : existingCase?.chargeId ? { chargeId: existingCase.chargeId } : {}),
      bookingId: ambiguous ? undefined : booking?._id ?? existingCase?.bookingId,
      securityChargeId: ambiguous ? undefined : charge?._id ?? existingCase?.securityChargeId,
      linkStatus: !ambiguous && (linked || existingCase?.linkStatus === "linked") ? "linked" as const : "unresolved" as const,
      ...(applyCaseState && safeStatus ? { status: safeStatus } : existingCase?.status ? { status: existingCase.status } : {}),
      ...(applyCaseState && safeReason ? { reason: safeReason } : existingCase?.reason ? { reason: existingCase.reason } : {}),
      eventCreatedAt: applyCaseState ? Math.max(caseAt, eventAt) : caseAt,
      statusRank: applyCaseState && safeStatus ? disputeStatusRank(safeStatus) : existingCase?.statusRank ?? disputeStatusRank(caseStatus),
      paymentLookupFailed: !!paymentLookupFailed || (!!existingCase?.paymentLookupFailed && !intent),
      updatedAt: Date.now(),
    };
    if (existingCase) await ctx.db.patch(existingCase._id, casePatch);
    else await ctx.db.insert("stripe_dispute_cases", { disputeId: disputeKey, ...casePatch, createdAt: Date.now() });

    const caseIsLinked = !ambiguous && (linked || existingCase?.linkStatus === "linked");
    const title = !caseIsLinked ? "Stripe dispute needs a payment match" : eventType === "charge.dispute.created" ? "Stripe dispute opened" :
      eventType === "charge.dispute.closed" ? "Stripe dispute closed" :
      eventType === "charge.dispute.funds_withdrawn" ? "Dispute funds withdrawn" :
      eventType === "charge.dispute.funds_reinstated" ? "Dispute funds reinstated" : "Stripe dispute updated";
    const detail = [safeStatus && `Status: ${safeStatus.replaceAll("_", " ")}`, safeReason && `Reason: ${safeReason.replaceAll("_", " ")}`].filter(Boolean).join(" · ");
    const unresolvedDetail = !caseIsLinked
      ? `Dispute ${safeDisputeId ?? "unknown"}${safeChargeId ? ` · charge ${safeChargeId}` : ""} could not be matched to a rental payment${paymentLookupFailed ? " (payment lookup failed)" : ""}. Reconcile it in Stripe before taking action.`
      : booking ? "Check Stripe for the dispute details and any deadline." : "Check Stripe for the dispute details and affected payment.";
    const body = `${detail ? `${detail}. ` : ""}${unresolvedDetail} The website made no charge or refund.`;
    await queueOwnerNotification(ctx, { eventKey: `stripe-dispute:${eventId}`, kind: "stripe_dispute", ...(booking ? { bookingId: booking._id, ...(booking.accountId ? { accountId: booking.accountId } : {}) } : {}), title, body });
  },
});
