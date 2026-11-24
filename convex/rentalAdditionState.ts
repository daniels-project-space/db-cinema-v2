import { hasCashDepositPolicy, ASSESSMENT_SECURITY_POLICY_VERSION, isSetupIntentSecurityPolicy, cardLimitForPolicy, depositForBookingPolicy } from "../shared/rentalSecurity";
import { assertSwapStockReconciled } from "./lib/swapStockFence";
import {canDeferAdditionSecurity} from "../shared/pickupSecurity";
import {schedulePickupHold} from "./pickupSecurity";
import { allocateSaving, tierByKey, weekendDays } from "../shared/membership";
import { bestBenefit, memberRentalBenefitCandidates } from "../shared/rentalBenefits";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import type { Id } from "./_generated/dataModel";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { assertRenterExposure, replacementValues } from "./lib/rentalExposure";
import { assertRentalInventory } from "./lib/rentalInventory";
import {
  accountForToken,
  ownedBooking,
  postRentalMessage,
} from "./lib/rentalChat";
import { quote } from "./lib/pricing";
import {isSavedCardRental,savedCardConsentText,securityAmendmentConsentText} from "../shared/savedCardSecurity";
import { securityForPolicy,REFUNDABLE_DEPOSIT_POLICY_VERSION,savedCardChargeLimit } from "../shared/rentalSecurity";
import { rentalControlsSnapshot } from "./lib/rentalControlsSnapshot";
import { listingRentalImages } from "./lib/catalogImages";
import { rentalBenefitAccount } from "./lib/rentalBenefitAccount";
import { availableRentalCreditPence,reserveRentalCredit,consumeRentalCredit,releaseRentalCredit,reservationForOperation } from "./lib/rentalCreditFunding";

