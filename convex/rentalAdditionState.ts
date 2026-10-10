import { compoundRefundCanClose, compoundRefundOnlyBinding } from './lib/compoundSwap';
import { assertRefundOnlyResolution } from './lib/rentalSwapRefund';
import { applyRentalAddition } from './lib/rentalAdditionApply';
import { approvedKitRequest, assertKitAddition } from "./lib/kitRequestBinding";
import { paidSwapPlan, swapStockWindow } from "./lib/rentalSwapSettlement";
import { accountForRental } from "./lib/rentalAccount";
import { listingImages } from "./lib/catalogImages";
import {canDeferAdditionSecurity} from "../shared/pickupSecurity";
import {schedulePickupHold} from "./pickupSecurity";
import { tierByKey } from "../shared/membership";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { queueRmv2Sync } from "./lib/rmv2SyncQueue";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { assertRenterExposure, replacementValues } from "./lib/rentalExposure";
import { assertRentalInventory } from "./lib/rentalInventory";
import {
  accountForToken,
  ownedBooking,
  postRentalMessage,
} from "./lib/rentalChat";
import { quote } from "./lib/pricing";
import { securityForPolicy } from "../shared/rentalSecurity";

async function note(ctx: any, b: any, text: string, meta?: any) {
  const a = await accountForRental(ctx, b);
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
    const booking = await ctx.db.get(addition.bookingId);
    return { addition, booking, swapProposal: addition.swapProposalId ? await ctx.db.get(addition.swapProposalId) : null, account: booking ? await accountForRental(ctx, booking) : null, membershipCheckout,
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
    return Promise.all(rows.map(async ({ securityCreationParams: _privateParams, ...row }) => {
      const images=listingImages(await ctx.db.get(row.listingId));
      const swap=row.swapProposalId?await ctx.db.get(row.swapProposalId):null;
      const refund=swap?.settlementRefundId?await ctx.db.get(swap.settlementRefundId):null;
      return {...row,rentalRefundAmount:swap?.refundPence?swap.refundPence/100:0,
        rentalRefundStatus:refund?.cancelledBeforeBankAt?"cancelled":refund?.status??null,
        canWithdraw:!refund||compoundRefundCanClose(refund),heroImage:images[0]??null,imageSources:images};
    }));
  },
});
async function additionQuote(ctx: QueryCtx, b: Doc<"bookings"> | null, a: {listingId:Id<"listings">;qty:number;start?:number;end?:number;complimentary?:boolean}) {
    if (
      !b ||
      !["pending_payment", "confirmed", "active"].includes(b.status) ||
      b.cancellationDecision ||
      b.returnDecision
    )
      throw Error("This rental cannot accept items");
    if (b.activeSwapRefundId || b.activeAdditionId || b.activeExtensionId)
      throw Error("Finish or withdraw the current item addition or approved extension first");
    if (
      ["starting", "requires_action", "failed"].includes(
        b.depositHoldRenewalStatus ?? "",
      )
    )
      throw Error("Resolve the existing card hold renewal before adding items");
    if (
      b.status !== "pending_payment" &&
      !canDeferAdditionSecurity(b) &&
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
    const reservations = await ctx.db
      .query("reservations")
      .withIndex("by_booking", (q) => q.eq("bookingId", b._id))
      .collect();
    if (reservations.some((r) => r.source !== "site"))
      throw Error("Use the original booking platform for this rental");
    if (
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
        Math.min(...b.lineItems.map((li: any) => li.start)),
        new Date().setUTCHours(0, 0, 0, 0),
      );
    const end = a.end ?? Math.max(...b.lineItems.map((li: any) => li.end));
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start % 86400000 !== 0 ||
      end % 86400000 !== 0 ||
      end < start ||
      end < new Date().setUTCHours(0, 0, 0, 0)
    )
      throw Error("Choose valid current or future rental dates");
    const line = {
      listingId: l._id,
      title: l.title,
      start,
      end,
      qty: a.qty,
      lineTotal: a.complimentary
        ? 0
        : quote(l.pricing, Math.round((end - start) / 86400000) + 1).total *
          a.qty,
    };
    await assertRenterExposure(ctx, b, [...b.lineItems, line]);
    await assertRentalInventory(ctx, [...b.lineItems, line], b._id);
    const catalog = await Promise.all(
      b.lineItems.map((li: any) => ctx.db.get(li.listingId)),
    );
    const value =
      catalog.reduce(
        (sum: number, item: any, i: number) => sum + (item?.depositAmount ?? 0) * b.lineItems[i].qty,
        0,
      ) +
      l.depositAmount * a.qty;
    const security = securityForPolicy(b.securityPolicyVersion, b.protection === "deposit" ? "deposit" : "verify", value);
    const holdTotal = Math.max(
      b.depositHoldAmount ?? 0,
      security.hold,
    );
    const securityCharge = ["paid_membership","new_paid_membership"].includes(b.securityWaiverReason??"") ? 0 : Math.max(
      0,
      security.deposit - b.depositAmount,
    );
    const membership=b.status==="pending_payment"&&b.membershipCheckoutId?await ctx.db.get(b.membershipCheckoutId):null;
    if(membership&&(!membership.sessionParams||!["creating","open"].includes(membership.state)||membership.bookingId!==b._id))throw Error("Refresh the initial membership checkout before changing its order.");
    const membershipParams=membership?.sessionParams?JSON.parse(membership.sessionParams):null;
    const membershipFee=membership?membershipParams?.metadata?.membershipFeePence?Number(membershipParams.metadata.membershipFeePence)/100:membership.intro==="trial"?0:tierByKey(membership.tier)?.monthlyGbp:undefined;
    if(membership&&(typeof membershipFee!=="number"||!Number.isFinite(membershipFee)||membershipFee<0))throw Error("Membership price snapshot is unavailable.");
    return {l,line,start,end,securityCharge,holdTotal,membership,membershipFee};
}
export const proposalQuote = query({
 args:{token:v.string(),bookingId:v.id("bookings"),changeRequestId:v.optional(v.id("rental_change_requests")),listingId:v.id("listings"),qty:v.number(),start:v.optional(v.number()),end:v.optional(v.number()),complimentary:v.optional(v.boolean())},
 handler:async(ctx,args)=>{
  if(!checkAdminToken(args.token))return null;
  const b=await ctx.db.get(args.bookingId);
  try{
   assertKitAddition(await approvedKitRequest(ctx,b,args.changeRequestId),args.listingId,args.qty);
   const q=await additionQuote(ctx,b,args),images=listingImages(q.l);
   return {available:true,reason:null,title:q.line.title,start:q.start,end:q.end,qty:q.line.qty,lineTotal:q.line.lineTotal,securityCharge:q.securityCharge,holdTotal:q.holdTotal,baseAmount:b!.status==="pending_payment"?b!.total:0,membershipFee:q.membershipFee??0,amount:(b!.status==="pending_payment"?b!.total:0)+q.line.lineTotal+q.securityCharge+(q.membershipFee??0),heroImage:images[0]??null,imageSources:images};
  }catch(e:any){return {available:false,reason:e.message??"Unable to quote this proposal."};}
 }
});
export const prepare = internalMutation({
  args: {
    token: v.string(),
    bookingId: v.id("bookings"),
    requestId: v.string(),
    changeRequestId:v.optional(v.id("rental_change_requests")),
    listingId: v.id("listings"),
    qty: v.number(),
    reason: v.string(),
    expectedAmount: v.optional(v.number()),
    expectedHoldTotal: v.optional(v.number()),
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
      if(a.changeRequestId&&prior.changeRequestId!==a.changeRequestId)throw Error("This saved proposal belongs to a different customer request");
      return prior;
    }
    const b = await ctx.db.get(a.bookingId);
    if(!b)throw Error("This rental cannot accept items");
    const linkedRequest=await approvedKitRequest(ctx,b,a.changeRequestId);
    assertKitAddition(linkedRequest,a.listingId,a.qty);
    if (a.reason.trim().length < 5) throw Error("Choose a quantity from 1–20 and record the reason");
    const {l,line,start,end,securityCharge,holdTotal,membership,membershipFee}=await additionQuote(ctx,b,a);
    const amount=(b!.status==="pending_payment"?b!.total:0)+line.lineTotal+securityCharge+(membershipFee??0);
    if(a.expectedAmount!==undefined&&Math.round(a.expectedAmount*100)!==Math.round(amount*100)||a.expectedHoldTotal!==undefined&&Math.round(a.expectedHoldTotal*100)!==Math.round(holdTotal*100))throw Error("The proposal quote changed. Review its current price and security before sending.");
    const id = await ctx.db.insert("rental_additions", {
      ...line,
      bookingId: b._id,
      requestId: a.requestId,
      changeRequestId:a.changeRequestId,
      dailyRate: a.complimentary ? 0 : l.pricing.daily * a.qty,
      complimentary: !!a.complimentary || line.lineTotal === 0,
      securityCharge,
      holdTotal,
      oldHoldId: b.stripeDepositIntentId,
      draftReplacement: b.status === "pending_payment",
      baseTotal: b.total,
      baseSecurity: b.depositAmount,
      baseSessionId: b.stripeCheckoutSessionId,
      ...(membership?{membershipCheckoutId:membership._id,membershipFee,membershipSessionParams:membership.sessionParams}:{}),
      status: "prepared",
      reason: a.reason.trim().slice(0, 400),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    if(linkedRequest)await ctx.db.patch(linkedRequest._id,{additionRequestId:id});
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
    return (await ctx.db.get(id))!;
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
    await note(
      ctx,
      b,
      r.swapProposalId
        ? `The accepted equipment swap is ready for payment: ${r.qty}× ${r.title}. Rental difference £${r.lineTotal.toFixed(2)}${r.securityCharge ? ` + £${r.securityCharge.toFixed(2)} refundable security` : ""}. Your original kit remains booked until payment and the swap are confirmed.`
        : r.draftReplacement
        ? `The team proposed adding ${r.qty}× ${r.title}. Review the updated rental and complete its checkout.${r.membershipCheckoutId ? ` Your membership is preserved: £${(r.membershipFee??0).toFixed(2)} membership fee in this checkout${r.membershipFee===0?" (free-week trial)":""}; renewal remains as agreed.`:""}`
        : `The team proposed adding ${r.qty}× ${r.title}: £${r.lineTotal.toFixed(2)} rental${r.securityCharge ? ` + £${r.securityCharge.toFixed(2)} refundable security` : ""}. The updated card hold is £${r.holdTotal.toFixed(2)}. Items are confirmed after payment and any bank approval.`,
      {
        kind: "paylink",
        url,
        amount: r.draftReplacement
          ? (r.baseTotal ?? 0) + r.lineTotal + r.securityCharge + (r.membershipFee??0)
          : r.lineTotal + r.securityCharge,
      },
    );
    await ctx.scheduler.runAfter(0, internal.notify.changeEmail, {
      bookingId: b._id,
      kind: r.swapProposalId ? "equipment swap payment ready" : "item addition proposed",
      detail: `${r.qty}× ${r.title}. Review the secure payment link in your rental conversation.`,
    });
  },
});
export const markPaid = internalMutation({
  args: { id: v.id("rental_additions"), paymentIntentId: v.string() },
  handler: async (ctx, { id, paymentIntentId }) => {
    const r = await ctx.db.get(id);
    if (!r) throw Error("Addition missing");
    if (r.paymentIntentId && r.paymentIntentId !== paymentIntentId)
      throw Error("Addition payment mismatch");
    if (["applied", "applied_draft", "refunded"].includes(r.status)) return;
    await ctx.db.patch(id, {
      paymentIntentId,
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
  handler: async (ctx, { id }) => applyRentalAddition(ctx, id),
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
export const prepareRefundOnlyClosure=internalMutation({
 args:{token:v.string(),id:v.id('rental_additions'),quoteKey:v.string(),reason:v.string()},
 handler:async(ctx,{token,id,quoteKey,reason})=>{
  await assertAdmin(ctx,token,'rentalAdditions.closeRefundOnly');
  const addition=await ctx.db.get(id),row=addition?.swapProposalId?await ctx.db.get(addition.swapProposalId):null;
  if(!addition||!row||row.quoteKey!==quoteKey||row.settlementAdditionId!==id||!row.settlementRefundId)throw Error('Choose this exact saved combined settlement.');
  const refund=await ctx.db.get(row.settlementRefundId),booking=await ctx.db.get(addition.bookingId),text=reason.trim();
  if(row.refundOnlyResolution){
   if(text!==row.refundOnlyResolution.reason)throw Error('The saved resolution reason changed. Resume the recorded decision.');
   return {...assertRefundOnlyResolution(row,refund),id};
  }
  if(!booking||text.length<5||text.length>400)throw Error('Record a resolution reason of 5–400 characters.');
  if(row.refundOnlyRequest&&text!==row.refundOnlyRequest.reason)throw Error('The saved resolution reason changed. Resume the recorded decision.');
  if(addition.withdrawalRequestedAt&&!row.refundOnlyRequest)throw Error('Finish the existing withdrawal first.');
  const decision=row.refundOnlyRequest??{reason:text,requestedAt:Date.now(),refundedPence:row.refundPence,
   securityAtClosure:{depositPaidPence:Math.round(booking.depositAmount*100),holdPence:Math.round((booking.depositHoldAmount??0)*100)}};
  if(Object.values(decision.securityAtClosure).some(n=>!Number.isSafeInteger(n)||n<0))throw Error('The original security needs reconciliation.');
  await compoundRefundOnlyBinding(ctx,addition,refund,decision);
  await ctx.db.patch(row._id,{refundOnlyRequest:decision,updatedAt:Date.now()});
  // Freeze application in the same transaction as the owner decision. The
  // existing withdrawal worker can now resume the exact extra-deposit refund.
  if(!addition.withdrawalRequestedAt)await ctx.db.patch(id,{withdrawalRequestedAt:Date.now(),status:'withdrawing',updatedAt:Date.now()});
  return {closed:false,id};
 }
});
export const beginWithdrawal = internalMutation({
  args: { id: v.id("rental_additions") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (!r) throw Error("Addition missing");
    if (["applied", "applied_draft"].includes(r.status)) throw Error("Applied items are settled through the rental");
    if (["refunded", "expired"].includes(r.status)) return r;
    if(r.withdrawalRequestedAt){
      const row=r.swapProposalId?await ctx.db.get(r.swapProposalId):null;
      if(row?.refundOnlyRequest)await compoundRefundOnlyBinding(ctx,r,await ctx.db.get(row.settlementRefundId!));
      return r;
    }
    if(r.swapProposalId){
      const swap=await ctx.db.get(r.swapProposalId);
      if(swap?.settlementRefundId){
        const refund=await ctx.db.get(swap.settlementRefundId);
        if(swap.settlementAdditionId!==id||!refund||refund.swapProposalId!==swap._id||refund.bookingId!==r.bookingId||!compoundRefundCanClose(refund))
          throw Error("The original rental refund has started. Reconcile its bank result before withdrawing the combined settlement.");
      }
    }
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
    const expected = Math.round(((r.draftReplacement ? r.baseTotal ?? 0 : 0) + r.lineTotal + r.securityCharge + (r.membershipFee ?? 0)) * 100);
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
    const b = await ctx.db.get(r.bookingId);
    if(r.swapProposalId){
      const swap=await ctx.db.get(r.swapProposalId);
      if(!swap||swap.settlementAdditionId!==id||swap.bookingId!==r.bookingId||swap.changeRequestId!==r.changeRequestId||swap.state!=="accepted")throw Error("The swap withdrawal receipt needs reconciliation.");
      if(swap.settlementRefundId){
        const refund=await ctx.db.get(swap.settlementRefundId);
        if(!b||!refund)throw Error("The saved rental and refund need reconciliation.");
        if(swap.refundOnlyRequest)await compoundRefundOnlyBinding(ctx,r,refund);
        else if(!refund||refund.swapProposalId!==swap._id||refund.bookingId!==r.bookingId||b?.activeSwapRefundId!==refund._id||!compoundRefundCanClose(refund))
          throw Error("The original rental refund needs reconciliation before the additional deposit can be closed.");
        if(refund!.status==="prepared")await ctx.db.patch(refund!._id,{status:"failed",cancelledBeforeBankAt:Date.now(),updatedAt:Date.now()});
        await ctx.db.patch(b._id,{activeSwapRefundId:undefined});
      }
      await ctx.db.patch(swap._id,{state:"withdrawn",updatedAt:Date.now(),...(swap.refundOnlyRequest?{settlementError:undefined,refundOnlyResolution:{reason:swap.refundOnlyRequest.reason,refundedPence:swap.refundOnlyRequest.refundedPence,securityAtClosure:swap.refundOnlyRequest.securityAtClosure,closedAt:Date.now(),operationKey:`kit-swap-refund-only:${r.bookingId}:${swap._id}:${swap.quoteKey}`}}:{})});
    }
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
      .take(201);
    if(reservations.length>200)throw Error("The proposal stock history needs reconciliation.");
    for (const reservation of reservations)
      if (
        reservation.externalRef === `addition:${id}` ||
        (r.draftReplacement &&
          !preserveBooking &&
          reservation.status === "hold")
      )
        await ctx.db.delete(reservation._id);
    const closedSwap=r.swapProposalId?await ctx.db.get(r.swapProposalId):null;
    if(b&&closedSwap?.refundOnlyResolution){
      const detail=`The swap was closed and your original kit and security remain booked. The completed £${(closedSwap.refundOnlyResolution.refundedPence/100).toFixed(2)} rental refund is retained, and the £${r.securityCharge.toFixed(2)} additional refundable deposit was returned to its original payment method. ${closedSwap.refundOnlyResolution.reason}`;
      await postRentalMessage(ctx,{accountId:closedSwap.accountId,bookingId:b._id,sender:'owner',text:detail,meta:{type:'rental_swap_refund_only_closed',changeRequestId:closedSwap.changeRequestId,swapProposalId:closedSwap._id}});
      await ctx.scheduler.runAfter(0,internal.notify.changeEmail,{bookingId:b._id,kind:'swap refund resolution',detail});
      await queueRmv2Sync(ctx,b._id);
    } else if (b)
      await note(
        ctx,
        b,
        refunded
          ? `The proposed ${r.swapProposalId ? "swap" : "addition"} of ${r.title} was withdrawn. Its payment is being returned to the card.`
          : r.draftReplacement && !preserveBooking
            ? `The updated checkout for ${r.title} closed without payment. This unpaid rental was cancelled; its conversation remains available.`
            : `The proposed ${r.swapProposalId ? "swap" : "addition"} of ${r.title} closed without payment. Your rental is unchanged.`,
      );
  },
});

export const open = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await Promise.all(
      [
        "prepared",
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
          .withIndex("by_status_updated", (q) => q.eq("status", status))
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
    if (!r || r.bookingId !== b._id) return null;
    const sources = listingImages(await ctx.db.get(r.listingId));
    const currentItems = await Promise.all(b.lineItems.map(async (line: any) => {
      const images = listingImages(await ctx.db.get(line.listingId));
      return { title: line.title, qty: line.qty, start: line.start, end: line.end, heroImage: images[0] ?? null, imageSources: images };
    }));
    const swap=r.swapProposalId?await ctx.db.get(r.swapProposalId):null;
    if(r.swapProposalId&&(!swap||swap.settlementAdditionId!==r._id||swap.bookingId!==b._id||swap.accountId!==account._id))return null;
    const refund=swap?.settlementRefundId?await ctx.db.get(swap.settlementRefundId):null;
    if(refund&&(refund.swapProposalId!==swap!._id||refund.bookingId!==b._id))return null;
    const proposedLines=swap?JSON.parse(swap.finalLines):[...b.lineItems,{listingId:r.listingId,title:r.title,qty:r.qty,start:r.start,end:r.end}];
    const proposedItems=await Promise.all(proposedLines.map(async(line:any)=>{
      const images=listingImages(await ctx.db.get(line.listingId));
      return {title:line.title,qty:line.qty,start:line.start,end:line.end,heroImage:images[0]??null,imageSources:images};
    }));
    let securityDeferred = false;
    try { securityDeferred = !r.draftReplacement && canDeferAdditionSecurity(b); } catch {}
    return {
      id: r._id,
      start: r.start, end: r.end,
      lineTotal: r.lineTotal,
      baseAmount: r.draftReplacement ? r.baseTotal ?? 0 : 0,
      currentItems, proposedItems, isSwap:!!swap, rentalRefundAmount:swap?.refundPence?swap.refundPence/100:0, rentalRefundStatus:refund?.status??null,
      heroImage: sources[0] ?? null, imageSources: sources,
      securityDeferred,
      paymentReceived: !!r.paymentIntentId,
      membershipFee: r.membershipFee ?? 0,
      status: r.status,
      title: r.title,
      qty: r.qty,
      amount:
        (r.draftReplacement ? (r.baseTotal ?? 0) : 0) +
        r.lineTotal +
        r.securityCharge + (r.membershipFee ?? 0),
      securityCharge: r.securityCharge,
      holdTotal: r.holdTotal,
      url: r.withdrawalRequestedAt ? null : r.paymentUrl ?? null,
      sessionId: r.withdrawalRequestedAt ? null : r.sessionId ?? null,
      expiresAt: r.createdAt + 24 * 3600000,
    };
  },
});
