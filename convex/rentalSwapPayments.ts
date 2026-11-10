"use node";
import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { recoverApprovedRefund, RefundReviewRequired, type RefundReceipt } from "./lib/approvedRefund";
import { remainingRentalPayment } from "./lib/rentalStripeBalance";
import { rentalRefundPlan } from "./lib/rentalPaymentPlan";
import { swapAuthorityAvailable } from "./lib/rentalSwapAuthority";

function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw Error("Stripe is not configured.");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

async function inspectAmbiguousRefundAttempts(ctx:any, client:Stripe, swap:any, job:any) {
  const ambiguity=job.refundAmbiguity,paymentIntentId=ambiguity?.paymentIntentId;
  const allocation=job.allocations?.find((row:any)=>row.paymentIntentId===paymentIntentId);
  const attempts=(job.refundReceipts??[]).filter((row:any)=>row.paymentIntentId===paymentIntentId).sort((a:any,b:any)=>a.attemptedAt-b.attemptedAt);
  if(!ambiguity||!allocation||!attempts.length)throw Error("The conflicting Stripe receipt history is incomplete.");
  const checked=[];
  for(const attempt of attempts){
    const metadata={rentalRefundId:String(job._id),rentalPaymentIntent:paymentIntentId,bookingId:String(swap.bookingId),...(attempt.attemptKey?{rentalRefundAttempt:attempt.attemptKey}:{})};
    const persist=async(receipt:RefundReceipt)=>ctx.runMutation(internal.rentalOperations.recordRefundReceipt,{id:job._id,receipt});
    const recovered=await recoverApprovedRefund(client,attempt,{currency:"GBP",now:Date.now(),maxRefunds:100,readOnly:true,persist,idempotencyKey:`dbc-swap-refund-${job._id}-${paymentIntentId}${attempt.attemptKey?`-${attempt.attemptKey}`:""}`,metadata});
    let status=recovered.status;
    if(recovered.stripeRefundId){
      const provider=await client.refunds.retrieve(recovered.stripeRefundId);
      const providerPayment=typeof provider.payment_intent==="string"?provider.payment_intent:provider.payment_intent?.id;
      if(provider.id!==recovered.stripeRefundId||providerPayment!==paymentIntentId||provider.amount!==allocation.amountPence||provider.currency!=="gbp"||provider.metadata?.rentalRefundId!==String(job._id)||provider.metadata?.rentalPaymentIntent!==paymentIntentId||provider.metadata?.bookingId!==String(swap.bookingId)||(attempt.attemptKey?provider.metadata?.rentalRefundAttempt!==attempt.attemptKey:!!provider.metadata?.rentalRefundAttempt))throw Error("A Stripe attempt does not match this equipment refund. Keep it locked for review.");
      status=provider.status==="succeeded"?"succeeded":provider.status==="failed"||provider.status==="canceled"?"failed":provider.status==="pending"?"pending":"unknown";
      const current={...recovered,stripeRefundId:provider.id,status:status as RefundReceipt["status"]};
      await persist(current);
      await ctx.runMutation(internal.rentalOperations.recordRefundPart,{id:job._id,paymentIntentId,stripeRefundId:provider.id,status,attemptKey:attempt.attemptKey});
    }
    checked.push({stripeRefundId:recovered.stripeRefundId??null,attemptKey:attempt.attemptKey??null,status});
  }
  const successes=checked.filter((row:any)=>row.status==="succeeded");
  return {paymentIntentId,attempts:checked,canResolve:checked.length===attempts.length&&checked.every((row:any)=>["succeeded","failed"].includes(row.status))&&successes.length===1&&successes[0].stripeRefundId===ambiguity.successfulRefundId&&(successes[0].attemptKey??undefined)===(ambiguity.successfulAttemptKey??undefined),multipleSucceeded:successes.length>1};
}