async function note(ctx: any, b: any, text: string, meta?: any) {
  const a = await ctx.db
    .query("accounts")
    .withIndex("by_email", (q: any) =>
      q.eq("email", (b.guestEmail ?? "").trim().toLowerCase()),
    )
    .first();
  if (a)
    await postRentalMessage(ctx, {
      accountId: a._id,
      bookingId: b._id,
      sender: "system",
      text,
      meta,
    });
}
export const context = internalQuery({
  args: { id: v.id("rental_additions") },
  handler: async (ctx, { id }) => {
    const addition = await ctx.db.get(id);
    if (!addition) return null;
    const membershipCheckout = addition.membershipCheckoutId ? await ctx.db.get(addition.membershipCheckoutId) : null;
    return { addition, booking: await ctx.db.get(addition.bookingId), membershipCheckout,
      membershipAccount: membershipCheckout ? await ctx.db.get(membershipCheckout.accountId) : null };
  },
});
export const existing = internalQuery({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) =>
    ctx.db
      .query("rental_additions")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .first(),
});
export const list = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    if (!checkAdminToken(token)) return [];
    const rows = await ctx.db.query("rental_additions").withIndex("by_booking", q => q.eq("bookingId", bookingId)).collect();
    return rows.map(({ securityCreationParams: _privateParams, ...row }) => row);
  },
});
type AdditionSelection = {
  bookingId: Id<"bookings">; listingId: Id<"listings">; qty: number; reason: string;
  start?: number; end?: number; complimentary?: boolean; expectedSnapshot?: string;
};
/** Shared read-only qualification. Confirm rechecks the same stock and money rules. */
async function qualifyAddition(ctx: QueryCtx, a: AdditionSelection) {
    const b = await ctx.db.get(a.bookingId);
    if (
      !b ||
      !["pending_payment", "confirmed", "active"].includes(b.status) ||
      b.cancellationDecision ||
      b.returnDecision
    )
      throw Error("This rental cannot accept items");
    if (b.activeAdditionId || b.activeDeliveryQuoteId || b.activeExtensionId || b.activePriceAdjustmentId || b.activeItemSwapId)
      throw Error("Finish or withdraw the current item addition or approved extension first");
    await assertSwapStockReconciled(ctx, b._id);
    if (
      ["starting", "requires_action", "failed"].includes(
        b.depositHoldRenewalStatus ?? "",
      )
    )
      throw Error("Resolve the existing card hold renewal before adding items");
    if (
      b.status !== "pending_payment" &&
      !isSavedCardRental(b) && !canDeferAdditionSecurity(b) &&
      (b.depositHoldExpiresAt ?? 0) <= Date.now() + 36 * 3600000
    )
      throw Error(
        "Renew the current security hold before adding items; the proposal must not interrupt rental coverage",
      );
    const jobs = await ctx.db
      .query("rental_refunds")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    if (jobs.some((r) => r.status === "prepared" || r.status === "pending"))
      throw Error("Wait for the refund to settle before adding items");
    if (a.expectedSnapshot && a.expectedSnapshot !== rentalControlsSnapshot(b, jobs))
      throw new ConvexError({code:"EQUIPMENT_REVIEW_STALE",message:"The rental changed. Review the equipment addition again."});
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    if (reservations.some((r) => r.source !== "site"))
      throw Error("Use the original booking platform for this rental");
    if (
      a.reason.trim().length < 5 ||
      !Number.isSafeInteger(a.qty) ||
      a.qty < 1 ||
      a.qty > 20
    )
      throw Error("Choose a quantity from 1–20 and record the reason");
    const l = await ctx.db.get(a.listingId);
    if (!l?.active || l.suppressed) throw Error("Item is unavailable");
    const start =
      a.start ??
      Math.max(
        Math.min(...b.lineItems.map((li) => li.start)),
        new Date().setUTCHours(0, 0, 0, 0),
      );
    const end = a.end ?? Math.max(...b.lineItems.map((li) => li.end));
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start % 86400000 !== 0 ||
      end % 86400000 !== 0 ||
      end < start ||
      end < new Date().setUTCHours(0, 0, 0, 0)
    )
      throw Error("Choose valid current or future rental dates");
    const days = Math.round((end - start) / 86400000) + 1;
    const account = b.accountId ? await ctx.db.get(b.accountId) : null;
    const benefitAccount = await rentalBenefitAccount(ctx, account);
    const grossLineTotal = a.complimentary ? 0 : quote(l.pricing, days).total * a.qty;
    const weekendSavingPence = !a.complimentary && weekendDays(start, end)
      ? Math.round(Math.max(0, quote(l.pricing, days).total - quote(l.pricing, days - 1).total) * a.qty * 100)
      : 0;
    const benefit = bestBenefit(memberRentalBenefitCandidates({
      account: benefitAccount,
      subtotalPence: Math.round(grossLineTotal * 100),
      weekendSavingPence,
    }));
    const benefitSaving = benefit.savingPence / 100;
    const lineTotal = allocateSaving([grossLineTotal], benefitSaving)[0];
    const line = {
      listingId: l._id,
      title: l.title,
      start,
      end,
      qty: a.qty,
      lineTotal,
      undiscountedLineTotal: grossLineTotal,
      benefitKind: benefitSaving > 0 ? benefit.kind : "none",
      benefitLabel: benefitSaving > 0 ? benefit.label : undefined,
      benefitSaving,
    };
    await assertRenterExposure(ctx, b, [...b.lineItems, line]);
    await assertRentalInventory(ctx, [...b.lineItems, line], b._id);
    const values=await replacementValues(ctx,b,[...b.lineItems,line]);
    const value=[...b.lineItems,line].reduce((sum,li)=>sum+values.find(v=>v.listingId===li.listingId)!.unitPence*li.qty/100,0);
    const security = securityForPolicy(b.securityPolicyVersion, b.protection === "deposit" ? "deposit" : "verify", value);
    const holdTotal = Math.max(
      b.depositHoldAmount ?? 0,
      security.hold,
    );
    const securityCharge = Math.max(
      0,
      (b.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION ? depositForBookingPolicy(b,value) : security.deposit) - b.depositAmount,
    );
    const membership=b.status==="pending_payment"&&b.membershipCheckoutId?await ctx.db.get(b.membershipCheckoutId):null;
    if(membership&&(!membership.sessionParams||!["creating","open"].includes(membership.state)||membership.bookingId!==b._id))throw Error("Refresh the initial membership checkout before changing its order.");
    const membershipParams=membership?.sessionParams?JSON.parse(membership.sessionParams):null;
    const membershipFee=membership?membershipParams?.metadata?.membershipFeePence?Number(membershipParams.metadata.membershipFeePence)/100:membership.intro==="trial"?0:tierByKey(membership.tier)?.monthlyGbp:undefined;
    if(membership&&membershipFee===undefined)throw Error("Membership price snapshot is unavailable.");
    return {b,l,line,start,end,holdTotal,securityCharge,membership,membershipFee,value,
      snapshot:rentalControlsSnapshot(b,jobs), imageSources:listingRentalImages(l)};
}
export const preview = query({
  args: {token:v.string(),bookingId:v.id("bookings"),listingId:v.id("listings"),qty:v.number(),
    reason:v.string(),start:v.optional(v.number()),end:v.optional(v.number()),complimentary:v.optional(v.boolean())},
  handler:async(ctx,a)=>{
    if(!checkAdminToken(a.token)) throw Error("unauthorized");
    try {
    const p=await qualifyAddition(ctx,a);
    return {ok:true,snapshot:p.snapshot,listingId:p.l._id,title:p.l.title,qty:p.line.qty,start:p.start,end:p.end,
      lineTotal:p.line.lineTotal,undiscountedLineTotal:p.line.undiscountedLineTotal,benefitKind:p.line.benefitKind,
      benefitLabel:p.line.benefitLabel,benefitSaving:p.line.benefitSaving,securityCharge:p.securityCharge,holdTotal:p.holdTotal,
      imageSources:p.imageSources,complimentary:!!a.complimentary,
      quoteSnapshot:JSON.stringify([p.snapshot,p.l.pricing,p.l.depositAmount,p.l.components,p.line,p.holdTotal,p.securityCharge])};
    }catch(e){return {ok:false,reason:e instanceof Error?e.message:"Equipment review failed."};}
  },
});
export const prepare = internalMutation({
  args: {
    expectedSnapshot:v.optional(v.string()),
    expectedQuote:v.optional(v.string()),
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
  handler: async (ctx, a) => {
    await assertAdmin(ctx, a.token, "rentalAdditions.prepare");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(a.requestId))
      throw Error("Invalid addition request");
    const prior = await ctx.db
      .query("rental_additions")
      .withIndex("by_request", (q) => q.eq("requestId", a.requestId))
      .first();
    if (prior) {
      if (prior.bookingId !== a.bookingId)
        throw Error("Request belongs to another rental");
      if(a.expectedQuote && prior.reviewQuote!==a.expectedQuote) throw Error("Addition request has changed.");
      return prior;
    }
    const {b,l,line,start,end,holdTotal,securityCharge,membership,membershipFee,snapshot,value}=await qualifyAddition(ctx,a);
    const quoteSnapshot=JSON.stringify([snapshot,l.pricing,l.depositAmount,l.components,line,holdTotal,securityCharge]);
    if(a.expectedQuote && a.expectedQuote!==quoteSnapshot)
      throw new ConvexError({code:"EQUIPMENT_REVIEW_STALE",message:"The equipment quote changed. Review the addition again."});
    const id = await ctx.db.insert("rental_additions", {
      ...line,
      reviewQuote:a.expectedQuote,
      bookingId: b._id,
      requestId: a.requestId,
      dailyRate: a.complimentary ? 0 : l.pricing.daily * a.qty,
      complimentary: !!a.complimentary || line.lineTotal === 0,
      securityCharge,
      ...(hasCashDepositPolicy(b.securityPolicyVersion)?{securityPolicyVersion:b.securityPolicyVersion,proposedSavedCardLimit:Math.max(b.savedCardLimit??0,cardLimitForPolicy(b.securityPolicyVersion,value)),replacementValuePence:Math.round(value*100),priorSavedCardLimit:b.savedCardLimit}:{}),
      holdTotal,
      oldHoldId: b.stripeDepositIntentId,
      draftReplacement: b.status === "pending_payment",
      baseTotal: b.total,
      baseSecurity: b.depositAmount,
      baseSessionId: b.stripeCheckoutSessionId,
      ...(membership?{membershipCheckoutId:membership._id,membershipFee,membershipSessionParams:membership.sessionParams}:{}),
      status: hasCashDepositPolicy(b.securityPolicyVersion)?"awaiting_acceptance":"prepared",
      checkoutProtocolVersion:2,
      reason: a.reason.trim().slice(0, 400),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(b._id, { activeAdditionId: id });
    for (const comp of l.components)
      await ctx.db.insert("reservations", {
        inventoryUnitId: comp.inventoryUnitId,
        listingId: l._id,
        bookingId: b._id,
        start,
        end,
        qty: comp.qty * a.qty,
        source: "site",
        status: "hold",
        externalRef: `addition:${id}`,
        holdExpiresAt: Date.now() + 35 * 60000,
      });
    if(hasCashDepositPolicy(b.securityPolicyVersion)){await note(ctx,b,`Proposed equipment addition: ${line.qty}× ${line.title}. Review and accept the revised deposit and future card-payment permission in your rental conversation before payment.`);await queueRmv2Sync(ctx,b._id);}
    return (await ctx.db.get(id))!;
  },
});
export const markSessionCreation = internalMutation({
  args: { id: v.id("rental_additions"), creditOptIn: v.boolean(), creditAppliedPence: v.number() },
  handler: async (ctx, { id, creditOptIn, creditAppliedPence }) => {
    const addition = await ctx.db.get(id);
    if (!addition || !!addition.creditOptIn !== creditOptIn || (addition.creditAppliedPence ?? 0) !== creditAppliedPence || addition.sessionId || ["applied", "applied_draft", "refunded", "expired"].includes(addition.status)) throw Error("The addition payment changed. Refresh it before continuing.");
    const booking = await ctx.db.get(addition.bookingId);
    if (!booking || booking.activeAdditionId !== id) throw Error("The item addition is no longer open.");
    if (!addition.sessionCreationPending) await ctx.db.patch(id, { sessionCreationPending: true, updatedAt: Date.now() });
  },
});
export const bindSession = internalMutation({
  args: {
    id: v.id("rental_additions"),
    sessionId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, { id, sessionId, url }) => {
    const r = await ctx.db.get(id);
    if (!r) return;
    if (r.sessionId && r.sessionId !== sessionId)
      throw Error("Addition already has a checkout session");
    const b = await ctx.db.get(r.bookingId);
    if (!b || b.activeAdditionId !== id)
      throw Error("Item addition is no longer open");
    if (r.sessionId === sessionId) return;
    await ctx.db.patch(id, {
      sessionId,
      paymentUrl: url,
      sessionCreationPending: false,
      recoveryNeedsReview: undefined,
      status: r.withdrawalRequestedAt ? r.status : "awaiting_payment",
      updatedAt: Date.now(),
    });
    if (r.draftReplacement){
      await assertRentalInventory(ctx,[...b.lineItems,{listingId:r.listingId,qty:r.qty,start:r.start,end:r.end}],b._id);
      const deadline=r.createdAt+24*3600000;
      await ctx.db.patch(b._id, { stripeCheckoutSessionId: sessionId });
      const held=await ctx.db.query("reservations").withIndex("by_booking",q=>q.eq("bookingId",b._id)).collect();
      for(const row of held)if(row.status==="hold")await ctx.db.patch(row._id,{holdExpiresAt:deadline});
    }
    if(r.membershipCheckoutId){
      const member=await ctx.db.get(r.membershipCheckoutId);if(!member||member.state==="complete"||member.bookingId!==b._id||member.sessionId!==r.baseSessionId)throw Error("The membership checkout changed before this edit was bound.");
      await ctx.db.patch(member._id,{sessionId,state:"open",expiresAt:r.createdAt+24*3600000});
    }
    if (r.withdrawalRequestedAt) return;
    const benefitSaving = r.benefitSaving ?? 0;
    const benefitCopy = benefitSaving > 0
      ? ` ${r.benefitLabel ?? "Rental discount"} saved £${benefitSaving.toFixed(2)} (was £${(r.undiscountedLineTotal ?? r.lineTotal + benefitSaving).toFixed(2)}).`
      : "";
    await note(
      ctx,
      b,
      r.creditOptIn && !r.draftReplacement
        ? `The team proposed adding ${r.qty}× ${r.title}: £${r.lineTotal.toFixed(2)} rental.${benefitCopy}${r.securityCharge ? ` + £${r.securityCharge.toFixed(2)} refundable security` : ""}. £${((r.creditAppliedPence ?? 0) / 100).toFixed(2)} account credit applied; £${((r.cardDuePence ?? 0) / 100).toFixed(2)} remains to pay. Your updated card hold is £${r.holdTotal.toFixed(2)}.`
        : r.draftReplacement
        ? `The team proposed adding ${r.qty}× ${r.title}. Review the updated rental and complete its checkout.${r.membershipCheckoutId ? ` Your membership is preserved: £${(r.membershipFee??0).toFixed(2)} membership fee in this checkout${r.membershipFee===0?" (free-week trial)":""}; renewal remains as agreed.`:""}`
        : isSetupIntentSecurityPolicy(r.securityPolicyVersion)
          ? `The team proposed adding ${r.qty}× ${r.title}: £${r.lineTotal.toFixed(2)} rental.${benefitCopy} No deposit or card hold is added; any future security claim remains governed by your accepted saved-card agreement. Items are confirmed after payment.`
          : `The team proposed adding ${r.qty}× ${r.title}: £${r.lineTotal.toFixed(2)} rental.${benefitCopy}${r.securityCharge ? ` + £${r.securityCharge.toFixed(2)} refundable security` : ""}. The updated card hold is £${r.holdTotal.toFixed(2)}. Items are confirmed after payment and any bank approval.`,
      {
        kind: "paylink",
        url,
        amount: (r.cardDuePence ?? Math.round(((r.draftReplacement ? r.baseTotal ?? 0 : 0) + r.lineTotal + r.securityCharge + (r.membershipFee ?? 0)) * 100)) / 100,
        grossAmount: (r.draftReplacement ? r.baseTotal ?? 0 : 0) + r.lineTotal + r.securityCharge + (r.membershipFee ?? 0),
        creditAppliedPence: r.creditAppliedPence ?? 0,
        benefitKind: r.benefitKind ?? "none",
        benefitLabel: r.benefitLabel,
        benefitSaving: r.benefitSaving ?? 0,
        undiscountedLineTotal: r.undiscountedLineTotal ?? r.lineTotal,
      },
    );
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId: b._id,
      kind: "item addition proposed",
      detail: `${r.qty}× ${r.title}. Review the secure payment link in your rental conversation.`,
    });
  },
});
export const markSessionRecoveryReview = internalMutation({
  args: { id: v.id("rental_additions") },
  handler: async (ctx, { id }) => {
    const addition = await ctx.db.get(id);
    if (!addition || addition.sessionId || ["applied", "applied_draft", "refunded", "expired"].includes(addition.status)) return;
    await ctx.db.patch(id, { recoveryNeedsReview: true, updatedAt: Date.now() });
  },
});
export const bindRecoveredSession = internalMutation({
  args: { id: v.id("rental_additions"), sessionId: v.string() },
  handler: async (ctx, { id, sessionId }) => {
    const addition = await ctx.db.get(id);
    if (!addition || !sessionId.startsWith("cs_")) throw Error("Addition recovery is unavailable.");
    if (addition.sessionId) { if (addition.sessionId !== sessionId) throw Error("A different addition payment is already attached."); return; }
    const booking = await ctx.db.get(addition.bookingId);
    if (!booking || booking.activeAdditionId !== id || addition.withdrawalRequestedAt || ["applied", "applied_draft", "refunded", "expired"].includes(addition.status)) throw Error("The item addition is no longer open.");
    await ctx.db.patch(id, { sessionId, status: "awaiting_payment", sessionCreationPending: false, recoveryNeedsReview: true, updatedAt: Date.now() });
  },
});
export const markPaid = internalMutation({
  args: { id: v.id("rental_additions"), paymentIntentId: v.string(),amountPence:v.number() },
  handler: async (ctx, { id, paymentIntentId,amountPence }) => {
    const r = await ctx.db.get(id);
    if (!r) throw Error("Addition missing");
    if(!Number.isSafeInteger(amountPence)||amountPence<0)throw Error("Addition payment amount is invalid.");
    const expectedPence=r.cardDuePence??Math.round(((r.draftReplacement?r.baseTotal??0:0)+r.lineTotal+r.securityCharge+(r.membershipFee??0))*100);
    if(amountPence!==expectedPence)throw Error("Addition payment amount does not match the approved account-credit balance.");
    if (r.paymentIntentId && r.paymentIntentId !== paymentIntentId)
      throw Error("Addition payment mismatch");
    if(r.cardPaidPence!=null&&r.cardPaidPence!==amountPence)throw Error("Addition payment amount mismatch.");
    if (["applied", "applied_draft", "refunded"].includes(r.status)) return;
      await ctx.db.patch(id, {
      paymentIntentId,
      cardPaidPence:amountPence,
      status: r.withdrawalRequestedAt ? r.status : "paid",
      updatedAt: Date.now(),
    });
  },
});
export const bindHold = internalMutation({
  args: {
    id: v.id("rental_additions"),
    intentId: v.string(),
    status: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { id, intentId, status, expiresAt }) => {
    const r = await ctx.db.get(id);
    if (!r) return;
    if (r.holdIntentId && r.holdIntentId !== intentId)
      throw Error("Addition hold mismatch");
    await ctx.db.patch(id, {
      holdIntentId: intentId,
      securityCreationPending: false,
      holdExpiresAt: expiresAt,
      status: r.withdrawalRequestedAt ? r.status : status,
      updatedAt: Date.now(),
    });
  },
});
export const apply = internalMutation({
  args: { id: v.id("rental_additions") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (!r) return { closed: true };
    if (r.status === "applied" || r.status === "applied_draft")
      return { applied: true, already: true };
    if (r.withdrawalRequestedAt) return { closed: true };
    if (r.securityCreationPending) throw Error("Wait for the pending security authorisation");
    const b = await ctx.db.get(r.bookingId);
    if (b) await assertSwapStockReconciled(ctx, b._id);
    if (
      !b ||
      b.cancellationDecision ||
      b.returnDecision ||
      b.activeAdditionId !== id ||
      !["pending_payment", "confirmed", "active"].includes(b.status) ||
      (r.draftReplacement && b.status !== "pending_payment")
    )
      return { closed: true };
    const creditReservation=r.creditOptIn?await reservationForOperation(ctx,"addition",String(r._id)):null;
    const grossPence=Math.round(((r.draftReplacement?r.baseTotal??0:0)+r.lineTotal+r.securityCharge+(r.membershipFee??0))*100);
    if(r.creditOptIn&&(!creditReservation||creditReservation.state!=="reserved"&&creditReservation.state!=="consumed"||creditReservation.accountId!==r.customerAccountId||creditReservation.amountPence!==r.creditAppliedPence||r.cardDuePence!==Math.max(0,grossPence-creditReservation.amountPence)))throw Error("The saved account-credit allocation no longer matches this addition.");
    if(!r.creditOptIn&&(r.creditAppliedPence??0)!==0)throw Error("The addition has an unselected account-credit allocation.");
    const creditOnly=!r.paymentIntentId&&r.creditOptIn&&(r.cardDuePence??1)===0&&creditReservation?.state==="reserved";
    if (
      (!r.paymentIntentId && (!r.complimentary || r.securityCharge>0) && !creditOnly) ||
      (!r.draftReplacement && r.holdTotal > 0 && r.status !== "held" && !canDeferAdditionSecurity(b))
    )
      throw Error(
        "Payment and replacement card hold must be ready before items are attached",
      );
    const line = {
      listingId: r.listingId,
      title: r.title,
      start: r.start,
      end: r.end,
      qty: r.qty,
      lineTotal: r.lineTotal,
      dailyRate: r.dailyRate,
    };
    try {
      await assertRenterExposure(ctx, b, [...b.lineItems, line]);
      await assertRentalInventory(ctx, [...b.lineItems, line], b._id);
    } catch (e) {
      if (/unavailable|already reserved|Inventory capacity|£12,000|£15,000|replacement value|overlapping rentals/.test(String(e)))
        return { closed: true };
      throw e;
    }
    const updatedValues=await replacementValues(ctx,b,[...b.lineItems,line]);
    const updatedValue=[...b.lineItems,line].reduce((sum,li)=>sum+updatedValues.find(v=>v.listingId===li.listingId)!.unitPence*li.qty,0);
    if(hasCashDepositPolicy(b.securityPolicyVersion)&&r.replacementValuePence!==updatedValue)return {closed:true};
    if(r.creditOptIn)await consumeRentalCredit(ctx,"addition",String(r._id));
    let amendment:any;
    if(hasCashDepositPolicy(b.securityPolicyVersion)){
      if(!r.customerAcceptedAt||!r.customerAccountId||r.priorSavedCardLimit!==b.savedCardLimit||r.baseSecurity!==b.depositAmount||r.customerConsentText!==securityAmendmentConsentText(r.proposedSavedCardLimit!,b.depositAmount+r.securityCharge,b.savedCardLimit!,b.depositAmount,b.securityPolicyVersion))throw Error("The renter must accept this equipment security update first.");
      amendment={additionId:r._id,accountId:r.customerAccountId,acceptedAt:r.customerAcceptedAt,priorDeposit:b.depositAmount,depositAmount:b.depositAmount+r.securityCharge,priorLimit:b.savedCardLimit,savedCardLimit:r.proposedSavedCardLimit,consentText:r.customerConsentText,replacementValuePence:r.replacementValuePence,sessionId:r.sessionId,paymentIntentId:r.paymentIntentId,draftReplacement:!!r.draftReplacement};
    }
    const nextPaymentLedger = !r.draftReplacement && b.itemPaymentLedger?.length === b.lineItems.length && (r.securityCharge ?? 0) === 0 && (r.membershipFee ?? 0) === 0 && (r.creditAppliedPence ?? 0) === 0 && ((r.complimentary && r.lineTotal === 0 && !r.paymentIntentId) || (!!r.paymentIntentId && r.cardPaidPence === Math.round(r.lineTotal * 100))) ? [...b.itemPaymentLedger,{listingId:line.listingId,qty:line.qty,sources:r.paymentIntentId?[{paymentIntentId:r.paymentIntentId,amountPence:r.cardPaidPence!}]:[]}] : undefined;
    const patch: any = {
      ...(amendment?{securityAmendments:[...(b.securityAmendments??[]),amendment],savedCardLimit:amendment.savedCardLimit,savedCardConsentText:amendment.consentText,laterChargeConsentAt:amendment.acceptedAt}:{}),
      replacementValues: await replacementValues(ctx, b, [...b.lineItems, line]),
      lineItems: [...b.lineItems, line],
      ...(b.itemPaymentLedgerVersion === 1 ? {itemPaymentLedger:nextPaymentLedger,...(!nextPaymentLedger?{itemPaymentLedgerRefundIds:undefined}:{})} : {}),
      ...(r.draftReplacement && b.checkoutLineFunding ? {checkoutLineFunding:[...b.checkoutLineFunding,{listingId:line.listingId,start:line.start,end:line.end,qty:line.qty,gross:line.lineTotal,discount:0,membershipCredit:0,accountCredit:0,card:line.lineTotal}]} : {}),
      subtotal: b.subtotal + r.lineTotal,
      total: b.total + r.lineTotal + r.securityCharge,
      depositAmount: b.depositAmount + r.securityCharge,
      depositHoldAmount: r.holdTotal,
      activeAdditionId: undefined,
    };
    if (
      !r.draftReplacement &&
      r.holdIntentId &&
      r.holdIntentId !== b.stripeDepositIntentId
    ) {
      patch.stripeDepositIntentId = r.holdIntentId;
      patch.depositHoldStatus = "held";
      patch.depositHoldExpiresAt = r.holdExpiresAt;
      patch.depositHoldPreviousIntentIds = [
        ...(b.depositHoldPreviousIntentIds ?? []),
        ...(b.stripeDepositIntentId ? [b.stripeDepositIntentId] : []),
      ];
    }
    if (r.draftReplacement) patch.stripeCheckoutSessionId = r.sessionId;
    if(b.securityWaiverReason==="safe_repeat_kit"&&r.securityCharge>0)patch.securityWaiverReason=undefined;
    if(r.membershipCheckoutId)patch.rentalPaidPence=Math.round((b.total+r.lineTotal+r.securityCharge)*100);
    const deferred=!r.draftReplacement&&canDeferAdditionSecurity(b);
    if(deferred&&(r.holdIntentId||r.securityCreationParams))throw Error("Reconcile the existing addition authorisation before changing the pickup schedule");
    await ctx.db.patch(b._id, patch);
    if(deferred)await schedulePickupHold(ctx,{...b,...patch},true);
    await ctx.db.patch(id, {
      status: r.draftReplacement ? "applied_draft" : "applied",
      updatedAt: Date.now(),
    });
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    for (const reservation of reservations)
      if (!r.draftReplacement && reservation.externalRef === `addition:${id}`)
        await ctx.db.patch(reservation._id, {
          status: b.status === "active" ? "active" : "confirmed",
          holdExpiresAt: undefined,
        });
    await note(
      ctx,
      b,
      `Added to your rental: ${r.qty}× ${r.title}. Rental charge £${r.lineTotal.toFixed(2)}${r.securityCharge ? `; refundable security £${r.securityCharge.toFixed(2)}` : ""}.`,
    );
    await queueRmv2Sync(ctx, b._id);
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId: b._id,
      kind: "item added",
      detail: `${r.qty}× ${r.title}. £${r.lineTotal.toFixed(2)} rental charge${r.securityCharge ? ` and £${r.securityCharge.toFixed(2)} refundable security` : ""}.`,
    });
    return { applied: true };
  },
});
/** Persist the exact approved attempt before sending any new card hold. */
export const beginSecurityAuthorization = internalMutation({
  args: { id: v.id("rental_additions"), params: v.string() },
  handler: async (ctx, { id, params }) => {
    const r = await ctx.db.get(id);
    if (!r || r.withdrawalRequestedAt || ["applied", "applied_draft", "refunded", "expired"].includes(r.status)) return { closed: true as const };
    const b = await ctx.db.get(r.bookingId);
    if (!b || b.activeAdditionId !== id || !r.paymentIntentId || b.cancellationDecision || b.returnDecision) return { closed: true as const };
    const p = JSON.parse(params);
    if (p.amount !== Math.round(r.holdTotal * 100) || p.amount <= 0 || p.currency !== "gbp" || p.capture_method !== "manual" || p.confirm !== true || p.off_session !== true || typeof p.customer !== "string" || !p.customer || typeof p.payment_method !== "string" || !p.payment_method || p.metadata?.rentalAdditionId !== id || p.metadata?.bookingId !== r.bookingId || p.metadata?.purpose !== "replacement_rental_security_hold") throw Error("Security authorisation does not match the saved proposal");
    if (r.securityCreationParams && r.securityCreationParams !== params) throw Error("The prepared security authorisation changed");
    if (!r.securityCreationPending) await ctx.db.patch(id, { securityCreationPending: true, securityCreationPreparedAt: Date.now(), securityCreationParams: params });
    return { closed: false as const, params: r.securityCreationParams ?? params };
  },
});

