"use node";

import Stripe from "stripe";
import { pickupHoldEligible } from "../shared/pickupSecurity";
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

/** Initial security authorisation for NEW pickup-policy rentals. Legacy holds use the existing renewal flow. */
async function reconcilePickup(ctx:any,b:any,intent:Stripe.PaymentIntent,sb:Stripe) {
  const expiresAt=captureBefore(intent);
  const valid=intent.status==="requires_capture"&&intent.capture_method==="manual"&&intent.currency==="gbp"&&intent.amount===Math.round(b.depositHoldAmount*100)&&Number.isFinite(expiresAt)&&expiresAt!>Date.now();
  const status=valid?"held":intent.status==="requires_action"?"requires_action":"failed";
  if(intent.status==="requires_capture"&&!valid)await sb.paymentIntents.cancel(intent.id,{}, {idempotencyKey:`dbc-pickup-invalid-${intent.id}`});
  const applied=await ctx.runMutation(internal.pickupSecurity.result,{bookingId:b._id,generation:b.securityHoldGeneration,intentId:intent.id,status,expiresAt:valid?expiresAt:undefined,failureCode:status==="failed"?"authorisation_failed":undefined});
  if(!applied&&["requires_capture","requires_action","requires_payment_method","requires_confirmation"].includes(intent.status))await sb.paymentIntents.cancel(intent.id,{}, {idempotencyKey:`dbc-pickup-stale-${intent.id}`});
  return applied?status:"stale";
}
export const authorizePickup = internalAction({args:{bookingId:v.id("bookings"),generation:v.number()},handler:async(ctx,a)=>{
 if(!await ctx.runMutation(internal.pickupSecurity.claim,a))return;
 const b:any=await ctx.runQuery(internal.pickupSecurity.context,{bookingId:a.bookingId});if(!b)return;
 const sb=stripe();let intent:Stripe.PaymentIntent;
 try {
  if(b.stripeDepositIntentId)intent=await sb.paymentIntents.retrieve(b.stripeDepositIntentId,{expand:["latest_charge"]});
  else try {intent=await sb.paymentIntents.create({amount:Math.round(b.depositHoldAmount*100),currency:"gbp",customer:b.securityHoldCustomerId,payment_method:b.securityHoldPaymentMethodId,allowed_payment_method_types:["card"],capture_method:"manual",confirm:true,off_session:true,...(process.env.STRIPE_EXTENDED_AUTH_ENABLED==="true"?{payment_method_options:{card:{request_extended_authorization:"if_available" as const}}}:{}),metadata:{bookingId:a.bookingId,purpose:"pickup_security_hold",generation:String(a.generation)},expand:["latest_charge"]},{idempotencyKey:`dbc-pickup-hold-${a.bookingId}-${a.generation}`});}
  catch(e:any){const id=e?.raw?.payment_intent?.id??e?.payment_intent?.id;if(!id)throw e;intent=await sb.paymentIntents.retrieve(id,{expand:["latest_charge"]});}
  const status=await reconcilePickup(ctx,b,intent,sb);
  if(["requires_action","failed"].includes(status))await notify(b.guestEmail??null,"Your rental card hold needs attention",`<p>Your agreed £${b.depositHoldAmount} card authorisation at pickup ${status==="requires_action"?"needs bank authentication":"could not be authorised"}. No security hold has been charged. <a href="${process.env.APP_URL??"https://dbcinemarentals.com"}/account">Open your rental account</a> to authenticate or update your saved card. Equipment cannot be collected until the hold and required checks are complete.</p>`).catch(console.error);
 }catch(e:any){const transient=["StripeConnectionError","StripeAPIError","StripeRateLimitError"].includes(e?.type);await ctx.runMutation(internal.pickupSecurity.result,{...a,status:"failed",failureCode:transient?"provider_unavailable":"authorisation_failed",retry:transient});if(!transient||(b.securityHoldAttempts??0)>=3)await notify(b.guestEmail??null,"Your rental card hold needs attention",`<p>The card authorisation for pickup could not be completed. <a href="${process.env.APP_URL??"https://dbcinemarentals.com"}/account">Open your rental account</a> to update your saved card. Equipment cannot be collected until security is complete.</p>`).catch(console.error);}
}});
export const pickupsDue = internalAction({args:{},handler:async(ctx)=>{const rows:any[]=await ctx.runQuery(internal.pickupSecurity.due,{});for(const row of rows){const b:any=await ctx.runQuery(internal.pickupSecurity.context,{bookingId:row.bookingId});if(b?.securityHoldPaymentMethodId)await ctx.runAction(internal.holdRenewal.authorizePickup,row);else await ctx.runAction(internal.checkout.preparePickupSecurity,{bookingId:row.bookingId});}}});