export const syncFailedRefundReview = action({
  args: { token: v.string(), id: v.id("rental_item_swaps") },
  handler: async (ctx, args): Promise<{
    status: string;
    refunds: Array<{ id: string; amountPence: number; status: string; failureReason?: string; dashboardUrl: string }>;
    readyToResume: boolean;
    newRefundCreated: boolean;
    ambiguity?: {paymentIntentId:string;attempts:Array<{stripeRefundId:string|null;attemptKey:string|null;status:string}>;canResolve:boolean;multipleSucceeded:boolean};
  }> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, {
      token: args.token,
      fn: "rentalSwapPayments.syncFailedRefundReview",
    });
    const context = await ctx.runQuery(internal.rentalSwapState.context, { id: args.id });
    const swap = context?.swap;
    if (!swap || swap.status !== "review" || !swap.refundJobId)
      throw Error("This equipment change has no failed refund to review.");

    const job = await ctx.runQuery(internal.rentalOperations.refundJob, { id: swap.refundJobId });
    if (!job || job.bookingId !== swap.bookingId)
      throw Error("The equipment refund is not linked to this rental.");
    if(job.refundAmbiguity){
      const ambiguity=await inspectAmbiguousRefundAttempts(ctx,stripe(),swap,job);
      const refunds=ambiguity.attempts.filter((row:any)=>row.stripeRefundId).map((row:any)=>({id:row.stripeRefundId,amountPence:job.allocations?.find((allocation:any)=>allocation.paymentIntentId===ambiguity.paymentIntentId)?.amountPence??0,status:row.status,dashboardUrl:`https://dashboard.stripe.com/refunds/${encodeURIComponent(row.stripeRefundId)}`}));
      return {status:"needs_review",refunds,readyToResume:false,newRefundCreated:false,ambiguity};
    }
    const failedParts = job.parts?.filter((part: any) => part.status === "failed") ?? [];
    if (!failedParts.length)
      return { status: job.status, refunds: [], readyToResume: job.status === "succeeded", newRefundCreated: false };

    const client = stripe();
    const refunds: Array<{ id: string; amountPence: number; status: string; failureReason?: string; dashboardUrl: string }> = [];
    for (const part of failedParts) {
      const allocation = job.allocations?.find((row: any) => row.paymentIntentId === part.paymentIntentId);
      if (!allocation || allocation.amountPence !== part.amountPence || !part.stripeRefundId)
        throw Error("The failed Stripe refund allocation needs manual reconciliation.");

      const refund = await client.refunds.retrieve(part.stripeRefundId);
      const paymentIntentId = typeof refund.payment_intent === "string"
        ? refund.payment_intent
        : refund.payment_intent?.id;
      if (
        refund.id !== part.stripeRefundId ||
        paymentIntentId !== part.paymentIntentId ||
        refund.amount !== allocation.amountPence ||
        refund.currency !== "gbp" ||
        refund.metadata?.rentalRefundId !== String(job._id) ||
        refund.metadata?.rentalPaymentIntent !== part.paymentIntentId ||
        refund.metadata?.bookingId !== String(swap.bookingId) ||
        (part.attemptKey ? refund.metadata?.rentalRefundAttempt !== part.attemptKey : !!refund.metadata?.rentalRefundAttempt)
      ) throw Error("The Stripe refund receipt does not match this rental. No settlement was changed.");

      const status = refund.status === "succeeded"
        ? "succeeded"
        : refund.status === "pending"
          ? "pending"
          : refund.status === "failed" || refund.status === "canceled"
            ? "failed"
            : null;
      if (!status) throw Error("Stripe returned an unknown refund status. No settlement was changed.");

      let receipt = job.refundReceipts?.find((row: any) => row.paymentIntentId === part.paymentIntentId && row.attemptKey === part.attemptKey);
      if (!receipt && !part.attemptKey) {
        receipt = { paymentIntentId: part.paymentIntentId, amountPence: allocation.amountPence, attemptedAt: job.createdAt, status: "unknown" };
      }
      if (!receipt) throw Error("The failed refund attempt has no matching recovery receipt.");
      await ctx.runMutation(internal.rentalOperations.recordRefundReceipt, {
        id: job._id,
        receipt: { ...receipt, stripeRefundId: refund.id, status },
      });

      await ctx.runMutation(internal.rentalOperations.recordRefundPart, {
        id: job._id,
        paymentIntentId: part.paymentIntentId,
        stripeRefundId: refund.id,
        status,
        attemptKey: part.attemptKey,
      });
      refunds.push({
        id: refund.id,
        amountPence: refund.amount,
        status,
        failureReason: status === "failed" ? refund.failure_reason ?? undefined : undefined,
        dashboardUrl: `https://dashboard.stripe.com/refunds/${encodeURIComponent(refund.id)}`,
      });
    }

    const refreshed = await ctx.runQuery(internal.rentalOperations.refundJob, { id: job._id });
    return {
      status: refreshed?.status ?? "unknown",
      refunds,
      readyToResume: refreshed?.status === "succeeded",
      newRefundCreated: false,
    };
  },
});

export const resolveRefundAmbiguity=action({args:{token:v.string(),id:v.id("rental_item_swaps"),reason:v.string(),confirmed:v.boolean()},handler:async(ctx,args):Promise<any>=>{
  await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:args.token,fn:"rentalSwapPayments.resolveRefundAmbiguity"});
  const reason=args.reason.trim();if(!args.confirmed||reason.length<5||reason.length>400)throw Error("Confirm the receipt resolution and add a reason between 5 and 400 characters.");
  const context:any=await ctx.runQuery(internal.rentalSwapState.context,{id:args.id}),swap=context?.swap;
  if(!swap||swap.status!=="review"||!swap.refundJobId||swap.quote.deltaPence>=0)throw Error("This equipment change has no unresolved Stripe refund conflict.");
  const job:any=await ctx.runQuery(internal.rentalOperations.refundJob,{id:swap.refundJobId});
  if(!job||job.bookingId!==swap.bookingId||!job.refundAmbiguity)throw Error("The conflicting refund receipts are no longer available.");
  const ambiguity=await inspectAmbiguousRefundAttempts(ctx,stripe(),swap,job);
  if(!ambiguity.canResolve)throw Error(ambiguity.multipleSucceeded?"More than one Stripe refund succeeded. Keep the equipment change locked and resolve the excess refund separately.":"Stripe has not confirmed one successful refund with every other attempt failed. Keep the equipment change locked and sync again later.");
  const result:any=await ctx.runMutation(internal.rentalOperations.resolveSwapRefundAmbiguity,{id:job._id,paymentIntentId:ambiguity.paymentIntentId,attempts:ambiguity.attempts.filter((row:any)=>row.stripeRefundId).map((row:any)=>({stripeRefundId:row.stripeRefundId,status:row.status,...(row.attemptKey?{attemptKey:row.attemptKey}:{})})),reason});
  if(result.status==="succeeded")return finishRefund(ctx,swap);
  return {status:"reconciled",refundStatus:result.status,successfulRefundId:result.successfulRefundId};
}});