/** Serialize the withdrawal decision against attachment before provider effects. */
export const beginWithdrawal = internalMutation({
  args: { id: v.id("rental_additions") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (!r) throw Error("Addition missing");
    if (["applied", "applied_draft"].includes(r.status)) throw Error("Applied items are settled through the rental");
    if (["refunded", "expired"].includes(r.status) || r.withdrawalRequestedAt) return r;
    const patch = { withdrawalRequestedAt: Date.now(), status: "withdrawing", updatedAt: Date.now() };
    await ctx.db.patch(id, patch);
    return { ...r, ...patch };
  },
});

export const recordWithdrawalRefund = internalMutation({
  args: { id: v.id("rental_additions"), paymentIntentId: v.string(), refundId: v.string(), status: v.string(), amountPence: v.number() },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.id);
    if (!r?.withdrawalRequestedAt || r.paymentIntentId !== args.paymentIntentId) throw Error("Withdrawal payment mismatch");
    if (r.withdrawalRefundId && r.withdrawalRefundId !== args.refundId) throw Error("Withdrawal refund mismatch");
    const expected = r.cardDuePence ?? Math.round(((r.draftReplacement ? r.baseTotal ?? 0 : 0) + r.lineTotal + r.securityCharge + (r.membershipFee ?? 0)) * 100);
    if (args.amountPence !== expected || !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(args.status)) throw Error("Withdrawal refund result mismatch");
    if (r.withdrawalRefundStatus === "succeeded") return;
    await ctx.db.patch(args.id, { withdrawalRefundId: args.refundId, withdrawalRefundStatus: args.status,
      status: ["failed", "canceled"].includes(args.status) ? "refund_failed" : "refund_pending", updatedAt: Date.now() });
  },
});

