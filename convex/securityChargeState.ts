import { query, mutation, internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import { assertAdmin, checkAdminToken } from './adminAuth';
import { accountForToken, ownedBooking, postRentalMessage } from './lib/rentalChat';
import { assertSavedCardCollection, isSavedCardRental, SECURITY_COLLECTION_NOTICE_HOURS, SECURITY_COLLECTION_DAYS } from '../shared/savedCardSecurity';
import { internal } from './_generated/api';
const released = (state:string) => ['failed','voided'].includes(state);
const idArgs={id:v.id('rental_security_charges')};
export const list = query({args:{token:v.string(),bookingId:v.id('bookings'),admin:v.optional(v.boolean())},handler:async(ctx,a)=>{
 if(a.admin){if(!checkAdminToken(a.token))return null;}else{const account=await accountForToken(ctx,a.token);if(!account)return null;await ownedBooking(ctx,account,a.bookingId);}
 const b=await ctx.db.get(a.bookingId);if(!isSavedCardRental(b))return null;
 const rows=await ctx.db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',a.bookingId)).order('desc').take(100);
 const gross=b!.savedCardChargePaidPence??0,refunded=rows.reduce((n,r)=>n+(r.refundedPence??0),0);
 return {limit:b!.savedCardLimit??0,used:gross/100,paid:Math.max(0,gross-refunded)/100,reserved:(b!.savedCardChargeReservedPence??0)/100,cardStatus:b!.savedCardStatus??'awaiting_payment',
  damageAssessed:b!.savedCardDamageAssessed??b!.returnDecision?.damageKept??0,lateAssessed:b!.lateFeeAmount??0,returnedAt:b!.actualReturnedAt??null,
  rows:rows.map(r=>({id:r._id,kind:r.kind,amount:r.amountPence/100,reason:r.reason,state:r.state,paid:(r.paidPence??0)/100,createdAt:r.createdAt,noticeAt:r.noticeAt??null,collectAfter:r.collectAfter??null,disputeReason:r.disputeReason??null,disputeResolution:r.disputeResolution??null,disputeResolvedAt:r.disputeResolvedAt??null,refunded:(r.refundedPence??0)/100,refundStatus:r.refundReceipt?.status??null,refundReason:r.refundReason??null,...(a.admin?{refundApprovalUrl:r.refundReceipt?.approvalUrl??null}:{}),error:r.error??null}))};
}});
export const prepare = mutation({args:{token:v.string(),bookingId:v.id('bookings'),requestId:v.string(),kind:v.union(v.literal('damage'),v.literal('late')),amount:v.number(),reason:v.string()},handler:async(ctx,a)=>{
 await assertAdmin(ctx,a.token,'securityCharges.prepare');
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(a.requestId)||!Number.isFinite(a.amount)||a.amount<=0||Math.round(a.amount*100)/100!==a.amount||a.reason.trim().length<10||a.reason.length>4000)throw Error('Enter a positive penny-accurate amount and itemised evidence/reason.');
 const amountPence=Math.round(a.amount*100),reason=a.reason.trim();
 const previous=await ctx.db.query('rental_security_charges').withIndex('by_request',q=>q.eq('bookingId',a.bookingId).eq('requestId',a.requestId)).unique();
 if(previous){if(previous.kind!==a.kind||previous.amountPence!==amountPence||previous.reason!==reason)throw Error('This request belongs to a different assessment.');return previous._id;}
 const b=await ctx.db.get(a.bookingId);assertSavedCardCollection(b);
 if(Date.now()+SECURITY_COLLECTION_NOTICE_HOURS*3600000>b!.actualReturnedAt!+SECURITY_COLLECTION_DAYS*86400000)throw Error('There is insufficient time for the notice period within the agreed collection window.');
 if(!b!.accountId)throw Error('A permanent rental account is required.');
 const account=await ctx.db.get(b!.accountId);if(!account||account.blockedAt!=null||!account.email)throw Error('The rental account is unavailable.');
 const rows=await ctx.db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',a.bookingId)).take(100);
 if(rows.length>=100)throw Error('Charge history requires manual review.');
 if(a.kind==='damage'&&!b!.returnDecision?.inspection?.some(i=>i.condition!=='good'))throw Error('An item-specific inspected issue is required for a damage charge.');
 const firstPendingQuote=a.kind==='damage'&&!b!.returnDecision?.damageKept&&!b!.savedCardDamageAssessed&&!rows.some(r=>r.kind==='damage'&&r.state!=='voided');
 const assessed=firstPendingQuote?amountPence:Math.round((a.kind==='damage'?(b!.savedCardDamageAssessed??b!.returnDecision?.damageKept??0):(b!.lateFeeAmount??0))*100);
 const allocated=rows.filter(r=>r.kind===a.kind&&!released(r.state)).reduce((n,r)=>n+(r.state==='paid'?(r.paidPence??0):r.amountPence),0);
 if(amountPence>assessed-allocated)throw Error('The amount exceeds the remaining recorded assessment; do not charge the same loss twice.');
 const reserved=b!.savedCardChargeReservedPence??0,paid=b!.savedCardChargePaidPence??0,limit=Math.round(b!.savedCardLimit!*100);
 if(amountPence>limit-reserved-paid)throw Error('The combined damage and late-fee card limit would be exceeded. Request separate payment consent for any further amount.');
 if(firstPendingQuote)await ctx.db.patch(b!._id,{savedCardDamageAssessed:a.amount});
 const now=Date.now(),id=await ctx.db.insert('rental_security_charges',{bookingId:a.bookingId,accountId:b!.accountId,requestId:a.requestId,kind:a.kind,amountPence,reason,customerId:b!.savedCardCustomerId!,paymentMethodId:b!.savedCardPaymentMethodId!,consentSnapshot:b!.agreementSnapshot!,state:'notice_pending',createdAt:now,updatedAt:now});
 await ctx.db.patch(b!._id,{savedCardChargeReservedPence:reserved+amountPence});
 await postRentalMessage(ctx,{accountId:b!.accountId,bookingId:b!._id,sender:'system',text:`An itemised ${a.kind==='late'?'late-return':'damage/loss'} assessment of £${a.amount.toFixed(2)} has been prepared. No payment has been taken. You will receive the evidence and proposed collection date before any card collection. ${reason}`});
 await ctx.scheduler.runAfter(0,internal.securityCharges.sendNotice,{id});return id;
}});
export const context=internalQuery({args:idArgs,handler:async(ctx,{id})=>{const charge=await ctx.db.get(id);if(!charge)return null;const booking=await ctx.db.get(charge.bookingId),account=await ctx.db.get(charge.accountId);const rows=await ctx.db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',charge.bookingId)).take(100);return {charge,booking,account,collectionPaused:rows.some(r=>r.disputedAt&&!r.disputeResolvedAt)||!!booking?.cancellationDecision||!account||account.blockedAt!=null};}});
export const claimNotice=internalMutation({args:{...idArgs,receipt:v.optional(v.boolean())},handler:async(ctx,{id,receipt})=>{
 const r=await ctx.db.get(id);if(!r)return false;const now=Date.now();
 if(receipt){if(r.state!=='paid'||r.receiptNoticeAt||(r.receiptLeaseUntil??0)>now)return false;await ctx.db.patch(id,{receiptLeaseUntil:now+120000});}
 else{if(r.state!=='notice_pending'||(r.noticeLeaseUntil??0)>now)return false;await ctx.db.patch(id,{noticeLeaseUntil:now+120000});}return true;
}});
export const noticeResult=internalMutation({args:{...idArgs,sent:v.boolean(),receipt:v.optional(v.boolean()),recipient:v.optional(v.string()),subject:v.optional(v.string()),html:v.optional(v.string())},handler:async(ctx,{id,sent,receipt,recipient,subject,html})=>{
 const r=await ctx.db.get(id);if(!r)return;
 if(receipt){await ctx.db.patch(id,{receiptLeaseUntil:undefined,...(sent?{receiptNoticeAt:Date.now(),receiptEmail:recipient,receiptSubject:subject,receiptHtml:html}: {})});return;}
 if(r.state!=='notice_pending')return;
 await ctx.db.patch(id,{noticeLeaseUntil:undefined,updatedAt:Date.now(),...(sent?{state:'notice_sent',noticeAt:Date.now(),noticeEmail:recipient,noticeSubject:subject,noticeHtml:html,collectAfter:Date.now()+SECURITY_COLLECTION_NOTICE_HOURS*3600000,error:undefined}:{error:'Notice delivery failed; collection is blocked.'})});
}});
export const claim=internalMutation({args:idArgs,handler:async(ctx,{id})=>{
 const r=await ctx.db.get(id);if(!r)throw Error('Charge not found.');
 const b=await ctx.db.get(r.bookingId);assertSavedCardCollection(b);
 const account=await ctx.db.get(r.accountId);if(!account||account.blockedAt!=null)throw Error('The account requires review before collection.');
 if(r.consentSnapshot!==b!.agreementSnapshot||r.accountId!==b!.accountId)throw Error('The retained rental/account consent changed.');
 const reviews=await ctx.db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',r.bookingId)).take(100);
 if(reviews.some(row=>row.disputedAt&&!row.disputeResolvedAt))throw Error('An unresolved renter dispute pauses all saved-card collections for this rental.');
 if(!['notice_sent','uncertain'].includes(r.state)||!r.noticeAt||!r.collectAfter||r.collectAfter>Date.now())throw Error('Collection is blocked until the notice period finishes and any dispute is resolved.');
 if((r.leaseUntil??0)>Date.now())throw Error('This collection is already in progress.');
 if(r.attemptedAt&&Date.now()>r.attemptedAt+23*3600000&&!r.intentId)throw Error('The original outcome needs manual reconciliation; a second payment must not be created.');
 const claimed={...r,attemptedAt:r.attemptedAt??Date.now()};
 await ctx.db.patch(id,{state:'collecting',attemptedAt:claimed.attemptedAt,leaseUntil:Date.now()+120000,reconcileNextAt:Date.now()+120000,updatedAt:Date.now(),error:undefined});return claimed;
}});
export const record=internalMutation({args:{...idArgs,intentId:v.optional(v.string()),state:v.union(v.literal('paid'),v.literal('processing'),v.literal('requires_action'),v.literal('failed'),v.literal('uncertain')),paidPence:v.number(),error:v.optional(v.string())},handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id);if(!r)return;
 if(r.intentId&&a.intentId&&r.intentId!==a.intentId)throw Error('A different payment is already bound to this charge.');
 if(a.intentId){const bound=await ctx.db.query('rental_security_charges').withIndex('by_intent',q=>q.eq('intentId',a.intentId)).unique();if(bound&&bound._id!==r._id)throw Error('This bank payment is already recorded against another assessment.');}
 if(r.state==='paid')return;
 if(released(r.state)&&a.state!=='failed')throw Error('A closed charge cannot acquire a new payment.');
 if(!Number.isSafeInteger(a.paidPence)||a.paidPence<0||a.paidPence>r.amountPence||a.state!=='paid'&&a.paidPence!==0)throw Error('Invalid provider payment receipt.');
 const b=await ctx.db.get(r.bookingId);if(!b)throw Error('Rental missing.');
 const close=a.state==='paid'||a.state==='failed';
 if(close&&!released(r.state))await ctx.db.patch(b._id,{savedCardChargeReservedPence:Math.max(0,(b.savedCardChargeReservedPence??0)-r.amountPence),savedCardChargePaidPence:(b.savedCardChargePaidPence??0)+a.paidPence});
 const count=(r.reconcileCount??0)+1;
 const next=close?undefined:a.state==='requires_action'?Math.max(Date.now()+300000,(b.actualReturnedAt??Date.now())+SECURITY_COLLECTION_DAYS*86400000+1000):count>=20?undefined:Date.now()+Math.min(6*3600000,300000*2**Math.min(count,7));
 await ctx.db.patch(a.id,{state:a.state,intentId:a.intentId??r.intentId,paidPence:a.paidPence,leaseUntil:undefined,updatedAt:Date.now(),error:a.error,reconcileCount:count,reconcileFailures:0,reconcileNextAt:next});
 if(a.state==='paid'){
  if(r.kind==='late')await ctx.db.patch(b._id,{lateFeePaidFromCard:(b.lateFeePaidFromCard??0)+a.paidPence/100,lateFeeStatus:(b.lateFeePaidFromCard??0)+a.paidPence/100>= (b.lateFeeAmount??0)?'paid':'partial'});
  if(await ctx.db.get(r.accountId)){
   await postRentalMessage(ctx,{accountId:r.accountId,bookingId:r.bookingId,sender:'system',text:`Stripe confirmed a £${(a.paidPence/100).toFixed(2)} ${r.kind==='late'?'late-return':'damage/loss'} payment. Assessment reference ${String(r._id).slice(-8)}. This is a separate payment, not a captured deposit or hold.`});
   await ctx.scheduler.runAfter(0,internal.securityCharges.sendReceipt,{id:r._id});
  }
 }
}});
export const dispute=mutation({args:{token:v.string(),...idArgs,reason:v.string()},handler:async(ctx,a)=>{
 const account=await accountForToken(ctx,a.token),r=await ctx.db.get(a.id);if(!account||!r||r.accountId!==account._id)throw Error('Charge access denied.');await ownedBooking(ctx,account,r.bookingId);
 if(a.reason.trim().length<5||a.reason.length>4000)throw Error('Describe what needs review.');
 if(r.disputedAt)return;
 await ctx.db.patch(r._id,{disputedAt:Date.now(),disputeReason:a.reason.trim(),updatedAt:Date.now()});
 const pending=await ctx.db.query('rental_security_charges').withIndex('by_booking',q=>q.eq('bookingId',r.bookingId)).take(100);
 for(const row of pending)if(row.attemptedAt&&['requires_action','uncertain','collecting'].includes(row.state))await ctx.scheduler.runAfter(0,internal.securityCharges.reconcile,{id:row._id});
 await postRentalMessage(ctx,{accountId:r.accountId,bookingId:r.bookingId,sender:'renter',text:`I dispute security assessment ${String(r._id).slice(-8)}: ${a.reason.trim()}`});
}});
export const closePrepared=mutation({args:{token:v.string(),...idArgs,reason:v.string()},handler:async(ctx,a)=>{
 await assertAdmin(ctx,a.token,'securityCharges.void');const r=await ctx.db.get(a.id);if(!r)throw Error('Charge missing.');
 if(r.attemptedAt||!['notice_pending','notice_sent'].includes(r.state))throw Error('A bank attempt exists; reconcile or refund it rather than deleting its history.');
 if(a.reason.trim().length<5)throw Error('Record why this assessment is withdrawn.');const b=await ctx.db.get(r.bookingId);if(!b)throw Error('Rental missing.');
 await ctx.db.patch(b._id,{savedCardChargeReservedPence:Math.max(0,(b.savedCardChargeReservedPence??0)-r.amountPence)});await ctx.db.patch(r._id,{state:'voided',updatedAt:Date.now(),error:a.reason.trim()});
 if(await ctx.db.get(r.accountId))await postRentalMessage(ctx,{accountId:r.accountId,bookingId:r.bookingId,sender:'system',text:`Security assessment ${String(r._id).slice(-8)} withdrawn without collection: ${a.reason.trim()}`});
}});
export const pending=internalQuery({args:{},handler:async(ctx)=>{
 const rows=await ctx.db.query('rental_security_charges').withIndex('by_reconcile',q=>q.gte('reconcileNextAt',1).lte('reconcileNextAt',Date.now())).take(25);
 return rows.filter(r=>(r.leaseUntil??0)<=Date.now()).map(r=>r._id);
}});
export const reconciliationFailed=internalMutation({args:{...idArgs,permanent:v.boolean(),refund:v.optional(v.boolean())},handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id);if(!r)return;const count=(a.refund?r.refundReconcileCount:r.reconcileFailures)??0;
 const next=a.permanent||count>=4?undefined:Date.now()+Math.min(3600000,300000*2**count);
 await ctx.db.patch(a.id,a.refund?{refundReconcileCount:count+1,refundReconcileAt:next}:{reconcileFailures:count+1,reconcileNextAt:next,error:'Bank reconciliation needs review. No replacement charge is created automatically.'});
}});
export const pendingRefunds=internalQuery({args:{},handler:async(ctx)=>{
 const rows=await ctx.db.query('rental_security_charges').withIndex('by_refund_reconcile',q=>q.gte('refundReconcileAt',1).lte('refundReconcileAt',Date.now())).take(25);
 return rows.filter(r=>(r.refundLeaseUntil??0)<=Date.now()).map(r=>r._id);
}});
export const proposeResolution=mutation({args:{token:v.string(),...idArgs,explanation:v.string()},handler:async(ctx,a)=>{
 await assertAdmin(ctx,a.token,'securityCharges.proposeDisputeResolution');const r=await ctx.db.get(a.id);if(!r?.disputedAt||r.disputeResolvedAt)throw Error('There is no unresolved dispute.');
 if(a.explanation.trim().length<10||a.explanation.length>4000)throw Error('Record the reviewed evidence and proposed resolution.');
 await ctx.db.patch(r._id,{disputeResolution:a.explanation.trim(),updatedAt:Date.now()});
 await postRentalMessage(ctx,{accountId:r.accountId,bookingId:r.bookingId,sender:'system',text:`Review of assessment ${String(r._id).slice(-8)} (${r.state==='voided'?'withdrawn without payment':`£${(r.amountPence/100).toFixed(2)}`}): ${a.explanation.trim()} Collection remains paused. Please review the proposed resolution in your account.`});
}});
export const acceptResolution=mutation({args:{token:v.string(),...idArgs,expectedResolution:v.string()},handler:async(ctx,a)=>{
 const account=await accountForToken(ctx,a.token),r=await ctx.db.get(a.id);if(!account||!r||r.accountId!==account._id)throw Error('Charge access denied.');await ownedBooking(ctx,account,r.bookingId);
 if(!r.disputeResolution||r.disputeResolution!==a.expectedResolution)throw Error('The reviewed resolution changed; read it again before accepting.');
 if(r.disputeResolvedAt)return;
 await ctx.db.patch(r._id,{disputeResolvedAt:Date.now(),collectAfter:Date.now()+SECURITY_COLLECTION_NOTICE_HOURS*3600000,updatedAt:Date.now()});
 await postRentalMessage(ctx,{accountId:r.accountId,bookingId:r.bookingId,sender:'renter',text:`I have reviewed and accept the resolution of assessment ${String(r._id).slice(-8)} (${r.state==='voided'?'withdrawn without payment':`£${(r.amountPence/100).toFixed(2)}`}): ${r.disputeResolution}. My statutory and bank dispute rights remain unchanged.`});
}});
export const evidence=query({args:{token:v.string(),...idArgs},handler:async(ctx,a)=>{
 if(!checkAdminToken(a.token))throw Error('unauthorized');const r=await ctx.db.get(a.id);if(!r)throw Error('Assessment missing.');const b=await ctx.db.get(r.bookingId);if(!b||b.accountId!==r.accountId)throw Error('Rental account binding changed.');
 return {format:1,rentalId:b._id,assessmentId:r._id,kind:r.kind,amount:r.amountPence/100,reason:r.reason,createdAt:r.createdAt,
  acceptedAgreement:JSON.parse(r.consentSnapshot),explicitConsentRecordedAt:b.laterChargeConsentAt,cardSavedFromCheckout:b.savedCardSessionId,
  equipmentInspection:b.returnDecision?.inspection??[],pickedUpAt:b.pickedUpAt,returnedAt:b.actualReturnedAt,
  noticeAt:r.noticeAt,noticeRecipient:r.noticeEmail,noticeSubject:r.noticeSubject,noticeHtml:r.noticeHtml,
  earliestCollectionAt:r.collectAfter,attemptedAt:r.attemptedAt,paymentIntentId:r.intentId,confirmedPaid:(r.paidPence??0)/100,state:r.state,
  dispute:r.disputedAt?{at:r.disputedAt,reason:r.disputeReason,resolution:r.disputeResolution,customerAcceptedAt:r.disputeResolvedAt}:null,
  note:'Evidence supports review; it does not waive statutory rights or guarantee a bank dispute outcome.'};
}});
export const beginRefund=internalMutation({args:{...idArgs,reason:v.string(),amountPence:v.number()},handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id);if(!r||r.state!=='paid'||!r.intentId||!r.paidPence)throw Error('Only a bank-confirmed paid assessment can be refunded.');
 if(a.reason.trim().length<5||a.reason.length>4000)throw Error('Record the refund reason.');
 if((r.refundLeaseUntil??0)>Date.now())throw Error('This refund is already being reconciled.');
 if(r.refundReceipt&&r.refundReceipt.status!=='failed'){
  if(r.refundReason!==a.reason.trim())throw Error('Resume the saved refund reason and payment reference.');
  await ctx.db.patch(r._id,{refundLeaseUntil:Date.now()+120000});return {receipt:r.refundReceipt,nonce:r.refundNonce??1};
 }
 if(!Number.isSafeInteger(a.amountPence)||a.amountPence<=0||a.amountPence>r.paidPence-(r.refundedPence??0))throw Error('Refund exceeds the remaining confirmed fee payment.');
 if((r.refundHistory?.length??0)>=10)throw Error('Refund attempts require manual review.');
 const nonce=(r.refundNonce??0)+1,receipt={paymentIntentId:r.intentId,amountPence:a.amountPence,attemptedAt:Date.now(),status:'unknown' as const};
 await ctx.db.patch(r._id,{refundNonce:nonce,refundReceipt:receipt,refundReason:a.reason.trim(),refundLeaseUntil:Date.now()+120000,refundHistory:r.refundReceipt?[...(r.refundHistory??[]),r.refundReceipt]:r.refundHistory});return {receipt,nonce};
}});
const refundReceipt=v.object({paymentIntentId:v.string(),amountPence:v.number(),attemptedAt:v.number(),stripeRefundId:v.optional(v.string()),approvalRequestId:v.optional(v.string()),approvalUrl:v.optional(v.string()),status:v.union(v.literal('unknown'),v.literal('awaiting_approval'),v.literal('pending'),v.literal('succeeded'),v.literal('failed'))});
export const recordRefund=internalMutation({args:{...idArgs,receipt:refundReceipt,refundedPence:v.number()},handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id);if(!r||!r.refundReceipt||r.intentId!==a.receipt.paymentIntentId||r.refundReceipt.attemptedAt!==a.receipt.attemptedAt||r.refundReceipt.amountPence!==a.receipt.amountPence)throw Error('Refund receipt differs from the exact saved fee settlement.');
 if(!Number.isSafeInteger(a.refundedPence)||a.refundedPence<0||a.refundedPence>(r.paidPence??0))throw Error('Invalid fee refund receipt.');
 const previous=r.refundedPence??0;
 const count=(r.refundReconcileCount??0)+1,finished=['succeeded','failed'].includes(a.receipt.status);
 await ctx.db.patch(r._id,{refundReceipt:a.receipt,refundedPence:a.refundedPence,refundLeaseUntil:undefined,updatedAt:Date.now(),refundReconcileCount:count,refundReconcileAt:finished||count>=12?undefined:Date.now()+Math.min(6*3600000,300000*2**Math.min(count,7))});
 const delta=a.refundedPence-previous;
 if(delta!==0&&r.kind==='late'){
  const b=await ctx.db.get(r.bookingId);
  if(b){const net=Math.max(0,(b.lateFeePaidFromCard??0)-delta/100);await ctx.db.patch(b._id,{lateFeePaidFromCard:net,lateFeeStatus:net>=(b.lateFeeAmount??0)?'paid':net>0?'partial':'refunded'});}
 }
 if(await ctx.db.get(r.accountId)){
  if(a.refundedPence>previous)await postRentalMessage(ctx,{accountId:r.accountId,bookingId:r.bookingId,sender:'system',text:`Stripe confirmed £${((a.refundedPence-previous)/100).toFixed(2)} refunded to the original payment method for assessment ${String(r._id).slice(-8)}. Reason: ${r.refundReason}. This is a cash refund, not account credit.`});
  if(a.refundedPence<previous)await postRentalMessage(ctx,{accountId:r.accountId,bookingId:r.bookingId,sender:'system',text:`Stripe revised the confirmed refund for assessment ${String(r._id).slice(-8)} to £${(a.refundedPence/100).toFixed(2)}. The bank receipt needs review; no new charge was requested.`});
 }
 // Refunds never restore the used automatic-collection allowance.
}});
export const byIntent=internalQuery({args:{paymentIntentId:v.string()},handler:(ctx,a)=>ctx.db.query('rental_security_charges').withIndex('by_intent',q=>q.eq('intentId',a.paymentIntentId)).unique()});
export const externalRefund=internalMutation({args:{...idArgs,refundedPence:v.number()},handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id);if(!r||r.state!=='paid'||!Number.isSafeInteger(a.refundedPence)||a.refundedPence<0||a.refundedPence>(r.paidPence??0))throw Error('Invalid bank-confirmed fee refund total.');
 const delta=a.refundedPence-(r.refundedPence??0);await ctx.db.patch(r._id,{refundedPence:a.refundedPence,updatedAt:Date.now()});
 if(delta!==0){const b=await ctx.db.get(r.bookingId);if(b&&r.kind==='late'){const net=Math.max(0,(b.lateFeePaidFromCard??0)-delta/100);await ctx.db.patch(b._id,{lateFeePaidFromCard:net,lateFeeStatus:net>=(b.lateFeeAmount??0)?'paid':net>0?'partial':'refunded'});}}
}});