export const retryFailedRefund = action({
  args: {
    token: v.string(),
    id: v.id("rental_item_swaps"),
    requestId: v.string(),
    reason: v.string(),
    confirmed: v.boolean(),
  },
  handler: async (ctx, args): Promise<any> => {
    await ctx.runMutation(internal.adminAuth.assertAdminInternal, {
      token: args.token,
      fn: "rentalSwapPayments.retryFailedRefund",
    });
    const reason = args.reason.trim();
    if (!args.confirmed || !/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId) || reason.length < 5 || reason.length > 400)
      throw Error("Confirm the failed refund retry and provide a reason between 5 and 400 characters.");

    const context: any = await ctx.runQuery(internal.rentalSwapState.context, { id: args.id });
    const swap = context?.swap;
    if (!swap?.refundJobId || swap.quote.deltaPence >= 0)
      throw Error("This rental has no equipment-change refund to retry.");
    const job: any = await ctx.runQuery(internal.rentalOperations.refundJob, { id: swap.refundJobId });
    if (!job || job.bookingId !== swap.bookingId || job.expectedAccountId !== swap.accountId || job.amountPence !== -swap.quote.deltaPence)
      throw Error("The equipment refund is not linked to this rental.");

    const previous = job.retryHistory?.find((row: any) => row.requestId === args.requestId);
    if (previous) {
      if (previous.reason !== reason) throw Error("The original refund retry request cannot be changed.");
      if (job.status === "failed") return { status: "needs_review", replayed: true, newRefundCreated: false };
      if (job.status === "succeeded" && swap.status === "applied") return { status: "applied", replayed: true, newRefundCreated: false };
      if (["prepared", "pending", "succeeded"].includes(job.status) && ["refund_pending", "review"].includes(swap.status))
        return finishRefund(ctx, swap);
      throw Error("The original refund retry is no longer resumable.");
    }
    if (swap.status !== "review" || job.status !== "failed")
      throw Error("Sync Stripe first; only a currently failed refund can be retried.");

    const failedParts = (job.parts ?? []).filter((part: any) => part.status === "failed")
      .sort((a: any, b: any) => a.paymentIntentId.localeCompare(b.paymentIntentId));
    if (!failedParts.length || (job.parts ?? []).some((part: any) => part.status === "pending"))
      throw Error("All unresolved refund parts must be checked before retrying.");

    const client = stripe();
    for (const part of failedParts) {
      const allocation = job.allocations?.find((row: any) => row.paymentIntentId === part.paymentIntentId);
      if (!allocation || allocation.amountPence !== part.amountPence || !part.stripeRefundId)
        throw Error("The failed refund allocation needs review.");
      const refund = await client.refunds.retrieve(part.stripeRefundId);
      const paymentIntentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
      if (
        refund.id !== part.stripeRefundId || paymentIntentId !== part.paymentIntentId ||
        refund.amount !== allocation.amountPence || refund.currency !== "gbp" ||
        refund.metadata?.rentalRefundId !== String(job._id) ||
        refund.metadata?.rentalPaymentIntent !== part.paymentIntentId ||
        refund.metadata?.bookingId !== String(swap.bookingId) ||
        (part.attemptKey ? refund.metadata?.rentalRefundAttempt !== part.attemptKey : !!refund.metadata?.rentalRefundAttempt) ||
        !["failed", "canceled"].includes(refund.status ?? "")
      ) throw Error("Stripe no longer confirms this exact refund as failed. Sync its current status before retrying.");
    }

    const started: any = await ctx.runMutation(internal.rentalSwapState.beginRefundRetry, {
      id: swap._id,
      requestId: args.requestId,
      reason,
      failedParts: failedParts.map((part: any) => ({ paymentIntentId: part.paymentIntentId, stripeRefundId: part.stripeRefundId })),
    });
    return finishRefund(ctx, started.swap);
  },
});

function swapDescription(swap:any) {
  const changes=swap.changes?.length?swap.changes:[{oldLine:swap.oldLine,newLine:swap.newLine}];
  return changes.map((change:any)=>change.action==="remove"||!change.newLine
    ? `${change.oldLine.qty} × ${change.oldLine.title} → removed`
    : `${change.oldLine.qty} × ${change.oldLine.title} → ${change.newLine.qty} × ${change.newLine.title}`
  ).join("; ").slice(0,500);
}