/** Called after the exact checkout subscription has been attested cancelled. */
export const recordMembershipWithdrawal = internalMutation({
  args: { id: v.id("rental_additions"), subscriptionId: v.string() },
  handler: async (ctx, { id, subscriptionId }) => {
    const r = await ctx.db.get(id), member = r?.membershipCheckoutId ? await ctx.db.get(r.membershipCheckoutId) : null;
    if (!r?.withdrawalRequestedAt || !member || member.bookingId !== r.bookingId || member.sessionId !== r.sessionId) throw Error("Membership withdrawal checkout mismatch");
    if (r.withdrawalMembershipSubscriptionId && r.withdrawalMembershipSubscriptionId !== subscriptionId || member.subscriptionId && member.subscriptionId !== subscriptionId) throw Error("Membership withdrawal subscription mismatch");
    const account = await ctx.db.get(member.accountId);
    if (!account || account.stripeSubscriptionId !== subscriptionId || account.membershipStatus !== "canceled") throw Error("Membership cancellation has not been reconciled");
    await ctx.db.patch(id, { withdrawalMembershipSubscriptionId: subscriptionId });
    await ctx.db.patch(member._id, { state: "expired", subscriptionId });
    await ctx.db.patch(account._id, { ...(member.intro !== "none" ? { membershipIntroUsed: true, membershipIntroChoice: member.intro } : {}),
      ...(account.membershipPerksPendingBookingId === r.bookingId ? { membershipPerksPendingBookingId: undefined } : {}) });
  },
});

