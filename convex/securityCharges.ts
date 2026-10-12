"use node";
import Stripe from 'stripe';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { sendMail } from './lib/mailer';
import { SECURITY_COLLECTION_DAYS, SECURITY_COLLECTION_NOTICE_HOURS } from '../shared/savedCardSecurity';
import { belongsToRentalAccount } from './lib/rentalAccount';
import { recoverApprovedRefund, RefundReviewRequired, type RefundReceipt } from './lib/approvedRefund';
const client=()=>{if(!process.env.STRIPE_SECRET_KEY)throw Error('Card payments are not configured.');return new Stripe(process.env.STRIPE_SECRET_KEY);};
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(p:number)=>`£${(p/100).toFixed(2)}`;
const date=(at:number)=>new Date(at).toLocaleString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const idArgs={id:v.id('rental_security_charges')};
async function matchingContext(ctx:any,id:any){const data:any=await ctx.runQuery(internal.securityChargeState.context,{id});if(!data?.charge||!data.booking||data.booking.accountId!==data.charge.accountId)throw Error('The rental charge/account binding is unavailable.');return data;}
function assertPayment(intent:Stripe.PaymentIntent,r:any){
 const customer=typeof intent.customer==='string'?intent.customer:intent.customer?.id;
 const method=(typeof intent.payment_method==='string'?intent.payment_method:intent.payment_method?.id)??intent.last_payment_error?.payment_method?.id;
 if(!r.attemptedAt||intent.metadata.securityChargeId!==String(r._id)||intent.metadata.bookingId!==String(r.bookingId)||intent.metadata.purpose!=='rental_saved_card_charge'||intent.amount!==r.amountPence||intent.currency!=='gbp'||customer!==r.customerId||method!==r.paymentMethodId)throw Error('The bank payment does not match this exact rental assessment.');
}
async function observe(ctx:any,id:any,intent:Stripe.PaymentIntent):Promise<{status:string;clientSecret?:string}> {
 const {charge:r,booking:b,collectionPaused}=await matchingContext(ctx,id);assertPayment(intent,r);
 let state:'paid'|'processing'|'requires_action'|'failed'|'uncertain'='uncertain';
 if(intent.status==='succeeded')state='paid';
 else if(intent.status==='processing')state='processing';
 else if(intent.status==='requires_action'){
  if(collectionPaused||Date.now()>b.actualReturnedAt+SECURITY_COLLECTION_DAYS*86400000){intent=await client().paymentIntents.cancel(intent.id,{}, {idempotencyKey:`dbc-security-expire-${r._id}`});state=intent.status==='canceled'?'failed':'uncertain';}
  else state='requires_action';
 }else if(intent.status==='canceled')state='failed';
 else if(['requires_payment_method','requires_confirmation'].includes(intent.status)){
  // Only a bank-confirmed cancelled intent frees a reservation for a new attempt.
  const canceled=await client().paymentIntents.cancel(intent.id,{}, {idempotencyKey:`dbc-security-close-${r._id}`});state=canceled.status==='canceled'?'failed':'uncertain';
 }
 await ctx.runMutation(internal.securityChargeState.record,{id,intentId:intent.id,state,paidPence:state==='paid'?intent.amount_received:0,...(state==='failed'?{error:'The bank did not complete this charge; no automatic replacement charge is made.'}:{})});
 return {status:state,...(state==='requires_action'&&!collectionPaused?{clientSecret:intent.client_secret??undefined}:{})};
}
async function findAttempt(sb:Stripe,r:any){
 // Recovery reads actual customer payments; never creates a new financial request.
 let after:string|undefined;
 for(let page=0;page<5;page++){
  const result=await sb.paymentIntents.list({customer:r.customerId,limit:100,...(after?{starting_after:after}:{})});
  const matches=result.data.filter(pi=>pi.metadata.securityChargeId===String(r._id));if(matches.length>1)throw Error('Multiple bank references require manual reconciliation.');if(matches[0])return matches[0];
  if(!result.has_more)return null;after=result.data[result.data.length-1]?.id;
 }
 throw Error('Bank history exceeds the safe reconciliation bound.');
}
export const sendNotice=internalAction({args:idArgs,handler:async(ctx,{id}):Promise<void>=>{
 if(!await ctx.runMutation(internal.securityChargeState.claimNotice,{id}))return;
 const {charge:r,account}=await matchingContext(ctx,id);
 if(!account?.email){await ctx.runMutation(internal.securityChargeState.noticeResult,{id,sent:false});return;}
 const email={to:account.email,subject:`DB Cinema Rentals: ${money(r.amountPence)} ${r.kind==='late'?'late-return':'damage/loss'} assessment`,html:`<h2>Itemised rental assessment</h2><p>Reference ${esc(String(r._id).slice(-8))}. ${r.kind==='late'?'Late-return fees':'Damage/loss'}: <strong>${money(r.amountPence)}</strong>.</p><p>${esc(r.reason).replace(/\n/g,'<br>')}</p><p>No payment has been taken for this assessment. Under your retained booking consent, a card collection may be requested no earlier than ${date(Date.now()+SECURITY_COLLECTION_NOTICE_HOURS*3600000)} London time. Reply or raise a concern in your rental account within this period if the evidence or amount is wrong. A timely unresolved dispute pauses collection. Your bank dispute and statutory rights remain unchanged.</p><p><a href="${esc((process.env.APP_URL??'https://dbcinemarentals.com')+'/account?rental='+encodeURIComponent(String(r.bookingId))+'#chat')}">View your rental and assessment</a></p>`};const sent=await sendMail(email);
 await ctx.runMutation(internal.securityChargeState.noticeResult,{id,sent,recipient:email.to,subject:email.subject,html:email.html});
}});
export const sendReceipt=internalAction({args:idArgs,handler:async(ctx,{id}):Promise<void>=>{
 if(!await ctx.runMutation(internal.securityChargeState.claimNotice,{id,receipt:true}))return;
 const {charge:r,account}=await matchingContext(ctx,id);
 if(!account?.email){await ctx.runMutation(internal.securityChargeState.noticeResult,{id,sent:false,receipt:true});return;}
 const email={to:account.email,subject:`DB Cinema Rentals: ${money(r.paidPence??0)} assessment payment receipt`,html:`<h2>Payment confirmed</h2><p>Stripe confirmed ${money(r.paidPence??0)} for your ${r.kind==='late'?'late-return':'damage/loss'} assessment, reference ${esc(String(r._id).slice(-8))}.</p><p>${esc(r.reason)}</p><p>This is a separate saved-card payment. No deposit or card hold was captured.</p><p>Reply if any receipt detail is wrong.</p>`};const sent=await sendMail(email);
 await ctx.runMutation(internal.securityChargeState.noticeResult,{id,sent,receipt:true,recipient:email.to,subject:email.subject,html:email.html});
}});
export const resendNotice=action({args:{token:v.string(),...idArgs},handler:async(ctx,{token,id}):Promise<void>=>{await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token,fn:'securityCharges.resendNotice'});await ctx.runAction(internal.securityCharges.sendNotice,{id});}});
export const collect=action({args:{token:v.string(),...idArgs},handler:async(ctx,{token,id}):Promise<{status:string}>=>{
 await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token,fn:'securityCharges.collect'});
 const r:any=await ctx.runMutation(internal.securityChargeState.claim,{id});const sb=client();let requestStarted=false;
 try{
  const current=await matchingContext(ctx,id);
  if(current.collectionPaused){if(r.state==='notice_sent'&&!r.intentId){await ctx.runMutation(internal.securityChargeState.record,{id,state:'failed',paidPence:0,error:'Disputed before the bank request; collection stopped.'});return {status:'failed'};}return {status:(await ctx.runAction(internal.securityCharges.reconcile,{id})).status};}
  if(r.intentId)return {status:(await observe(ctx,id,await sb.paymentIntents.retrieve(r.intentId))).status};
  if(r.state==='uncertain'){const found=await findAttempt(sb,r);if(found)return {status:(await observe(ctx,id,found)).status};}
  const method=await sb.paymentMethods.retrieve(r.paymentMethodId);
  if(method.type!=='card'||(typeof method.customer==='string'?method.customer:method.customer?.id)!==r.customerId)throw Error('Saved card is no longer attached to the rental customer.');
  requestStarted=true;const pi=await sb.paymentIntents.create({capture_method:'automatic',amount:r.amountPence,currency:'gbp',customer:r.customerId,payment_method:r.paymentMethodId,allowed_payment_method_types:['card'],confirm:true,off_session:true,description:`DB Cinema ${r.kind==='late'?'late-return':'damage/loss'} assessment ${String(r._id).slice(-8)}`,metadata:{purpose:'rental_saved_card_charge',bookingId:String(r.bookingId),securityChargeId:String(r._id)}},{idempotencyKey:`dbc-security-charge-${r._id}`});
  return {status:(await observe(ctx,id,pi)).status};
 }catch(error:any){
  const intentId=error?.raw?.payment_intent?.id??error?.payment_intent?.id;
  if(intentId){try{return {status:(await observe(ctx,id,await sb.paymentIntents.retrieve(intentId))).status};}catch{await ctx.runMutation(internal.securityChargeState.record,{id,intentId,state:'uncertain',paidPence:0,error:'Bank outcome requires reconciliation; no second charge is allowed.'});return {status:'uncertain'};}}
  if(!requestStarted&&r.state==='notice_sent'&&!r.intentId){await ctx.runMutation(internal.securityChargeState.record,{id,state:'failed',paidPence:0,error:'No bank collection request was sent; the saved card needs review.'});return {status:'failed'};}
  // Network errors or a lost response retain the full reservation. A replay uses
  // the same immutable payload/key only within the bank idempotency window.
  await ctx.runMutation(internal.securityChargeState.record,{id,state:'uncertain',paidPence:0,error:'The bank outcome is unconfirmed. Reconcile this assessment before retrying.'});return {status:'uncertain'};
 }
}});
export const reconcile=internalAction({args:idArgs,handler:async(ctx,{id}):Promise<{status:string}>=>{
 const {charge:r}=await matchingContext(ctx,id);if(!r.attemptedAt)return {status:r.state};const sb=client();const pi=r.intentId?await sb.paymentIntents.retrieve(r.intentId):await findAttempt(sb,r);if(!pi){await ctx.runMutation(internal.securityChargeState.record,{id,state:'uncertain',paidPence:0,error:'No bank outcome has been located. No second charge is created automatically.'});return {status:'uncertain'};}return {status:(await observe(ctx,id,pi)).status};
}});
export const refresh=action({args:{token:v.string(),...idArgs,admin:v.optional(v.boolean())},handler:async(ctx,a):Promise<{status:string;clientSecret?:string}>=>{
 if(a.admin)await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:a.token,fn:'securityCharges.refresh'});
 else{const account:any=await ctx.runQuery(internal.accounts._byToken,{token:a.token}),data=await matchingContext(ctx,a.id);if(!account||data.charge.accountId!==account._id||!belongsToRentalAccount(data.booking,account))throw Error('Rental charge access denied.');}
 const {charge:r}=await matchingContext(ctx,a.id);if(!r.intentId){if(r.attemptedAt)return ctx.runAction(internal.securityCharges.reconcile,{id:a.id});return {status:r.state};}const result=await observe(ctx,a.id,await client().paymentIntents.retrieve(r.intentId));return a.admin?{status:result.status}:result;
}});
export const reconcileReference=action({args:{token:v.string(),...idArgs,paymentIntentId:v.string()},handler:async(ctx,a):Promise<{status:string}>=>{
 await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:a.token,fn:'securityCharges.reconcileReference'});
 if(!/^pi_[A-Za-z0-9_]+$/.test(a.paymentIntentId))throw Error('Enter the existing Stripe payment reference.');
 // Read-only recovery: all immutable rental, amount, customer and card checks
 // in observe must pass before this existing bank reference can be attached.
 const result=await observe(ctx,a.id,await client().paymentIntents.retrieve(a.paymentIntentId));return {status:result.status};
}});
export const reconcileWebhook=internalAction({args:{id:v.string(),intentId:v.string()},handler:async(ctx,{id,intentId}):Promise<void>=>{
 const data:any=await ctx.runQuery(internal.securityChargeState.context,{id:id as any});if(!data?.charge?.attemptedAt)return;
 await observe(ctx,id,await client().paymentIntents.retrieve(intentId));
}});
export const processPending=internalAction({args:{},handler:async(ctx):Promise<void>=>{
 const ids:any[]=await ctx.runQuery(internal.securityChargeState.pending,{});
 for(const id of ids){try{await ctx.runAction(internal.securityCharges.reconcile,{id});}catch(error:any){await ctx.runMutation(internal.securityChargeState.reconciliationFailed,{id,permanent:[400,401,403,404].includes(error?.statusCode)});}}
 const refunds:any[]=await ctx.runQuery(internal.securityChargeState.pendingRefunds,{});
 for(const id of refunds){try{await ctx.runAction(internal.securityCharges.reconcileRefund,{id});}catch(error:any){await ctx.runMutation(internal.securityChargeState.reconciliationFailed,{id,refund:true,permanent:[400,401,403,404].includes(error?.statusCode)});}}
}});
async function refundTotals(sb:Stripe,r:any){
 const refunds=await sb.refunds.list({payment_intent:r.intentId,limit:100});if(refunds.has_more)throw new RefundReviewRequired('Refund history needs manual review. No new refund was requested.');
 const successful=refunds.data.filter(x=>x.status==='succeeded').reduce((n,x)=>n+x.amount,0),pending=refunds.data.filter(x=>x.status!=='succeeded'&&x.status!=='failed'&&x.status!=='canceled').reduce((n,x)=>n+x.amount,0);
 if(successful+pending>r.paidPence)throw new RefundReviewRequired('Bank refunds exceed this exact assessment receipt.');return {successful,pending};
}
async function settleRefund(ctx:any,id:any,receipt:RefundReceipt){
 const {charge:r}=await matchingContext(ctx,id),totals=await refundTotals(client(),r);
 await ctx.runMutation(internal.securityChargeState.recordRefund,{id,receipt,refundedPence:totals.successful});
 return {status:receipt.status,...(receipt.approvalUrl?{approvalUrl:receipt.approvalUrl}: {})};
}
export const refundPayment=action({args:{token:v.string(),...idArgs,reason:v.string()},handler:async(ctx,a):Promise<{status:string;approvalUrl?:string}>=>{
 await ctx.runMutation(internal.adminAuth.assertAdminInternal,{token:a.token,fn:'securityCharges.refundPayment'});
 const {charge:r}=await matchingContext(ctx,a.id);if(r.state!=='paid'||!r.intentId||!r.paidPence)throw Error('A bank-confirmed payment is required.');
 const sb=client(),totals=await refundTotals(sb,r);await ctx.runMutation(internal.securityChargeState.externalRefund,{id:a.id,refundedPence:totals.successful});
 if(totals.successful===r.paidPence)return {status:'succeeded'};
 if(!r.refundReceipt&&totals.pending>0)throw new RefundReviewRequired('A bank refund is already pending. Reconcile it before requesting another.');
 const frozen:any=await ctx.runMutation(internal.securityChargeState.beginRefund,{id:a.id,reason:a.reason,amountPence:r.paidPence-totals.successful-totals.pending});
 try{
  const receipt=await recoverApprovedRefund(sb,frozen.receipt,{currency:'gbp',now:Date.now(),maxRefunds:100,idempotencyKey:'dbc-security-refund-'+r._id+'-'+frozen.nonce,metadata:{securityChargeId:String(r._id),refundNonce:String(frozen.nonce)},persist:async(receipt)=>{await ctx.runMutation(internal.securityChargeState.recordRefund,{id:a.id,receipt,refundedPence:totals.successful});}});
  return settleRefund(ctx,a.id,receipt);
 }catch(error){const latest=await matchingContext(ctx,a.id);await ctx.runMutation(internal.securityChargeState.recordRefund,{id:a.id,receipt:latest.charge.refundReceipt??frozen.receipt,refundedPence:totals.successful});throw error;}
}});
export const reconcileRefund=internalAction({args:idArgs,handler:async(ctx,{id}):Promise<void>=>{
 const {charge:r}=await matchingContext(ctx,id);if(r.state!=='paid'||!r.intentId)return;
 // Background/webhook recovery may read existing receipts, never create a refund.
 // An owner explicitly resumes an unknown attempt with refundPayment.
 if(r.refundReceipt&&!r.refundReceipt.stripeRefundId&&!r.refundReceipt.approvalRequestId){const totals=await refundTotals(client(),r);await ctx.runMutation(internal.securityChargeState.externalRefund,{id,refundedPence:totals.successful});await ctx.runMutation(internal.securityChargeState.reconciliationFailed,{id,refund:true,permanent:true});return;}
 if(r.refundReceipt){const receipt=await recoverApprovedRefund(client(),r.refundReceipt,{currency:'gbp',now:Date.now(),maxRefunds:100,idempotencyKey:'dbc-security-refund-'+r._id+'-'+(r.refundNonce??1),metadata:{securityChargeId:String(r._id),refundNonce:String(r.refundNonce??1)},persist:async(receipt)=>{const totals=await refundTotals(client(),r);await ctx.runMutation(internal.securityChargeState.recordRefund,{id,receipt,refundedPence:totals.successful});}});await settleRefund(ctx,id,receipt);}
 else{const totals=await refundTotals(client(),r);await ctx.runMutation(internal.securityChargeState.externalRefund,{id,refundedPence:totals.successful});}
}});
export const refundWebhook=internalAction({args:{paymentIntentId:v.string()},handler:async(ctx,a):Promise<void>=>{
 const r:any=await ctx.runQuery(internal.securityChargeState.byIntent,a);if(r)await ctx.runAction(internal.securityCharges.reconcileRefund,{id:r._id});
}});