async function ownPickup(ctx:any,token:string,bookingId:any){const account:any=await ctx.runQuery(api.accounts.me,{token}),b:any=await ctx.runQuery(internal.pickupSecurity.context,{bookingId});if(!account||!b||!pickupHoldEligible(b)||(b.accountId?b.accountId!==account._id:account.email?.trim().toLowerCase()!==b.guestEmail?.trim().toLowerCase()))throw Error("Booking access denied");return b;}
export const resumePickup = action({args:{token:v.string(),bookingId:v.id("bookings")},handler:async(ctx,a)=>{const b=await ownPickup(ctx,a.token,a.bookingId);if(b.depositHoldStatus!=="requires_action"||!b.stripeDepositIntentId)return {status:b.depositHoldStatus,clientSecret:null};const intent=await stripe().paymentIntents.retrieve(b.stripeDepositIntentId);return {status:intent.status,clientSecret:intent.status==="requires_action"?intent.client_secret:null};}});
export const syncPickup = action({args:{token:v.string(),bookingId:v.id("bookings")},handler:async(ctx,a):Promise<{status:string}>=>{const b=await ownPickup(ctx,a.token,a.bookingId);if(!b.stripeDepositIntentId)return {status:b.depositHoldStatus??"none"};const sb=stripe(),intent=await sb.paymentIntents.retrieve(b.stripeDepositIntentId,{expand:["latest_charge"]});return {status:await reconcilePickup(ctx,b,intent,sb)};}});
export const updatePickupCard = action({args:{token:v.string(),bookingId:v.id("bookings")},handler:async(ctx,a):Promise<{url:string}>=>{const b=await ownPickup(ctx,a.token,a.bookingId);if(!pickupHoldEligible(b)||!["failed","requires_action"].includes(b.depositHoldStatus??""))throw Error("This rental does not need a replacement card.");if(!b.securityHoldCustomerId)throw Error("Your saved rental card account is temporarily unavailable. Please contact us.");const sb=stripe();if(b.stripeDepositIntentId){const old=await sb.paymentIntents.retrieve(b.stripeDepositIntentId);if(old.status==="requires_capture")throw Error("A security hold is already authorised. Refresh your rental.");if(["requires_action","requires_payment_method","requires_confirmation"].includes(old.status))await sb.paymentIntents.cancel(old.id,{}, {idempotencyKey:`dbc-pickup-recovery-cancel-${old.id}`});}
 const session=await sb.checkout.sessions.create({mode:"setup",currency:"gbp",customer:b.securityHoldCustomerId,payment_method_configuration:process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION_ID,setup_intent_data:{metadata:{bookingId:a.bookingId,purpose:"pickup_card_recovery"}},metadata:{pickupCardBookingId:a.bookingId},success_url:`${new URL(process.env.APP_URL!).origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${new URL(process.env.APP_URL!).origin}/account`});if(!session.url)throw Error("Card setup could not start.");await ctx.runMutation(internal.pickupSecurity.bindRecovery,{bookingId:a.bookingId,sessionId:session.id});return {url:session.url};}});
export const reconcilePickupWebhook = internalAction({args:{bookingId:v.id("bookings"),intentId:v.string()},handler:async(ctx,a)=>{const b:any=await ctx.runQuery(internal.pickupSecurity.context,{bookingId:a.bookingId});const sb=stripe(),intent=await sb.paymentIntents.retrieve(a.intentId,{expand:["latest_charge"]});if(!b||intent.metadata?.bookingId!==a.bookingId||intent.metadata?.purpose!=="pickup_security_hold")return;if(Number(intent.metadata.generation)!==b.securityHoldGeneration){if(["requires_capture","requires_action","requires_payment_method","requires_confirmation"].includes(intent.status))await sb.paymentIntents.cancel(intent.id,{}, {idempotencyKey:`dbc-pickup-stale-${intent.id}`});return;}await reconcilePickup(ctx,b,intent,sb);}});
