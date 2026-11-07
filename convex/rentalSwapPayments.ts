"use node";
import Stripe from "stripe";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { recoverApprovedRefund, type RefundReceipt } from "./lib/approvedRefund";
import { remainingRentalPayment } from "./lib/rentalStripeBalance";
import { rentalRefundPlan } from "./lib/rentalPaymentPlan";
import { assertSwapAuthorityAvailable } from "./lib/rentalSwapAuthority";

function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw Error("Stripe is not configured.");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function swapDescription(swap:any) {
  const changes=swap.changes?.length?swap.changes:[{oldLine:swap.oldLine,newLine:swap.newLine}];
  return changes.map((change:any)=>`${change.oldLine.qty} × ${change.oldLine.title} → ${change.newLine.title}`).join("; ").slice(0,500);
}

async function ensureStock(ctx:any,id:any,authorize=true,allowConverted=false) {
  let stockRisk=false;
  const claim=await ctx.runMutation(internal.swapStockOperations.prepareSwapClaim,{swapId:id});
  const acquired=await ctx.runAction(internal.swapStockOperations.recover,{id:claim});
  if(acquired.status!=="confirmed")throw Error("Equipment availability is being reconciled; no new payment has been started.");
  const execution=await ctx.runMutation(internal.swapStockOperations.prepare,{swapId:id,operation:"beginExecution"});
  const begun=await ctx.runAction(internal.swapStockOperations.recover,{id:execution});
  if(begun.status!=="confirmed")throw Error("Equipment availability is being reconciled; no new payment has been started.");
  const evidence=await ctx.runQuery(internal.swapStockOperations.read,{id:execution});
  if(!evidence||evidence.state!=="confirmed"||evidence.request?.operation!=="beginExecution")throw Error("Equipment stock execution needs review.");
  const current=await ctx.runAction(internal.sharedStockBridge.send,{request:{operation:"checkExecution",args:evidence.request.args}});
  if(current.status!=="confirmed"){
    if(!allowConverted)throw Error("Equipment availability changed or needs review before settlement.");
    const receipt=await ctx.runQuery(internal.swapStockOperations.stagedConversionReceipt,{swapId:id});
    const converted=await ctx.runAction(internal.sharedStockBridge.send,{request:{operation:"checkConversion",args:{...evidence.request.args,receipt}}});
    if(converted.status!=="confirmed")throw Error("The staged equipment conversion needs review before refund settlement.");
    if(converted.result.stockRisk){stockRisk=true;try{await ctx.runMutation(internal.rentalSwapState.notifyConvertedStockRisk,{id});}catch{try{await ctx.scheduler.runAfter(0,internal.rentalSwapState.notifyConvertedStockRisk,{id});}catch{console.error("Could not schedule a converted stock-risk notification.");}}}
  }
  if(authorize)return ctx.runMutation(internal.rentalSwapState.authorizeExecution,{id});
  return {stockRisk};
}

async function ensureSession(ctx:any, swap:any) {
  const client = stripe();
  if (swap.sessionId) {
    const session=await client.checkout.sessions.retrieve(swap.sessionId);
    if(session.status==="open")await ensureStock(ctx,swap._id);
    return session;
  }
  if (swap.expiresAt <= Date.now()) {
    let scanned=0;
    for await (const found of client.checkout.sessions.list({created:{gte:Math.floor(swap.acceptedAt/1000)-5},limit:100})) {
      if (++scanned>100) throw Error("The original equipment payment needs receipt review.");
      if (found.metadata?.itemSwapId===swap._id) {
        if(found.currency!=="gbp"||found.amount_total!==swap.quote.deltaPence)throw Error("The original equipment payment session needs review.");
        await ctx.runMutation(internal.rentalSwapState.bindSession,{id:swap._id,sessionId:found.id,url:found.url??""});
        if(found.status==="open")await ensureStock(ctx,swap._id);
        return found;
      }
    }
    throw Error("The original equipment payment session needs review before releasing stock.");
  }
  swap=await ensureStock(ctx,swap._id);
  if (process.env.RENTAL_CHECKOUT_ENABLED !== "true" && !/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "")) throw Error("Rental payments are not enabled.");
  const origin = new URL(process.env.APP_URL ?? "https://dbcinemarentals.com").origin;
  const session = await client.checkout.sessions.create({mode:"payment",adaptive_pricing:{enabled:false},customer_email:swap.acceptedEmail,expires_at:Math.floor(swap.expiresAt/1000),line_items:[{quantity:1,price_data:{currency:"gbp",unit_amount:swap.quote.deltaPence,product_data:{name:"DB Cinema · equipment change",description:swapDescription(swap)}}}],success_url:`${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${origin}/account?rental=${swap.bookingId}#chat`,metadata:{itemSwapId:swap._id},payment_intent_data:{metadata:{itemSwapId:swap._id}}},{idempotencyKey:`dbc-rental-swap-${swap._id}`});
  if(!session.url)throw Error("The equipment payment link is unavailable; retry to recover it.");
  await ctx.runMutation(internal.rentalSwapState.bindSession,{id:swap._id,sessionId:session.id,url:session.url});return session;
}