export const close = internalMutation({
  args: {
    id: v.id("rental_additions"),
    refunded: v.boolean(),
    preserveBooking: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, refunded, preserveBooking }) => {
    const r = await ctx.db.get(id);
    if (!r) return;
    if (["applied", "applied_draft"].includes(r.status))
      throw Error("Applied items are settled through the rental");
    if (r.status === "refunded" || r.status === "expired") return;
    if (r.securityCreationPending) throw Error("Wait for the pending security authorisation to be reconciled");
    if (r.withdrawalRequestedAt && r.paymentIntentId && (!refunded || r.withdrawalRefundStatus !== "succeeded")) throw Error("Wait for the withdrawal refund to be confirmed");
    await releaseRentalCredit(ctx,"addition",String(r._id));
    const b = await ctx.db.get(r.bookingId);
    await ctx.db.patch(id, {
      status: refunded ? "refunded" : "expired",
      updatedAt: Date.now(),
    });
    if(r.draftReplacement&&!preserveBooking&&b?.status==="pending_payment"&&r.membershipCheckoutId){const member=await ctx.db.get(r.membershipCheckoutId);if(member&&["creating","open"].includes(member.state))await ctx.db.patch(member._id,{state:"expired"});}
    if (b?.activeAdditionId === id)
      await ctx.db.patch(
        b._id,
        r.draftReplacement && !preserveBooking && b.status === "pending_payment"
          ? {
              activeAdditionId: undefined,
              status: "cancelled",
              cancelledAt: Date.now(),
            }
          : { activeAdditionId: undefined },
      );
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", r.bookingId))
      .collect();
    for (const reservation of reservations)
      if (
        reservation.externalRef === `addition:${id}` ||
        (r.draftReplacement &&
          !preserveBooking &&
          reservation.status === "hold")
      )
        await ctx.db.delete(reservation._id);
    if (b)
      await note(
        ctx,
        b,
        refunded
          ? `The proposed addition of ${r.title} was withdrawn. Its payment is being returned to the card.`
          : r.draftReplacement && !preserveBooking
            ? `The updated checkout for ${r.title} closed without payment. This unpaid rental was cancelled; its conversation remains available.`
            : `The proposed addition of ${r.title} closed without payment. Your rental is unchanged.`,
      );
  },
});

