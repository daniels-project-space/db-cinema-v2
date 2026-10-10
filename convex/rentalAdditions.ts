"use node";
import {canDeferAdditionSecurity,PICKUP_HOLD_POLICY,pickupHoldAt} from "../shared/pickupSecurity";
import Stripe from "stripe";
import { checkoutPaymentIntent, syncStripeMembership } from "./checkout";
import { createHash } from "node:crypto";
import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
const sb = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw Error("Stripe is not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};
const money = (n: number) => Math.round(n * 100);
/** The saved checkout pointer and provider receipt must both attest the update
 * before it becomes a payment source, changes stock, or triggers a refund. */
async function verifiedUpdatePayment(state: any, session: Stripe.Checkout.Session) {
  const r = state.addition;
  const expected = money((r.draftReplacement ? r.baseTotal ?? 0 : 0) + r.lineTotal + r.securityCharge + (r.membershipFee ?? 0));
  const noPayment = !!r.membershipCheckoutId && session.payment_status === "no_payment_required";
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const metadata = session.metadata;
  const bound = r.draftReplacement
    ? metadata?.pendingAdditionId === r._id && metadata?.bookingId === r.bookingId
    : metadata?.rentalAdditionId === r._id && metadata?.additionBookingId === r.bookingId;
  if (session.id !== r.sessionId || session.status !== "complete" || session.currency !== "gbp" ||
      !Number.isSafeInteger(expected) || expected < 0 || session.amount_total !== expected || !customer || !bound ||
      (session.payment_status !== "paid" && !noPayment) || noPayment && expected !== 0)
    throw Error("The update checkout receipt does not match the saved order.");
  if (r.membershipCheckoutId) {
    const member = state.membershipCheckout, account = state.membershipAccount;
    if (!member || !account || member.bookingId !== r.bookingId || member.sessionId !== session.id || customer !== account.stripeCustomerId)
      throw Error("The membership update payment does not match the associated account or order.");
  }
  if (noPayment) return undefined;
  const paymentId = await checkoutPaymentIntent(session);
  if (!paymentId) throw Error("Paid update has no captured payment receipt.");
  const payment = await sb().paymentIntents.retrieve(paymentId);
  const paymentCustomer = typeof payment.customer === "string" ? payment.customer : payment.customer?.id;
  if (payment.id !== paymentId || r.paymentIntentId && r.paymentIntentId !== paymentId || payment.status !== "succeeded" ||
      payment.currency !== "gbp" || payment.amount !== expected || payment.amount_received !== expected ||
      payment.amount_capturable !== 0 || !["automatic", "automatic_async"].includes(payment.capture_method) || paymentCustomer !== customer)
    throw Error("The update payment is not the exact captured payment for this checkout.");
  return payment;
}
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
    if (original.status === "complete" && ["paid","no_payment_required"].includes(original.payment_status)) {
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
  if (!Number.isSafeInteger(money(amount)) || amount < 0 || amount === 0 && !r.membershipCheckoutId)
    throw Error("The rental update has no payable amount");
  const origin = new URL(process.env.APP_URL ?? "https://dbcinemarentals.com")
    .origin;
  const customerEmail = state.account?.email ?? (!b.accountId ? b.guestEmail : undefined);
  if(!customerEmail)throw Error("The associated rental account needs review before a payment link can be sent.");
  let params: Stripe.Checkout.SessionCreateParams = {
      integration_identifier: `db-rental-update-${Array.from(createHash("sha256").update(r.requestId).digest().subarray(0, 8), (n) => String.fromCharCode(97 + (n % 26))).join("")}`,
      custom_text: {
        submit: {
          message: `By paying you accept the updated rental under our [terms](${origin}/legal/terms), including the stated refundable security charge and updated card authorisation. For pickup-scheduled security, the updated hold is requested at pickup on your saved card. Documented late fees and damage are handled under your rental agreement.`,
        },
      },
      mode: "payment",
      adaptive_pricing: {enabled:false},
      expires_at: Math.floor(r.createdAt / 1000) + 24 * 60 * 60,
      customer_email: customerEmail,
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
                : r.swapProposalId ? r.lineTotal===0&&r.securityCharge>0 ? "DB Cinema additional refundable deposit" : "DB Cinema equipment swap price difference" : "DB Cinema rental item addition",
              description:
                `${r.qty}× ${r.title}. ${r.swapProposalId ? "Rental difference" : "Rental"} £${r.lineTotal.toFixed(2)}; additional refundable security £${r.securityCharge.toFixed(2)}. Updated card hold £${r.holdTotal.toFixed(2)}.${r.draftReplacement ? ` Includes existing rental checkout £${(r.baseTotal ?? 0).toFixed(2)}.` : ""}`.slice(
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
    };
  if(state.swapProposal?.settlementRefundId){
    if(!b.securityHoldCustomerId||!canDeferAdditionSecurity(b))throw Error("The saved pickup card needs reconciliation before a combined swap checkout.");
    params={...params,customer:b.securityHoldCustomerId,customer_email:undefined,customer_creation:undefined};
  }
  if(r.membershipCheckoutId){
    const original:Stripe.Checkout.SessionCreateParams=JSON.parse(r.membershipSessionParams);
    const recurring=(original.line_items??[]).filter(line=>typeof line.price==="string");
    if(original.mode!=="subscription"||recurring.length!==1||!original.customer)throw Error("Original membership checkout is not recoverable.");
    params={...original,...params,mode:"subscription",customer:original.customer,customer_email:undefined,customer_creation:undefined,payment_intent_data:undefined,
      subscription_data:original.subscription_data,
      line_items:[...(params.line_items??[]),...recurring],
      metadata:{...original.metadata,...params.metadata,rentalPaidPence:String(money(amount)),membershipFeePence:String(money(r.membershipFee??0))}};
  }
  const session=await sb().checkout.sessions.create(params,{idempotencyKey:`dbc-addition-checkout-${id}`});
  if (!session.url) throw Error("Stripe did not provide a payment link");
  await ctx.runMutation(internal.rentalAdditionState.bindSession, {
    id,
    sessionId: session.id,
    url: session.url,
  });
  return session;
}
async function recoverPreparedSecurity(ctx: any, r: any): Promise<Stripe.PaymentIntent> {
  if (!r.securityCreationParams || !r.securityCreationPreparedAt) throw Error("The pending security authorisation needs reconciliation");
  const params: Stripe.PaymentIntentCreateParams = JSON.parse(r.securityCreationParams);
  let intent: Stripe.PaymentIntent | undefined;
  if (Date.now() >= r.securityCreationPreparedAt + 23 * 3600000) {
    for await (const found of sb().paymentIntents.list({ customer: params.customer as string, created: { gte: Math.floor(r.securityCreationPreparedAt / 1000) - 5 }, limit: 100 })) {
      if (found.metadata.rentalAdditionId === r._id && found.metadata.purpose === "replacement_rental_security_hold") { intent = await sb().paymentIntents.retrieve(found.id, { expand: ["latest_charge"] }); break; }
    }
    if (!intent) throw Error("The unresolved security authorisation needs provider reconciliation; no new hold was created");
  } else {
    try { intent = await sb().paymentIntents.create(params, { idempotencyKey: `dbc-addition-security-${r._id}` }); }
    catch (e: any) {
      const known = e?.raw?.payment_intent?.id ?? e?.payment_intent?.id;
      if (!known) throw e;
      intent = await sb().paymentIntents.retrieve(known, { expand: ["latest_charge"] });
    }
  }
  const customer = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
  const method = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (intent.amount !== params.amount || intent.currency !== "gbp" || intent.capture_method !== "manual" || customer !== params.customer || method !== params.payment_method || intent.metadata.rentalAdditionId !== r._id || intent.metadata.bookingId !== r.bookingId || intent.metadata.purpose !== "replacement_rental_security_hold") throw Error("Recovered security authorisation does not match its prepared request");
  await ctx.runMutation(internal.rentalAdditionState.bindHold, { id: r._id, intentId: intent.id, status: intent.status === "requires_capture" ? "held" : intent.status === "requires_action" ? "requires_action" : "failed", expiresAt: expires(intent) });
  return intent;
}

async function withdraw(ctx: any, id: any): Promise<{ pending: boolean; needsAttention?: boolean } | undefined> {
  const state: any = await ctx.runQuery(internal.rentalAdditionState.context, {
    id,
  });
  if (!state) return;
  const r: any = await ctx.runMutation(internal.rentalAdditionState.beginWithdrawal, { id });
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
  const bound: any = await ctx.runQuery(internal.rentalAdditionState.context, { id });
  if (bound?.addition) Object.assign(r, bound.addition);
  if (session.status === "open")
    Object.assign(session, await sb().checkout.sessions.expire(session.id));
  else if (session.status !== "expired" && !(session.status === "complete" && r.membershipCheckoutId && session.payment_status === "no_payment_required") && session.payment_status !== "paid")
    throw Error(
      "The addition payment is still processing. Wait for its provider result.",
    );
  const paid = session.payment_status === "paid";
  const noPayment = !!r.membershipCheckoutId && session.status === "complete" && session.payment_status === "no_payment_required";
  const complete = paid || noPayment;
  const expected = money((r.draftReplacement ? r.baseTotal ?? 0 : 0) + r.lineTotal + r.securityCharge + (r.membershipFee ?? 0));
  if (session.id !== r.sessionId || complete && (session.status !== "complete" || session.currency !== "gbp" || session.amount_total !== expected || noPayment && expected !== 0)) throw Error("Withdrawal session does not match the saved order");
  const verifiedPayment = complete ? await verifiedUpdatePayment({ ...state, ...bound, addition: r }, session) : undefined;
  if (complete && r.membershipCheckoutId) {
    const member = bound?.membershipCheckout, account = bound?.membershipAccount;
    const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (!member || !account || member.bookingId !== r.bookingId || member.sessionId !== session.id || customer !== account.stripeCustomerId || !subId || member.subscriptionId && member.subscriptionId !== subId || r.withdrawalMembershipSubscriptionId && r.withdrawalMembershipSubscriptionId !== subId) throw Error("Membership withdrawal ownership mismatch");
    let sub = await sb().subscriptions.retrieve(subId);
    const assertSubscription = (candidate: Stripe.Subscription) => {
      const subCustomer = typeof candidate.customer === "string" ? candidate.customer : candidate.customer.id;
      if (candidate.id !== subId || subCustomer !== customer || candidate.metadata.membershipCheckoutId !== r.membershipCheckoutId || candidate.metadata.bookingId !== r.bookingId || candidate.metadata.membershipTier !== member.tier || candidate.metadata.accountEmail !== account.email || account.membershipActive && account.stripeSubscriptionId !== subId) throw Error("Membership withdrawal subscription mismatch");
    };
    assertSubscription(sub);
    if (sub.status !== "canceled") {
      try { sub = await sb().subscriptions.cancel(subId, { invoice_now: false, prorate: false }); }
      catch (error) { const current = await sb().subscriptions.retrieve(subId); if (current.status !== "canceled") throw error; sub = current; }
    }
    assertSubscription(sub);
    if (sub.status !== "canceled") throw Error("The membership cancellation is not confirmed");
    await syncStripeMembership(ctx, sub);
    await ctx.runMutation(internal.rentalAdditionState.recordMembershipWithdrawal, { id, subscriptionId: subId });
  }
  const payment = verifiedPayment?.id;
  if (paid && payment) {
    await ctx.runMutation(internal.rentalAdditionState.markPaid, {
      id,
      paymentIntentId: payment,
    });
    let refund: Stripe.Refund | undefined;
    if (r.withdrawalRefundId) refund = await sb().refunds.retrieve(r.withdrawalRefundId);
    else {
      // Recover an accepted refund whose response/binding was lost, including
      // after Stripe's idempotency window, without issuing another refund.
      for await (const found of sb().refunds.list({ payment_intent: payment, limit: 100 })) {
        if (found.metadata?.rentalAdditionWithdrawalId === id) { refund = found; break; }
      }
      if (!refund) refund = await sb().refunds.create({ payment_intent: payment, metadata: { rentalAdditionWithdrawalId: id } }, { idempotencyKey: `dbc-addition-withdraw-${id}` });
    }
    const refundPayment = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
    if (refundPayment !== payment || refund.currency !== "gbp" || refund.amount !== session.amount_total) throw Error("Withdrawal refund does not match the saved payment");
    await ctx.runMutation(internal.rentalAdditionState.recordWithdrawalRefund, { id, paymentIntentId: payment, refundId: refund.id, status: refund.status ?? "pending", amountPence: refund.amount });
    if (refund.status !== "succeeded") return { pending: true, needsAttention: ["failed", "canceled", "requires_action"].includes(refund.status ?? "") };
  } else if (paid) throw Error("Paid withdrawal has no confirmed payment");
  const latest: any = await ctx.runQuery(internal.rentalAdditionState.context, { id });
  if (latest?.addition) Object.assign(r, latest.addition);
  if (r.securityCreationPending) {
    await recoverPreparedSecurity(ctx, r);
    const recovered: any = await ctx.runQuery(internal.rentalAdditionState.context, { id });
    if (recovered?.addition) Object.assign(r, recovered.addition);
  }
  if (r.holdIntentId && r.holdIntentId !== r.oldHoldId) {
    const hold = await sb().paymentIntents.retrieve(r.holdIntentId);
    if (hold.amount_received > 0) throw Error("The captured replacement security payment needs financial reconciliation before closing");
    if (
      [
        "requires_capture",
        "requires_action",
        "requires_confirmation",
        "requires_payment_method",
      ].includes(hold.status)
    )
      {
        const cancelled = await sb().paymentIntents.cancel(hold.id, {}, { idempotencyKey: `dbc-addition-hold-close-${id}` });
        if (cancelled.status !== "canceled") throw Error("The replacement security authorisation has not been released");
      }
    else if (hold.status !== "canceled") throw Error("The replacement security payment needs financial reconciliation before closing");
  }
  await ctx.runMutation(internal.rentalAdditionState.close, {
    id,
    refunded: paid,
  });
  return { pending: false };
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
  const noPayment=r.membershipCheckoutId&&session.status==="complete"&&session.payment_status==="no_payment_required";
  if (session.id !== r.sessionId || session.payment_status !== "paid"&&!noPayment)
    throw Error("Addition payment has not completed");
  const verifiedPayment = await verifiedUpdatePayment(state, session);
  if (["refunded", "expired"].includes(r.status))
    return { bookingId: r.bookingId, status: r.status, closed: true };
  if (r.withdrawalRequestedAt) {
    const result = await withdraw(ctx, id);
    return { bookingId: r.bookingId, status: result?.pending ? "refund_pending" : "refunded", closed: !result?.pending };
  }
  if (["applied", "applied_draft"].includes(r.status)) {
    if (r.status === "applied") await releaseReplacedHold(ctx, r);
    return { bookingId: r.bookingId, status: b?.depositHoldStatus??"held" };
  }
  if (Date.now() > r.createdAt + 24 * 3600000 && !state.swapProposal?.settlementRefundId) {
    const result = await withdraw(ctx, id);
    return { bookingId: r.bookingId, status: result?.pending ? "refund_pending" : "refunded", closed: !result?.pending };
  }
  const payment = verifiedPayment?.id;
  if (!payment&&!noPayment) throw Error("Paid addition has no card payment");
  if (
    session.amount_total !==
    money(
      (r.draftReplacement ? (r.baseTotal ?? 0) : 0) +
        r.lineTotal +
        r.securityCharge + (r.membershipFee??0),
    )
  )
    throw Error("Addition paid amount does not match the saved order");
  if(payment)await ctx.runMutation(internal.rentalAdditionState.markPaid, {
    id,
    paymentIntentId: payment,
  });
  if (
    !b ||
    b.cancellationDecision ||
    b.returnDecision ||
    !["pending_payment", "confirmed", "active"].includes(b.status)
  ) {
    const result = await withdraw(ctx, id);
    return { bookingId: r.bookingId, status: result?.pending ? "refund_pending" : "refunded", closed: !result?.pending };
  }
  if (r.draftReplacement) {
    const applied = await ctx.runMutation(internal.rentalAdditionState.apply, {
      id,
    });
    if (applied.closed) {
      const result = await withdraw(ctx, id);
      return { bookingId: r.bookingId, status: result?.pending ? "refund_pending" : "refunded", closed: !result?.pending };
    }
    return { bookingId: r.bookingId, status: "draft_applied" };
  }
  if(!payment)throw Error("An item addition requires a saved rental payment.");
  if(b.securityHoldPolicyVersion===PICKUP_HOLD_POLICY&&(pickupHoldAt(b)>Date.now()||canDeferAdditionSecurity(b))){
    if(!canDeferAdditionSecurity(b)||r.holdIntentId||r.securityCreationPending)throw Error("Resolve the existing security authorisation before updating the pickup hold.");
    const result=await ctx.runMutation(internal.rentalAdditionState.apply,{id});
    if(result.needsRefund){
      const settled=await ctx.runAction(internal.checkout.settleCompoundSwap,{id});
      return {bookingId:r.bookingId,status:settled.applied?"scheduled":settled.needsReview?"swap_settlement_review":settled.status==="failed"?"swap_refund_failed":"swap_refund_pending"};
    }
    if(result.closed&&state.swapProposal?.settlementRefundId)return {bookingId:r.bookingId,status:"swap_settlement_review"};
    if(result.closed){const result=await withdraw(ctx,id);return {bookingId:r.bookingId,status:result?.pending?"refund_pending":"refunded",closed:!result?.pending};}
    return {bookingId:r.bookingId,status:"scheduled"};
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
    if (!intent && r.securityCreationPending) intent = await recoverPreparedSecurity(ctx, r);
    if (!intent) {
      const paid = verifiedPayment!;
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
      const params: Stripe.PaymentIntentCreateParams = {
        amount: money(r.holdTotal), currency: "gbp", customer, payment_method: method,
        allowed_payment_method_types: ["card"], capture_method: "manual", confirm: true, off_session: true, expand: ["latest_charge"],
        metadata: { bookingId: r.bookingId, rentalAdditionId: id, purpose: "replacement_rental_security_hold" },
      };
      const prepared: any = await ctx.runMutation(internal.rentalAdditionState.beginSecurityAuthorization, { id, params: JSON.stringify(params) });
      if (prepared.closed) {
        const result = await withdraw(ctx, id);
        return { bookingId: r.bookingId, status: result?.pending ? "refund_pending" : "refunded", closed: !result?.pending };
      }
      const pending: any = await ctx.runQuery(internal.rentalAdditionState.context, { id });
      intent = await recoverPreparedSecurity(ctx, pending.addition);
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
    const result = await withdraw(ctx, id);
    return { bookingId: r.bookingId, status: result?.pending ? "refund_pending" : "refunded", closed: !result?.pending };
  }
  await releaseReplacedHold(ctx, {
    ...r,
    holdIntentId: intent?.id ?? r.holdIntentId,
  });
  return { bookingId: r.bookingId, status: "held" };
}
export const startPaidSwap = action({
  args:{token:v.string(),bookingId:v.id("bookings"),id:v.id("rental_change_requests"),quoteKey:v.string()},
  handler:async(ctx,args):Promise<{url:string;id:string;applied?:boolean}>=>{
    const row:any=await ctx.runMutation(internal.rentalSwaps.preparePaidSwap,args);
    if(row.status==="applied")return {url:"",id:row._id,applied:true};
    if(row.withdrawalRequestedAt)throw Error("Finish withdrawing this swap settlement before agreeing a new request.");
    const session=await ensureSession(ctx,row._id);
    if(session.payment_status==="paid"){
      const result=await finish(ctx,row._id,session);
      const current:any=await ctx.runQuery(internal.rentalAdditionState.context,{id:row._id});
      return {url:"",id:row._id,applied:!result.closed&&current?.addition?.status==="applied"};
    }
    if(!session.url||session.status!=="open")throw Error("This swap payment is no longer open. Review its saved settlement in the rental.");
    return {url:session.url,id:row._id};
  },
});
export const start = action({
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
    if(r&&args.changeRequestId&&r.changeRequestId!==args.changeRequestId)throw Error("This saved proposal belongs to a different customer request");
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
      if (original.status === "complete" && ["paid","no_payment_required"].includes(original.payment_status)) {
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
      if(canDeferAdditionSecurity(state.booking)){
        const result=await ctx.runMutation(internal.rentalAdditionState.apply,{id:r._id});
        if(result.closed)throw Error("This rental can no longer accept the item");
        return {url:"",id:r._id,applied:true};
      }
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
export const closeRefundOnlyByOwner=action({
 args:{token:v.string(),id:v.id('rental_additions'),quoteKey:v.string(),reason:v.string()},
 handler:async(ctx,args)=>{
  const prepared=await ctx.runMutation(internal.rentalAdditionState.prepareRefundOnlyClosure,args);
  if(prepared.closed)return {ok:true,pending:false,closed:true};
  const result=await withdraw(ctx,args.id);
  return {ok:true,pending:!!result?.pending,needsAttention:!!result?.needsAttention,closed:!result?.pending};
 }
});
export const withdrawByOwner = action({
  args: { token: v.string(), id: v.id("rental_additions") },
  handler: async (ctx, { token, id }) => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, {
      token,
      fn: "rentalAdditions.withdraw",
    });
    const result = await withdraw(ctx, id);
    return { ok: true, pending: !!result?.pending, needsAttention: !!result?.needsAttention };
  },
});
/** The hold status alone cannot attest that the equipment change committed. */
async function finishWithReceipt(ctx: any, id: any, session: Stripe.Checkout.Session) {
  const result = await finish(ctx, id, session);
  // finish validates the bound checkout and captured payment before this read.
  const current: any = await ctx.runQuery(internal.rentalAdditionState.context, { id });
  const addition = current?.addition;
  const updateKind: "swap" | "draft" | "addition" = addition?.swapProposalId
    ? "swap" : addition?.draftReplacement ? "draft" : "addition";
  return { ...result, updateKind, updateApplied: !result.closed &&
    !!addition && addition.bookingId === result.bookingId && !addition.withdrawalRequestedAt &&
    ["applied", "applied_draft"].includes(addition.status) };
}
export const finalizePaid = internalAction({
  args: { id: v.id("rental_additions"), sessionId: v.string() },
  handler: async (ctx, { id, sessionId }) =>
    finishWithReceipt(ctx, id, await sb().checkout.sessions.retrieve(sessionId)),
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
    updateApplied: boolean;
    updateKind: "swap" | "draft" | "addition";
  }> => {
    const session = await sb().checkout.sessions.retrieve(sessionId);
    const id = session.metadata?.rentalAdditionId;
    if (!id) throw Error("Not an item addition checkout");
    return finishWithReceipt(ctx, id, session);
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
        if (r.withdrawalRequestedAt) { await withdraw(ctx, r._id); continue; }
        const swapState=r.swapProposalId?await ctx.runQuery(internal.rentalAdditionState.context,{id:r._id}):null;
        if (Date.now() > r.createdAt + 24 * 3600000 && r.sessionId && !swapState?.swapProposal?.settlementRefundId) {
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

/** Owner recovery verifies the saved provider receipt; bank challenges remain renter-only. */
export const resumeByOwner = action({
  args:{token:v.string(),bookingId:v.id("bookings"),id:v.id("rental_additions")},
  handler:async(ctx,{token,bookingId,id}):Promise<{status:string}>=>{
    await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token,fn:"rentalAdditions.resumeByOwner"});
    const state:any=await ctx.runQuery(internal.rentalAdditionState.context,{id});
    if(!state?.addition||!state.booking||state.addition.bookingId!==bookingId||state.booking._id!==bookingId)throw Error("Proposal belongs to another rental");
    const r=state.addition;
    if(["applied","applied_draft","expired","refunded"].includes(r.status))return {status:r.status};
    if(r.withdrawalRequestedAt)throw Error("Check the saved withdrawal before continuing this proposal");
    if(state.booking.activeAdditionId!==id)throw Error("This proposal is no longer active for the rental");
    if(!r.sessionId)throw Error("Resume the saved proposal to prepare its payment link");
    const session=await sb().checkout.sessions.retrieve(r.sessionId);
    if(session.payment_status!=="paid")return {status:"awaiting_payment"};
    if(r.draftReplacement){
      if(session.metadata?.pendingAdditionId!==id)throw Error("Payment receipt does not match this proposal");
      const result=await ctx.runAction(api.checkout.finalize,{sessionId:session.id});
      return {status:result.holdStatus??"pending"};
    }
    const result=await finish(ctx,id,session);
    return {status:result.status};
  },
});

/** Reuse the exact captured-update receipt verifier before releasing rental cash. */
export const attestCompoundPayment=internalAction({args:{id:v.id("rental_additions")},handler:async(ctx,{id})=>{
 const state:any=await ctx.runQuery(internal.rentalAdditionState.context,{id});
 if(!state?.addition?.sessionId||!state.addition.paymentIntentId||state.addition.withdrawalRequestedAt)throw Error("The additional refundable deposit is not ready.");
 const session=await sb().checkout.sessions.retrieve(state.addition.sessionId);
 const customer=typeof session.customer==='string'?session.customer:session.customer?.id;
 if(!state.booking.securityHoldCustomerId||customer!==state.booking.securityHoldCustomerId)throw Error("The additional deposit belongs to another saved-card customer.");
 const payment=await verifiedUpdatePayment(state,session);
 if(!payment||payment.id!==state.addition.paymentIntentId)throw Error("The additional refundable deposit receipt changed.");
 return true;
}});