async function finishPayment(ctx:any, session:Stripe.Checkout.Session) {
  const id=session.metadata?.itemSwapId;if(!id)throw Error("Equipment payment metadata is missing.");
  const context:any=await ctx.runQuery(internal.rentalSwapState.context,{id});if(!context)throw Error("Equipment proposal is missing.");let swap=context.swap;
  if(session.status!=="complete"||session.payment_status!=="paid")return {bookingId:swap.bookingId,paid:false};
  if(!swap.sessionId&&swap.acceptedAt&&session.currency==="gbp"&&session.amount_total===swap.quote.deltaPence){await ctx.runMutation(internal.rentalSwapState.bindSession,{id,sessionId:session.id,url:session.url??""});swap={...swap,sessionId:session.id};}
  if(session.id!==swap.sessionId||session.currency!=="gbp"||session.amount_total!==swap.quote.deltaPence)throw Error("Equipment payment receipt does not match the accepted quote.");
  const paymentId=typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id;if(!paymentId)throw Error("Equipment payment is missing.");
  const payment=await stripe().paymentIntents.retrieve(paymentId);
  if(payment.status!=="succeeded"||payment.currency!=="gbp"||payment.amount_received!==session.amount_total||payment.metadata.itemSwapId!==id)throw Error("Stripe has not confirmed the equipment payment.");
  if(swap.status==="applied")return ctx.runMutation(internal.rentalSwapState.apply,{id,sessionId:session.id,paymentIntentId:paymentId,amountPence:payment.amount_received});
  if(swap.status==="refunded"&&swap.paymentIntentId===paymentId)return {refunded:true};
  if(swap.compensationStartedAt)return compensate(ctx,id);
  try{await ensureStock(ctx,id,false);}catch{return ctx.runMutation(internal.rentalSwapState.recordPaidStockReview,{id,sessionId:session.id,paymentIntentId:paymentId,amountPence:payment.amount_received});}
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
  let stock:any,readOnly=false;
  try{stock=await ensureStock(ctx,swap._id,!alreadyStaged,alreadyStaged);}
  catch(error){if(!alreadyStaged)throw error;readOnly=true;try{await ctx.runMutation(internal.rentalSwapState.notifyConvertedStockRisk,{id:swap._id});}catch{try{await ctx.scheduler.runAfter(0,internal.rentalSwapState.notifyConvertedStockRisk,{id:swap._id});}catch{console.error("Could not schedule a converted stock-risk notification.");}}}
  if(!alreadyStaged)swap=stock;
  let stockRisk=readOnly||alreadyStaged&&stock?.stockRisk===true;
  const finish=async()=>{
    try{const latest=await ensureStock(ctx,swap._id,false,true);stockRisk=stockRisk||latest?.stockRisk===true;}
    catch{stockRisk=true;try{await ctx.runMutation(internal.rentalSwapState.notifyConvertedStockRisk,{id:swap._id});}catch{try{await ctx.scheduler.runAfter(0,internal.rentalSwapState.notifyConvertedStockRisk,{id:swap._id});}catch{console.error("Could not schedule a converted stock-risk notification.");}}}
    return ctx.runMutation(internal.rentalSwapState.apply,{id:swap._id,...(stockRisk?{stockRisk:true}:{})});
  };
  const client=stripe(), job:any=await ctx.runMutation(internal.rentalSwapState.prepareRefund,{id:swap._id});
  if(job.status==="succeeded")return finish();
  if(job.status==="failed")throw Error("The equipment refund failed and needs review.");
  await ctx.runMutation(internal.rentalSwapState.apply,{id:swap._id,stageRefund:true});
  let allocations=job.allocations;
  if(!allocations){
    if(readOnly)return {status:"pending"};
    const sources:any[]=await ctx.runQuery(internal.rentalOperations.paymentSources,{bookingId:swap.bookingId});
    const balances=await Promise.all(sources.map(async(source:any)=>{const payment=await client.paymentIntents.retrieve(source.paymentIntentId);if(payment.status!=="succeeded"||payment.currency!=="gbp"||payment.metadata?.bookingId&&payment.metadata.bookingId!==String(swap.bookingId))throw Error("The original rental payment needs review.");return {...source,availablePence:await remainingRentalPayment(client,payment,source.maxPaidPence)};}));
    allocations=await ctx.runMutation(internal.rentalOperations.bindRefundAllocations,{id:job._id,allocations:rentalRefundPlan(balances,job.amountPence)});
  }
  let pending=false;
  for(const allocation of allocations){
    const original:RefundReceipt|undefined=job.refundReceipts?.find((row:RefundReceipt)=>row.paymentIntentId===allocation.paymentIntentId);
    if(readOnly&&!original){pending=true;continue;}
    const initial:RefundReceipt=original??{paymentIntentId:allocation.paymentIntentId,amountPence:allocation.amountPence,attemptedAt:job.createdAt,status:"unknown"};
    const persist=async(receipt:RefundReceipt)=>ctx.runMutation(internal.rentalOperations.recordRefundReceipt,{id:job._id,receipt});await persist(initial);
    const receipt=await recoverApprovedRefund(client,initial,{currency:"GBP",now:Date.now(),maxRefunds:100,persist,readOnly,idempotencyKey:`dbc-swap-refund-${job._id}-${allocation.paymentIntentId}`,metadata:{rentalRefundId:job._id,rentalPaymentIntent:allocation.paymentIntentId,bookingId:swap.bookingId}});await persist(receipt);
    if(receipt.status==="awaiting_approval"){await ctx.runMutation(internal.rentalSwapState.notifyApproval,{id:swap._id});if(readOnly){pending=true;continue;}return {status:"awaiting_review"};}
    if(readOnly&&receipt.status==="unknown"){pending=true;continue;}
    if(!receipt.stripeRefundId)throw Error("The equipment refund receipt needs review.");
    const status=receipt.status==="succeeded"?"succeeded":receipt.status==="failed"?"failed":"pending";
    await ctx.runMutation(internal.rentalOperations.recordRefundPart,{id:job._id,paymentIntentId:allocation.paymentIntentId,stripeRefundId:receipt.stripeRefundId,status});
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
  if(process.env.RENTAL_ITEM_SWAP_ENABLED!=="true")throw Error("Equipment settlement is unavailable.");
  assertSwapAuthorityAvailable();
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
export const withdraw=action({args:{token:v.string(),id:v.id("rental_item_swaps")},handler:async(ctx,args):Promise<any>=>{await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:args.token,fn:"rentalSwapPayments.withdraw"});const context:any=await ctx.runQuery(internal.rentalSwapState.context,{id:args.id});if(!context)throw Error("Equipment proposal missing.");const swap=context.swap;if(swap.refundJobId||swap.paymentIntentId)throw Error("The existing equipment settlement needs review before withdrawal.");let expiredSessionId:string|undefined;if(swap.quote.deltaPence>0&&swap.acceptedAt){if(!swap.sessionId)throw Error("The original equipment payment needs review before withdrawal.");let session:any=await ensureSession(ctx,swap);if(session.status==="complete"){if(session.payment_status!=="paid")throw Error("The equipment payment is processing; wait for its result.");return finishPayment(ctx,session);}if(session.status==="open")session=await stripe().checkout.sessions.expire(session.id);if(session.status!=="expired")throw Error("The equipment payment needs review before withdrawal.");expiredSessionId=session.id;}await ctx.runMutation(internal.rentalSwapState.close,{id:swap._id,status:"withdrawn",expiredSessionId});return {withdrawn:true};}});
export const reconcile=internalAction({args:{},handler:async(ctx):Promise<void>=>{const rows:any[]=await ctx.runQuery(internal.rentalSwapState.pending,{});for(const swap of rows){const snapshot={id:swap._id,expectedStatus:swap.status,expectedDue:swap.reconcileAfter};try{if(swap.status==="awaiting_acceptance"){if(swap.expiresAt<=Date.now())await ctx.runMutation(internal.rentalSwapState.close,{id:swap._id,status:"expired"});}else if(swap.compensationStartedAt)await compensate(ctx,swap._id);else if(swap.quote.deltaPence<0)await finishRefund(ctx,swap);else if(swap.quote.deltaPence===0){await ensureStock(ctx,swap._id);await ctx.runMutation(internal.rentalSwapState.apply,{id:swap._id});}else {const session:any=await ensureSession(ctx,swap);if(session.status==="complete")await finishPayment(ctx,session);else if(session.status==="expired")await ctx.runMutation(internal.rentalSwapState.close,{id:swap._id,status:"expired",expiredSessionId:session.id});}await ctx.runMutation(internal.rentalSwapState.reconcileResult,snapshot);}catch(error){await ctx.runMutation(internal.rentalSwapState.reconcileResult,{...snapshot,error:error instanceof Error?error.message:"Equipment settlement needs review"});}}}});