async function ensureStock(ctx:any,id:any,authorize=true,allowConverted=false) {
  const stockConflict = () => Object.assign(new Error("The equipment is no longer available for these dates."), { code: "SHARED_STOCK_CAPACITY_CONFLICT" });
  let stockRisk=false;
  const claim=await ctx.runMutation(internal.swapStockOperations.prepareSwapClaim,{swapId:id});
  const acquired=await ctx.runAction(internal.swapStockOperations.recover,{id:claim});
  if(acquired.status==="capacity_conflict")throw stockConflict();
  if(acquired.status!=="confirmed")throw Error("Equipment availability is being reconciled; no new payment has been started.");
  const execution=await ctx.runMutation(internal.swapStockOperations.prepare,{swapId:id,operation:"beginExecution"});
  const begun=await ctx.runAction(internal.swapStockOperations.recover,{id:execution});
  if(begun.status==="capacity_conflict")throw stockConflict();
  if(begun.status!=="confirmed")throw Error("Equipment availability is being reconciled; no new payment has been started.");
  const evidence=await ctx.runQuery(internal.swapStockOperations.read,{id:execution});
  if(!evidence||evidence.state!=="confirmed"||evidence.request?.operation!=="beginExecution")throw Error("Equipment stock execution needs review.");
  const current=await ctx.runAction(internal.sharedStockBridge.send,{request:{operation:"checkExecution",args:evidence.request.args}});
  if(current.status!=="confirmed"){
    if(current.status==="capacity_conflict")throw stockConflict();
    if(!allowConverted)throw Error("Equipment availability changed or needs review before settlement.");
    const receipt=await ctx.runQuery(internal.swapStockOperations.stagedConversionReceipt,{swapId:id});
    const converted=await ctx.runAction(internal.sharedStockBridge.send,{request:{operation:"checkConversion",args:{...evidence.request.args,receipt}}});
    if(converted.status!=="confirmed")throw Error("The staged equipment conversion needs review before refund settlement.");
    if(converted.result.stockRisk){stockRisk=true;try{await ctx.runMutation(internal.rentalSwapState.notifyConvertedStockRisk,{id});}catch{try{await ctx.scheduler.runAfter(0,internal.rentalSwapState.notifyConvertedStockRisk,{id});}catch{console.error("Could not schedule a converted stock-risk notification.");}}}
  }
  if(authorize)return ctx.runMutation(internal.rentalSwapState.authorizeExecution,{id});
  return {stockRisk};
}

async function reserveStock(ctx:any,id:any) {
  const claim=await ctx.runMutation(internal.swapStockOperations.prepareSwapClaim,{swapId:id});
  const acquired=await ctx.runAction(internal.swapStockOperations.recover,{id:claim});
  if(acquired.status==="capacity_conflict")throw Object.assign(new Error("The equipment is no longer available for these dates."),{code:"SHARED_STOCK_CAPACITY_CONFLICT"});
  if(acquired.status!=="confirmed")throw Error("Equipment availability is being reconciled; no new payment link has been started.");
}

function expiredUnpaidEvidence(session:any) {
  if(!session?.id||session.status!=="expired"||session.payment_status!=="unpaid"||!Number.isSafeInteger(session.expires_at)||session.expires_at<=0)throw Error("Stripe has not confirmed that the equipment payment expired unpaid.");
  return {sessionId:session.id,status:"expired" as const,paymentStatus:"unpaid" as const,checkedAt:Date.now(),expiresAt:session.expires_at};
}

async function ensureSession(ctx:any, swap:any) {
  const client = stripe();
  if (swap.sessionId) {
    const session=await client.checkout.sessions.retrieve(swap.sessionId);
    if(session.status==="open")await reserveStock(ctx,swap._id);
    return session;
  }
  if (swap.expiresAt <= Date.now()) {
    let scanned=0;
    for await (const found of client.checkout.sessions.list({created:{gte:Math.floor(swap.acceptedAt/1000)-5},limit:100})) {
      if (++scanned>100) throw Error("The original equipment payment needs receipt review.");
      if (found.metadata?.itemSwapId===swap._id) {
        if(found.currency!=="gbp"||found.amount_total!==swap.quote.deltaPence)throw Error("The original equipment payment session needs review.");
        if(found.status!=="complete"||found.payment_status!=="paid")await ctx.runMutation(internal.rentalSwapState.bindSession,{id:swap._id,sessionId:found.id,url:found.url??""});
        if(found.status==="open")await reserveStock(ctx,swap._id);
        return found;
      }
    }
    throw Error("The original equipment payment session needs review before releasing stock.");
  }
  await reserveStock(ctx,swap._id);
  if (process.env.RENTAL_CHECKOUT_ENABLED !== "true" && !/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "")) throw Error("Rental payments are not enabled.");
  const origin = new URL(process.env.APP_URL ?? "https://dbcinemarentals.com").origin;
  await ctx.runMutation(internal.rentalSwapState.markSessionCreationStarted,{id:swap._id});
  const session = await client.checkout.sessions.create({mode:"payment",adaptive_pricing:{enabled:false},customer_email:swap.acceptedEmail,expires_at:Math.floor(swap.expiresAt/1000),line_items:[{quantity:1,price_data:{currency:"gbp",unit_amount:swap.quote.deltaPence,product_data:{name:"DB Cinema · equipment change",description:swapDescription(swap)}}}],success_url:`${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${origin}/account?rental=${swap.bookingId}#chat`,metadata:{itemSwapId:swap._id},payment_intent_data:{metadata:{itemSwapId:swap._id}}},{idempotencyKey:`dbc-rental-swap-${swap._id}`});
  if(!session.url)throw Error("The equipment payment link is unavailable; retry to recover it.");
  await ctx.runMutation(internal.rentalSwapState.bindSession,{id:swap._id,sessionId:session.id,url:session.url});return session;
}

