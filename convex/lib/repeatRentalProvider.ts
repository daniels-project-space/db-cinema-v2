"use node";
import type Stripe from "stripe";
/** A completed repeat booking can include settled damage/late charges. It does
 * not reuse review eligibility, which intentionally excludes retained deposits. */
export async function providerRepeatGate(b:any,stripe:Stripe){
 const sources=b.paymentSources??(b.stripePaymentIntentId?[{paymentIntentId:b.stripePaymentIntentId,securityPence:Math.round((b.depositAmount??0)*100)}]:[]);
 const expected=Math.round((b.depositRefundAmount??Math.max(0,(b.depositAmount??0)-(b.depositKept??0)))*100);
 let refunded=0;
 for(const source of sources){if(!source.securityPence)continue;let part=0;for await(const r of stripe.refunds.list({payment_intent:source.paymentIntentId,limit:100})){if(r.status!=="succeeded")return false;if(r.currency==="gbp"&&!(b.rentalRefundIds??[]).includes(r.id))part+=r.amount;}refunded+=Math.min(source.securityPence,part);}
 if(refunded<expected)return false;
 for(const id of b.unappliedSecurityPayments??[]){const payment=await stripe.paymentIntents.retrieve(id);let returned=0;for await(const r of stripe.refunds.list({payment_intent:id,limit:100})){if(r.status!=="succeeded")return false;returned+=r.amount;}if(returned<payment.amount_received)return false;}
 const holds=[...new Set([b.stripeDepositIntentId,b.depositHoldRenewalIntentId,...(b.depositHoldPreviousIntentIds??[])].filter(Boolean))] as string[];
 if((b.depositHoldAmount??0)>0&&!holds.length)return false;
 for(const id of holds){const hold=await stripe.paymentIntents.retrieve(id);if(!["canceled","succeeded"].includes(hold.status)||hold.amount_capturable>0)return false;}
 return true;
}
