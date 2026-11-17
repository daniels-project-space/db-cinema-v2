import { internalMutation, internalQuery, query } from './_generated/server';
import { v } from 'convex/values';
import { ASSESSMENT_SECURITY_POLICY_VERSION, hasCashDepositPolicy, REFUNDABLE_DEPOSIT_POLICY_VERSION } from '../shared/rentalSecurity';
import { checkAdminToken } from './adminAuth';
import { accountForToken, ownedBooking } from './lib/rentalChat';
import { assertSavedCardConsent, isSavedCardRental } from '../shared/savedCardSecurity';
import { queueOwnerNotification } from './lib/adminPush';
export const context = internalQuery({args:{bookingId:v.id('bookings')},handler:(ctx,{bookingId})=>ctx.db.get(bookingId)});
export const save = internalMutation({args:{bookingId:v.id('bookings'),sessionId:v.string(),customerId:v.string(),paymentMethodId:v.string()},handler:async(ctx,a)=>{
 const b=await ctx.db.get(a.bookingId);
 const paidPending=b?.status==='pending_verification'&&Number.isSafeInteger(b.checkoutPaidAt)&&b.checkoutPaidAt!>0;
 if(!b||!isSavedCardRental(b)||(!['confirmed','active'].includes(b.status)&&!paidPending)||b.cancellationDecision||b.returnDecision||b.stripeCheckoutSessionId!==a.sessionId)return false;
 assertSavedCardConsent(b);
 const account=b.accountId?await ctx.db.get(b.accountId):await ctx.db.query('accounts').withIndex('by_email',q=>q.eq('email',(b.guestEmail??'').trim().toLowerCase())).unique();
 // Guest checkout may legitimately use a different Stripe customer from the
 // account's subscription. Bind the attested checkout card to this rental only.
 if((b.accountId&&!account)||account?.blockedAt!=null||(!account&&!paidPending)||(!b.accountId&&!b.guestEmail))throw Error('The permanent rental account is unavailable.');
 if(b.savedCardStatus==='saved'&&(b.savedCardCustomerId!==a.customerId||b.savedCardPaymentMethodId!==a.paymentMethodId))throw Error('The completed rental card receipt cannot be replaced by a checkout replay.');
 await ctx.db.patch(b._id,{savedCardStatus:'saved',savedCardCustomerId:a.customerId,savedCardPaymentMethodId:a.paymentMethodId,savedCardSessionId:a.sessionId});return true;
}});
export const failed = internalMutation({args:{bookingId:v.id('bookings')},handler:async(ctx,{bookingId})=>{const b=await ctx.db.get(bookingId);if(isSavedCardRental(b)&&b!.savedCardStatus!=='saved')await ctx.db.patch(bookingId,{savedCardStatus:'needs_setup'});}});
export const alertRecoveryFailure = internalMutation({args:{bookingId:v.id('bookings')},handler:async(ctx,{bookingId})=>{
 const b=await ctx.db.get(bookingId);
 if(!b||b.status!=='pending_verification'||!b.checkoutPaidAt||!isSavedCardRental(b)||b.savedCardStatus==='saved'||b.cancellationDecision||b.returnDecision)return;
 await queueOwnerNotification(ctx,{eventKey:`saved-card-recovery:${bookingId}`,kind:'checkout_failure',...(b.accountId?{accountId:b.accountId}:{}),bookingId,title:'Rental card setup needs attention',body:'Payment was received, but the saved card could not be confirmed in the website. Check the Stripe receipt and rental before handover.'});
}});
export const status = query({args:{token:v.string(),bookingId:v.id('bookings'),admin:v.optional(v.boolean())},handler:async(ctx,a)=>{
 let b;if(a.admin){if(!checkAdminToken(a.token))return null;b=await ctx.db.get(a.bookingId);}else{const account=await accountForToken(ctx,a.token);if(!account)return null;b=await ownedBooking(ctx,account,a.bookingId);}
 if(!isSavedCardRental(b))return null;
 return {limit:b!.securityPolicyVersion===ASSESSMENT_SECURITY_POLICY_VERSION?null:b!.savedCardLimit??0,status:b!.savedCardStatus??'awaiting_payment',reserved:(b!.savedCardChargeReservedPence??0)/100,paid:(b!.savedCardChargePaidPence??0)/100};
}});
export const markReturn=internalMutation({args:{bookingId:v.id('bookings'),damageNote:v.optional(v.string())},handler:async(ctx,a)=>{
 const b=await ctx.db.get(a.bookingId);if(!isSavedCardRental(b)||b!.status!=='returned'||!b!.returnDecision)throw Error('An inspected saved-card return is required.');
 if (hasCashDepositPolicy(b!.securityPolicyVersion)) {
  if (!b!.depositRefunded) throw Error('Finish the deposit refund decision before closing this return.');
  await ctx.db.patch(a.bookingId,{depositHoldStatus:'not_applicable',returnedAt:b!.returnedAt??b!.returnDecision!.actualReturnedAt});
  return;
 }
 await ctx.db.patch(a.bookingId,{depositRefunded:true,depositKept:0,depositRefundAmount:0,depositHoldCapturedForDamage:0,depositDeductionNote:a.damageNote,depositHoldStatus:'not_applicable',returnedAt:b!.returnedAt??b!.returnDecision!.actualReturnedAt});
}});