async function finishPayment(ctx:any, session:Stripe.Checkout.Session) {
  const id=session.metadata?.itemSwapId;if(!id)throw Error("Equipment payment metadata is missing.");
  const context:any=await ctx.runQuery(internal.rentalSwapState.context,{id});if(!context)throw Error("Equipment proposal is missing.");let swap=context.swap;
  if(session.status!=="complete"||session.payment_status!=="paid")return {bookingId:swap.bookingId,paid:false};
  if(swap.sessionId&&session.id!==swap.sessionId||session.currency!=="gbp"||session.amount_total!==swap.quote.deltaPence)throw Error("Equipment payment receipt does not match the accepted quote.");
  const paymentId=typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id;if(!paymentId)throw Error("Equipment payment is missing.");
  const payment=await stripe().paymentIntents.retrieve(paymentId);
  if(payment.status!=="succeeded"||payment.currency!=="gbp"||payment.amount_received!==session.amount_total||payment.metadata.itemSwapId!==id)throw Error("Stripe has not confirmed the equipment payment.");
  if(!swap.sessionId||swap.paymentIntentId!==paymentId){await ctx.runMutation(internal.rentalSwapState.bindSession,{id,sessionId:session.id,url:session.url??"",paymentIntentId:paymentId});swap={...swap,sessionId:session.id,paymentIntentId:paymentId};}
  if(swap.status==="applied")return ctx.runMutation(internal.rentalSwapState.apply,{id,sessionId:session.id,paymentIntentId:paymentId,amountPence:payment.amount_received});
  if(swap.status==="refunded"&&swap.paymentIntentId===paymentId)return {refunded:true};
  if(swap.compensationStartedAt)return compensate(ctx,id);
  try{await ensureStock(ctx,id,false);}catch(error){
    const authorityOffline=!swapAuthorityAvailable();
    if((error as any)?.code==="SHARED_STOCK_CAPACITY_CONFLICT"||authorityOffline){
      const reason=(error as any)?.code==="SHARED_STOCK_CAPACITY_CONFLICT"
        ? "The confirmed stock check found that the requested equipment is no longer available for these dates."
        : "Shared stock authority became unavailable after the accepted payment link was issued.";
      const decision:any=await ctx.runMutation(internal.rentalSwapState.beginCompensation,{id,sessionId:session.id,paymentIntentId:paymentId,amountPence:payment.amount_received,reason});
      if(decision.applied||decision.refunded)return decision;
      return compensate(ctx,id);
    }
    return ctx.runMutation(internal.rentalSwapState.recordPaidStockReview,{id,sessionId:session.id,paymentIntentId:paymentId,amountPence:payment.amount_received});
  }
  try{return await ctx.runMutation(internal.rentalSwapState.apply,{id,sessionId:session.id,paymentIntentId:paymentId,amountPence:payment.amount_received});}
  catch(error){const decision:any=await ctx.runMutation(internal.rentalSwapState.beginCompensation,{id,sessionId:session.id,paymentIntentId:paymentId,amountPence:payment.amount_received,reason:error instanceof Error?error.message:"Equipment application failed"});if(decision.applied||decision.refunded)return decision;return compensate(ctx,id);}
}

async function compensate(ctx:any,id:any) {
  const context:any=await ctx.runQuery(internal.rentalSwapState.context,{id});const swap=context?.swap;
  if(!swap||!swap.compensationStartedAt||!swap.paymentIntentId)throw Error("The compensation decision is unavailable.");
  if(swap.status==="refunded")return {refunded:true};
  const initial:RefundReceipt=swap.compensationReceipt??{paymentIntentId:swap.paymentIntentId,amountPence:swap.quote.deltaPence,attemptedAt:swap.compensationStartedAt,status:"unknown"};
  const persist=async(receipt:RefundReceipt)=>ctx.runMutation(internal.rentalSwapState.recordCompensation,{id,receipt});await persist(initial);
  const receipt=await recoverApprovedRefund(stripe(),initial,{currency:"GBP",now:Date.now(),maxRefunds:100,persist,idempotencyKey:`dbc-swap-compensation-${id}`,metadata:{itemSwapCompensation:id},});await persist(receipt);
  if(receipt.status==="awaiting_approval"){await ctx.runMutation(internal.rentalSwapState.notifyApproval,{id});return {status:"awaiting_review"};}
  if(receipt.status==="failed")throw Error("The equipment payment refund failed and needs review.");
  if(receipt.status!=="succeeded")return {status:"pending"};
  return ctx.runMutation(internal.rentalSwapState.finishCompensation,{id});
}