export const open = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await Promise.all(
      [
        "prepared",
        "awaiting_acceptance",
        "awaiting_payment",
        "paid",
        "requires_action",
        "held",
        "failed",
        "withdrawing",
        "refund_pending",
        "refund_failed",
      ].map((status) =>
        ctx.db
          .query("rental_additions")
          .withIndex("by_status_recovery_updated", (q) => q.eq("status", status).eq("recoveryNeedsReview", undefined))
          .order("asc")
          .take(30),
      ),
    );
    return rows
      .flat()
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, 50);
  },
});
export const touch = internalMutation({
  args: { id: v.id("rental_additions") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.patch(id, { updatedAt: Date.now() });
  },
});

export const customerState = query({
  args: { token: v.string(), bookingId: v.id("bookings") },
  handler: async (ctx, { token, bookingId }) => {
    const account = await accountForToken(ctx, token);
    if (!account) return null;
    const b = await ownedBooking(ctx, account, bookingId);
    if (!b.activeAdditionId) return null;
    const r = await ctx.db.get(b.activeAdditionId as Id<"rental_additions">);
    if (!r) return null;
    const listing = await ctx.db.get(r.listingId);
    return {
      id: r._id,
      status: r.status,
      title: r.title,
      qty: r.qty,
      imageSources: listingRentalImages(listing),
      rentalCharge: r.lineTotal,
      benefitSaving: r.benefitSaving ?? 0,
      benefitLabel: r.benefitLabel ?? null,
      existingCheckoutBalance: r.draftReplacement ? r.baseTotal ?? 0 : 0,
      amount:
        (r.draftReplacement ? (r.baseTotal ?? 0) : 0) +
        r.lineTotal +
        r.securityCharge +(r.membershipFee??0),
      availableAccountCreditPence:!r.draftReplacement?await availableRentalCreditPence(ctx,account._id):0,
      creditOptIn:!!r.creditOptIn,
      draftReplacement:!!r.draftReplacement,
      creditAppliedPence:r.creditAppliedPence??0,
      cardDuePence:r.cardDuePence??Math.max(0,Math.round(((r.draftReplacement?(r.baseTotal??0):0)+r.lineTotal+r.securityCharge+(r.membershipFee??0))*100)-(r.creditAppliedPence??0)),
      securityCharge: r.securityCharge,
      requiresAcceptance:hasCashDepositPolicy(r.securityPolicyVersion)&&!r.customerAcceptedAt,
      securityPolicyVersion:r.securityPolicyVersion,savedCardLimit:r.proposedSavedCardLimit,depositAmount:(r.baseSecurity??0)+r.securityCharge,
      priorSavedCardLimit:r.priorSavedCardLimit,priorDeposit:r.baseSecurity,
      holdTotal: r.holdTotal,
      url: r.withdrawalRequestedAt ? null : r.paymentUrl ?? null,
      sessionId: r.withdrawalRequestedAt ? null : r.sessionId ?? null,
      expiresAt: r.createdAt + 24 * 3600000,
    };
  },
});

