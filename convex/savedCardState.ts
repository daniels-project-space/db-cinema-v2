import { internalMutation, internalQuery, query } from './_generated/server';
import { v } from 'convex/values';
import { REFUNDABLE_DEPOSIT_POLICY_VERSION } from '../shared/rentalSecurity';
import { checkAdminToken } from './adminAuth';
import { accountForToken, ownedBooking } from './lib/rentalChat';
import { assertSavedCardConsent, isSavedCardRental } from '../shared/savedCardSecurity';
export const context = internalQuery({args:{bookingId:v.id('bookings')},handler:(ctx,{bookingId})=>ctx.db.get(bookingId)});
export const save = internalMutation({args:{bookingId:v.id('bookings'),sessionId:v.string(),customerId:v.string(),paymentMethodId:v.string()},handler:async(ctx,a)=>{
 const b=await ctx.db.get(a.bookingId);if(!b||!isSavedCardRental(b)||!['confirmed','active'].includes(b.status)||b.cancellationDecision||b.returnDecision||b.stripeCheckoutSessionId!==a.sessionId)return false;
 assertSavedCardConsent(b);
 const account=b.accountId?await ctx.db.get(b.accountId):null;
 // Guest checkout may legitimately use a different Stripe customer from the
 // account's subscription. Bind the attested checkout card to this rental only.
 if(!account||account.blockedAt!=null)throw Error('The permanent rental account is unavailable.');
 if(b.savedCardStatus==='saved'&&(b.savedCardCustomerId!==a.customerId||b.savedCardPaymentMethodId!==a.paymentMethodId))throw Error('The completed rental card receipt cannot be replaced by a checkout replay.');
 await ctx.db.patch(b._id,{savedCardStatus:'saved',savedCardCustomerId:a.customerId,savedCardPaymentMethodId:a.paymentMethodId,savedCardSessionId:a.sessionId});return true;
}});
export const failed = internalMutation({args:{bookingId:v.id('bookings')},handler:async(ctx,{bookingId})=>{const b=await ctx.db.get(bookingId);if(isSavedCardRental(b)&&b!.savedCardStatus!=='saved')await ctx.db.patch(bookingId,{savedCardStatus:'needs_setup'});}});
export const status = query({args:{token:v.string(),bookingId:v.id('bookings'),admin:v.optional(v.boolean())},handler:async(ctx,a)=>{
 let b;if(a.admin){if(!checkAdminToken(a.token))return null;b=await ctx.db.get(a.bookingId);}else{const account=await accountForToken(ctx,a.token);if(!account)return null;b=await ownedBooking(ctx,account,a.bookingId);}
 if(!isSavedCardRental(b))return null;
 return {limit:b!.savedCardLimit??0,status:b!.savedCardStatus??'awaiting_payment',reserved:(b!.savedCardChargeReservedPence??0)/100,paid:(b!.savedCardChargePaidPence??0)/100};
}});
export const markReturn=internalMutation({args:{bookingId:v.id('bookings'),damageNote:v.optional(v.string())},handler:async(ctx,a)=>{
 const b=await ctx.db.get(a.bookingId);if(!isSavedCardRental(b)||b!.status!=='returned'||!b!.returnDecision)throw Error('An inspected saved-card return is required.');
 if (b!.securityPolicyVersion === REFUNDABLE_DEPOSIT_POLICY_VERSION) {
  if (!b!.depositRefunded) throw Error('Finish the deposit refund decision before closing this return.');
  await ctx.db.patch(a.bookingId,{depositHoldStatus:'not_applicable',returnedAt:b!.returnedAt??b!.returnDecision!.actualReturnedAt});
  return;
 }
 await ctx.db.patch(a.bookingId,{depositRefunded:true,depositKept:0,depositRefundAmount:0,depositHoldCapturedForDamage:0,depositDeductionNote:a.damageNote,depositHoldStatus:'not_applicable',returnedAt:b!.returnedAt??b!.returnDecision!.actualReturnedAt});
}});