async function finishRefund(ctx:any, swap:any) {
  const alreadyStaged=!!swap.stockAppliedAt;
  let refundJobId:any;
  let stock:any,readOnly=false;
  try{stock=await ensureStock(ctx,swap._id,!alreadyStaged,alreadyStaged);}
  catch(error){if(!alreadyStaged)throw error;readOnly=true;try{await ctx.runMutation(internal.rentalSwapState.notifyConvertedStockRisk,{id:swap._id});}catch{try{await ctx.scheduler.runAfter(0,internal.rentalSwapState.notifyConvertedStockRisk,{id:swap._id});}catch{console.error("Could not schedule a converted stock-risk notification.");}}}
  if(!alreadyStaged)swap=stock;
  let stockRisk=readOnly||alreadyStaged&&stock?.stockRisk===true;
  let ambiguityReview:()=>Promise<any>;
  const finish=async()=>{
    try{
      if(ambiguityReview&&await ambiguityReview())return {status:"needs_review"};
      if(!alreadyStaged)return await ctx.runMutation(internal.rentalSwapState.apply,{id:swap._id});
      try{const latest=await ensureStock(ctx,swap._id,false,true);stockRisk=stockRisk||latest?.stockRisk===true;}
      catch{stockRisk=true;try{await ctx.runMutation(internal.rentalSwapState.notifyConvertedStockRisk,{id:swap._id});}catch{try{await ctx.scheduler.runAfter(0,internal.rentalSwapState.notifyConvertedStockRisk,{id:swap._id});}catch{console.error("Could not schedule a converted stock-risk notification.");}}}
      if(stockRisk)throw Error("The refunded equipment change is waiting for a clear stock check.");
      return await ctx.runMutation(internal.rentalSwapState.apply,{id:swap._id,...(stockRisk?{stockRisk:true}:{})});
    }catch(error){
      if(swap.quote.deltaPence<0&&refundJobId)return ctx.runMutation(internal.rentalSwapState.recordRefundedChangeReview,{id:swap._id});
      throw error;
    }
  };
  const client=stripe(), job:any=await ctx.runMutation(internal.rentalSwapState.prepareRefund,{id:swap._id});
  refundJobId=job._id;
  ambiguityReview=async()=>{
    const latest:any=await ctx.runQuery(internal.rentalOperations.refundJob,{id:job._id});
    if(!latest?.refundAmbiguity)return null;
    await ctx.runMutation(internal.rentalSwapState.markRefundAmbiguityReview,{id:swap._id,refundJobId:job._id});
    return true;
  };
  if(await ambiguityReview())return {status:"needs_review"};
  if(job.status==="succeeded")return finish();
  if(job.status==="failed")throw Error("The equipment refund failed and needs review.");
  let allocations=job.allocations;
  if(!allocations){
    if(readOnly)return {status:"pending"};
    const sources:any[]=await ctx.runQuery(internal.rentalOperations.paymentSources,{bookingId:swap.bookingId});
    const balances=await Promise.all(sources.map(async(source:any)=>{const payment=await client.paymentIntents.retrieve(source.paymentIntentId);if(payment.status!=="succeeded"||payment.currency!=="gbp"||payment.metadata?.bookingId&&payment.metadata.bookingId!==String(swap.bookingId))throw Error("The original rental payment needs review.");return {...source,availablePence:await remainingRentalPayment(client,payment,source.maxPaidPence)};}));
    allocations=await ctx.runMutation(internal.rentalOperations.bindRefundAllocations,{id:job._id,allocations:rentalRefundPlan(balances,job.amountPence)});
  }
  let pending=false;
  for(const allocation of allocations){
    if(await ambiguityReview())return {status:"needs_review"};
    const original:RefundReceipt|undefined=job.refundReceipts?.filter((row:RefundReceipt)=>row.paymentIntentId===allocation.paymentIntentId).sort((a:RefundReceipt,b:RefundReceipt)=>b.attemptedAt-a.attemptedAt)[0];
    if(readOnly&&!original){pending=true;continue;}
    const initial:RefundReceipt=original??{paymentIntentId:allocation.paymentIntentId,amountPence:allocation.amountPence,attemptedAt:job.createdAt,status:"unknown"};
    const persist=async(receipt:RefundReceipt)=>ctx.runMutation(internal.rentalOperations.recordRefundReceipt,{id:job._id,receipt});await persist(initial);
    const receipt=await recoverApprovedRefund(client,initial,{currency:"GBP",now:Date.now(),maxRefunds:100,persist,readOnly,beforeCreate:async()=>{if(await ambiguityReview())throw new RefundReviewRequired("An earlier Stripe refund succeeded during reconciliation. No new refund was created.");},idempotencyKey:`dbc-swap-refund-${job._id}-${allocation.paymentIntentId}${initial.attemptKey?`-${initial.attemptKey}`:""}`,metadata:{rentalRefundId:String(job._id),rentalPaymentIntent:allocation.paymentIntentId,bookingId:String(swap.bookingId),...(initial.attemptKey?{rentalRefundAttempt:initial.attemptKey}:{})}});await persist(receipt);
    if(receipt.status==="awaiting_approval"){await ctx.runMutation(internal.rentalSwapState.notifyApproval,{id:swap._id});if(readOnly){pending=true;continue;}return {status:"awaiting_review"};}
    if(readOnly&&receipt.status==="unknown"){pending=true;continue;}
    if(!receipt.stripeRefundId)throw Error("The equipment refund receipt needs review.");
    const status=receipt.status==="succeeded"?"succeeded":receipt.status==="failed"?"failed":"pending";
    await ctx.runMutation(internal.rentalOperations.recordRefundPart,{id:job._id,paymentIntentId:allocation.paymentIntentId,stripeRefundId:receipt.stripeRefundId,status,attemptKey:receipt.attemptKey});
    if(await ambiguityReview())return {status:"needs_review"};
    if(status==="failed"){
      await ctx.runMutation(internal.rentalSwapState.markRefundFailureReview,{id:swap._id,refundJobId:job._id,paymentIntentId:allocation.paymentIntentId,stripeRefundId:receipt.stripeRefundId});
      return {status:"needs_review"};
    }
    if(status!=="succeeded"){if(readOnly&&status==="pending"){pending=true;continue;}return {status};}
  }
  if(pending)return {status:"pending"};
  return finish();
}