export const selectAccountCredit = internalMutation({
  args:{token:v.string(),bookingId:v.id("bookings"),additionId:v.id("rental_additions"),expectedSessionId:v.optional(v.string())},
  handler:async(ctx,a)=>{
    const account=await accountForToken(ctx,a.token);if(!account)throw Error("Sign in to use account credit.");
    const booking=await ownedBooking(ctx,account,a.bookingId),addition=await ctx.db.get(a.additionId);
    if(!addition||booking.activeAdditionId!==addition._id||addition.bookingId!==booking._id||addition.withdrawalRequestedAt||addition.status==="applied"||addition.status==="applied_draft"||addition.draftReplacement||addition.membershipCheckoutId)throw Error("This item addition is no longer eligible for account credit.");
    if(hasCashDepositPolicy(addition.securityPolicyVersion)&&!addition.customerAcceptedAt)throw Error("Accept the equipment security terms before choosing account credit.");
    if(addition.paymentIntentId)throw Error("Payment has already started. The existing card payment must be resolved first.");
    if(addition.sessionId!==a.expectedSessionId)throw Error("The payment link changed. Refresh the addition and try again.");
    if(addition.creditOptIn){
      if(addition.customerAccountId!==account._id)throw Error("Account-credit choice belongs to another renter.");
      return addition;
    }
    if(addition.sessionCreationPending || !addition.sessionId && addition.checkoutProtocolVersion!==2)throw Error("The existing card payment is being checked. Wait for it to be resolved before choosing account credit.");
    const requestedPence=Math.round(addition.lineTotal*100),now=Date.now();
    if(!Number.isSafeInteger(requestedPence)||requestedPence<=0)throw Error("This addition has no rental charge for account credit to cover.");
    const reservation=await reserveRentalCredit(ctx,{accountId:account._id,bookingId:booking._id,operationType:"addition",operationId:String(addition._id),requestedPence,expiresAt:addition.createdAt+24*3600000});
    if(!reservation)throw Error("No account credit is currently available.");
    const cardDuePence=Math.max(0,Math.round((addition.lineTotal+addition.securityCharge)*100)-reservation.amountPence);
    const patch={creditOptIn:true,creditReservationId:reservation._id,creditAppliedPence:reservation.amountPence,cardDuePence,customerAccountId:account._id,checkoutProtocolVersion:2,sessionCreationPending:false,sessionId:undefined,paymentUrl:undefined,updatedAt:now};
    await ctx.db.patch(addition._id,patch);
    return {...addition,...patch};
  },
});