export const accept=action({args:{token:v.string(),id:v.id("rental_item_swaps"),expectedDeltaPence:v.number()},handler:async(ctx,args):Promise<any>=>{
  const swap:any=await ctx.runMutation(internal.rentalSwapState.accept,args);
  if(swap.status==="applied")return {applied:true};
  if(swap.quote.deltaPence===0){await ensureStock(ctx,swap._id);return ctx.runMutation(internal.rentalSwapState.apply,{id:swap._id});}
  if(swap.quote.deltaPence<0)return finishRefund(ctx,swap);
  const session:any=await ensureSession(ctx,swap);if(session.status==="complete")return finishPayment(ctx,session);return {url:session.url};
}});
export const finalize=internalAction({args:{sessionId:v.string()},handler:async(ctx,{sessionId}):Promise<any>=>{
  const session=await stripe().checkout.sessions.retrieve(sessionId);
  const result:any=await finishPayment(ctx,session);
  const context:any=await ctx.runQuery(internal.rentalSwapState.context,{id:session.metadata?.itemSwapId as any});
  if(!context||context.swap.sessionId&&context.swap.sessionId!==session.id)throw Error("The equipment payment is not linked to this rental.");
  return {...result,bookingId:String(context.swap.bookingId),paid:session.status==="complete"&&session.payment_status==="paid",swapStatus:result.applied&&context.booking?.activeItemSwapId!==context.swap._id?"applied":result.refunded?"refunded":"pending"};
}});
export const refundPaidReview=action({args:{token:v.string(),id:v.id("rental_item_swaps"),confirmed:v.boolean(),reason:v.string()},handler:async(ctx,args):Promise<any>=>{
  await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:args.token,fn:"rentalSwapPayments.refundPaidReview"});
  const reason=args.reason.trim();if(!args.confirmed||reason.length<5||reason.length>400)throw Error("Confirm the refund and provide a reason between 5 and 400 characters.");
  const context:any=await ctx.runQuery(internal.rentalSwapState.context,{id:args.id});const swap=context?.swap;
  if(!swap||!swap.paymentIntentId||!swap.sessionId||swap.quote.deltaPence<=0)throw Error("A recorded paid equipment change is required.");
  if(swap.status==="refunded")return {refunded:true,already:true};
  const client=stripe(),session=await client.checkout.sessions.retrieve(swap.sessionId),paymentId=typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id;
  if(session.id!==swap.sessionId||session.status!=="complete"||session.payment_status!=="paid"||session.currency!=="gbp"||session.amount_total!==swap.quote.deltaPence||session.metadata?.itemSwapId!==String(swap._id)||!paymentId||paymentId!==swap.paymentIntentId)throw Error("The original equipment checkout needs review before refunding.");
  const payment=await client.paymentIntents.retrieve(paymentId);
  if(payment.id!==swap.paymentIntentId||payment.status!=="succeeded"||payment.currency!=="gbp"||payment.amount_received!==swap.quote.deltaPence||payment.metadata?.itemSwapId!==String(swap._id))throw Error("The original equipment payment needs review before refunding.");
  const decision:any=await ctx.runMutation(internal.rentalSwapState.beginReviewedCompensation,{id:args.id,sessionId:session.id,paymentIntentId:payment.id,amountPence:payment.amount_received,reason});
  if(decision.refunded)return decision;
  return compensate(ctx,args.id);
}});
export const resumeReview=action({args:{token:v.string(),id:v.id("rental_item_swaps"),confirmed:v.boolean()},handler:async(ctx,args):Promise<any>=>{await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:args.token,fn:"rentalSwapPayments.resumeReview"});if(!args.confirmed)throw Error("Confirm resuming the original equipment settlement first.");const swap:any=await ctx.runMutation(internal.rentalSwapState.resumeReview,{id:args.id});if(swap.status==="awaiting_acceptance")return {status:"awaiting_acceptance"};if(swap.compensationStartedAt)return compensate(ctx,swap._id);if(swap.quote.deltaPence<0)return finishRefund(ctx,swap);if(swap.quote.deltaPence===0){await ensureStock(ctx,swap._id);return ctx.runMutation(internal.rentalSwapState.apply,{id:swap._id});}const session:any=await ensureSession(ctx,swap);return session.status==="complete"?finishPayment(ctx,session):{url:session.url};}});
export const checkRefundApproval=action({args:{token:v.string(),id:v.id("rental_item_swaps")},handler:async(ctx,args):Promise<any>=>{
  await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:args.token,fn:"rentalSwapPayments.checkRefundApproval"});
  const context:any=await ctx.runQuery(internal.rentalSwapState.context,{id:args.id}),swap=context?.swap;
  if(!swap)throw Error("Equipment proposal is missing.");
  if(swap.status==="refund_pending"&&swap.quote.deltaPence<0&&swap.acceptedAt&&swap.refundJobId){
    const job:any=await ctx.runQuery(internal.rentalOperations.refundJob,{id:swap.refundJobId});
    const pendingApproval=job?.bookingId===swap.bookingId&&job.refundReceipts?.some((receipt:RefundReceipt)=>receipt.status==="awaiting_approval"&&!!receipt.approvalRequestId);
    if(!pendingApproval)throw Error("This equipment refund has no pending Stripe approval to check.");
    return finishRefund(ctx,swap);
  }
  if(swap.status==="refund_compensating"&&swap.compensationStartedAt&&swap.compensationReceipt?.status==="awaiting_approval"&&swap.compensationReceipt.approvalRequestId)
    return compensate(ctx,swap._id);
  throw Error("This equipment change is not awaiting a Stripe refund approval.");
}});
export const withdraw=action({args:{token:v.string(),id:v.id("rental_item_swaps")},handler:async(ctx,args):Promise<any>=>{await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:args.token,fn:"rentalSwapPayments.withdraw"});const context:any=await ctx.runQuery(internal.rentalSwapState.context,{id:args.id});if(!context)throw Error("Equipment proposal missing.");const swap=context.swap;if(swap.refundJobId||swap.paymentIntentId)throw Error("The existing equipment settlement needs review before withdrawal.");let expiredSessionEvidence:any;if(swap.quote.deltaPence>0&&swap.acceptedAt){if(!swap.sessionId)throw Error("The original equipment payment needs review before withdrawal.");let session:any=await ensureSession(ctx,swap);if(session.status==="complete"){if(session.payment_status!=="paid")throw Error("The equipment payment is processing; wait for its result.");return finishPayment(ctx,session);}if(session.status==="open")session=await stripe().checkout.sessions.expire(session.id);if(session.status!=="expired")throw Error("The equipment payment needs review before withdrawal.");expiredSessionEvidence=expiredUnpaidEvidence(session);}await ctx.runMutation(internal.rentalSwapState.close,{id:swap._id,status:"withdrawn",expiredSessionEvidence});return {withdrawn:true};}});
export const closeAcceptedWithoutPayment=action({args:{token:v.string(),id:v.id("rental_item_swaps"),confirmed:v.boolean()},handler:async(ctx,args):Promise<any>=>{
  await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:args.token,fn:"rentalSwapPayments.closeAcceptedWithoutPayment"});
  if(!args.confirmed)throw Error("Confirm closing this accepted change without payment.");
  return await ctx.runMutation(internal.rentalSwapState.closeAcceptedWithoutPayment,{id:args.id});
}});
export const reconcile=internalAction({args:{},handler:async(ctx):Promise<void>=>{
  const rows:any[]=await ctx.runQuery(internal.rentalSwapState.pending,{});
  for(const swap of rows){
    const snapshot={id:swap._id,expectedStatus:swap.status,expectedDue:swap.reconcileAfter};
    try{
      if(swap.status==="awaiting_acceptance"){
        if(swap.expiresAt<=Date.now())await ctx.runMutation(internal.rentalSwapState.close,{id:swap._id,status:"expired"});
      }else if(swap.compensationStartedAt)await compensate(ctx,swap._id);
      else if(swap.quote.deltaPence<0)await finishRefund(ctx,swap);
      else if(swap.quote.deltaPence===0){await ensureStock(ctx,swap._id);await ctx.runMutation(internal.rentalSwapState.apply,{id:swap._id});}
      else {
        const session:any=await ensureSession(ctx,swap);
        if(session.status==="complete")await finishPayment(ctx,session);
        else if(session.status==="expired")await ctx.runMutation(internal.rentalSwapState.close,{id:swap._id,status:"expired",expiredSessionEvidence:expiredUnpaidEvidence(session)});
      }
      if(swap.status==="review"){
        const latest:any=await ctx.runQuery(internal.rentalSwapState.context,{id:swap._id});
        if(latest?.swap.status==="review"&&latest.swap.reconcileAfter===snapshot.expectedDue)
          await ctx.runMutation(internal.rentalSwapState.reconcileResult,{...snapshot,error:"The stock confirmation is still pending."});
        else await ctx.runMutation(internal.rentalSwapState.reconcileResult,snapshot);
      }else await ctx.runMutation(internal.rentalSwapState.reconcileResult,snapshot);
    }catch(error){
      await ctx.runMutation(internal.rentalSwapState.reconcileResult,{...snapshot,error:error instanceof Error?error.message:"Equipment settlement needs review"});
    }
  }
}});

/** Finish an already-confirmed downgrade refund as soon as its Stripe webhook
 * settles, rather than waiting for the five-minute recovery sweep. The swap
 * and refund are re-read here so stale or partial webhook work cannot apply it. */
export const reconcileRefundWebhook=internalAction({args:{id:v.id("rental_item_swaps")},handler:async(ctx,{id}):Promise<any>=>{
  const context:any=await ctx.runQuery(internal.rentalSwapState.context,{id});
  const swap=context?.swap;
  if(!swap||swap.status!=="refund_pending"||!swap.refundJobId)return {ignored:true};
  const job:any=await ctx.runQuery(internal.rentalOperations.refundJob,{id:swap.refundJobId});
  if(!job||job.status!=="succeeded"||job.refundAmbiguity)return {ignored:true};
  return finishRefund(ctx,swap);
}});