export const acceptSecurity=internalMutation({args:{token:v.string(),bookingId:v.id("bookings"),additionId:v.id("rental_additions"),expectedDeposit:v.number(),expectedLimit:v.number(),confirmed:v.boolean()},handler:async(ctx,a)=>{const account=await accountForToken(ctx,a.token);if(!account||!a.confirmed)throw Error("Review and accept the equipment and security update first.");const b=await ownedBooking(ctx,account,a.bookingId),r=await ctx.db.get(a.additionId);if(r&&r.bookingId===b._id&&r.customerAccountId===account._id&&["applied","applied_draft"].includes(r.status)&&a.expectedDeposit===(r.baseSecurity??0)+r.securityCharge&&a.expectedLimit===r.proposedSavedCardLimit)return r;if(!r||b.activeAdditionId!==r._id||r.bookingId!==b._id||r.withdrawalRequestedAt||r.createdAt+23*3600000<=Date.now()||!hasCashDepositPolicy(r.securityPolicyVersion)||a.expectedDeposit!==(r.baseSecurity??0)+r.securityCharge||a.expectedLimit!==r.proposedSavedCardLimit||b.depositAmount!==r.baseSecurity||b.savedCardLimit!==r.priorSavedCardLimit)throw Error("The equipment proposal changed or expired. Review it again.");if(r.customerAcceptedAt){if(r.customerAccountId!==account._id)throw Error("Equipment acceptance account mismatch.");return r}const acceptedAt=Date.now(),patch={customerAcceptedAt:acceptedAt,customerAccountId:account._id,customerConsentText:securityAmendmentConsentText(a.expectedLimit,a.expectedDeposit,b.savedCardLimit!,b.depositAmount,b.securityPolicyVersion),status:"prepared",updatedAt:acceptedAt};await ctx.db.patch(r._id,patch);return {...r,...patch};}});
