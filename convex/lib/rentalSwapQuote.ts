import type { Doc } from "../_generated/dataModel";
import { bookingStockLines } from "../../shared/rentalWindow";
import { securityForPolicy } from "../../shared/rentalSecurity";
import { assertRentalAllocation } from "./rentalAllocation";
import { assertRentalInventory } from "./rentalInventory";
import { assertRenterExposure } from "./rentalExposure";
import { requestableListing } from "./rentalKitSelection";
import { quote } from "./pricing";
import { canDeferAdditionSecurity } from "../../shared/pickupSecurity";

const pence=(amount:number)=>{if(!Number.isFinite(amount)||amount<0||!Number.isSafeInteger(Math.round(amount*100)))throw Error("The saved rental price needs review.");return Math.round(amount*100);};
/** A selected source is an immutable identity, not a mutable position in a kit. */
export function assertCurrentKitSource(booking:any,request:any){
 const s=request?.kitSelection;
 if(!s||s.change==="add")return null;
 const line=Number.isSafeInteger(s.lineIndex)&&s.lineIndex>=0?booking?.lineItems?.[s.lineIndex]:undefined;
 if(!line||!s.source||line.listingId!==s.source.listingId||line.qty!==s.source.qty||line.start!==s.source.start||line.end!==s.source.end||s.sourceListingId!==line.listingId||s.sourceQty!==line.qty||s.sourceStart!==line.start||s.sourceEnd!==line.end)throw Error("The requested kit changed. Reopen and approve a new request.");
 if(!Number.isSafeInteger(s.quantity)||s.quantity<1||s.quantity>line.qty)throw Error("The requested source quantity needs review.");
 if(s.change==="swap"&&s.listingId===line.listingId)throw Error("Choose a different item for the equipment swap.");
 return line;
}
/** Compute the final kit and the difference; never release stock or execute money here. */
export async function rentalSwapQuote(ctx:any,booking:Doc<"bookings">,request:any,settlementAdditionId?:string){
 const selection=request?.kitSelection;
 if(selection?.change!=="swap")throw Error("Choose an approved equipment swap.");
 if(!["confirmed","active"].includes(booking.status)||booking.cancellationDecision||booking.returnDecision||booking.returnedAt)throw Error("This paid rental cannot be swapped now.");
 if(booking.activeAdditionId&&booking.activeAdditionId!==settlementAdditionId||booking.activeExtensionId)throw Error("Finish or withdraw the open kit or extension proposal first.");
 if(settlementAdditionId&&booking.activeAdditionId!==settlementAdditionId)throw Error("The swap settlement is no longer active.");
 if(["starting","requires_action","failed"].includes(booking.depositHoldRenewalStatus??""))throw Error("Resolve the existing card hold renewal before swapping equipment.");
 if((booking.depositHoldAmount??0)>0&&!canDeferAdditionSecurity(booking)&&(booking.depositHoldExpiresAt??0)<=Date.now()+36*3600000)throw Error("Renew the current security hold before swapping equipment; the proposal must not interrupt rental coverage.");
 const source=assertCurrentKitSource(booking,request)!;
 const target=await ctx.db.get(selection.listingId);
 if(!requestableListing(target))throw Error("The replacement equipment is unavailable.");
 const rows=await ctx.db.query("reservations").withIndex("by_booking",(q:any)=>q.eq("bookingId",booking._id)).take(201);
 if(rows.length>200)throw Error("The stock ledger needs paged reconciliation before this swap.");
 const reservations=rows.filter((r:any)=>!settlementAdditionId||r.externalRef!==`addition:${settlementAdditionId}`);
 if(reservations.some((r:any)=>r.source!=="site"||r.status==="hold"))throw Error("Resolve the original platform or open stock hold before swapping equipment.");
 const allocationMode=await assertRentalAllocation(ctx,booking,reservations);
 const refunds=await ctx.db.query("rental_refunds").withIndex("by_booking",(q:any)=>q.eq("bookingId",booking._id)).take(201);
 if(refunds.length>200)throw Error("The refund ledger needs paged reconciliation before this swap.");
 if(refunds.some((r:any)=>["prepared","pending"].includes(r.status)))throw Error("Wait for the pending refund to settle before a swap.");
 const lines=bookingStockLines<any>(booking),original=lines[selection.lineIndex];
 const originalLinePence=pence(source.lineTotal),removedLinePence=Math.round(originalLinePence*selection.quantity/source.qty);
 const replacementLinePence=pence(quote(target.pricing,Math.round((source.end-source.start)/86400000)+1).total*selection.quantity);
 const replacement={...original,listingId:target._id,title:target.title,qty:selection.quantity,lineTotal:replacementLinePence/100,dailyRate:target.pricing.daily*selection.quantity};
 const finalLines=lines.flatMap((line:any,i:number)=>i!==selection.lineIndex?[line]:selection.quantity===line.qty?[replacement]:[{...line,qty:line.qty-selection.quantity,lineTotal:(originalLinePence-removedLinePence)/100,...(line.dailyRate===undefined?{}:{dailyRate:line.dailyRate*(line.qty-selection.quantity)/line.qty})},replacement]);
 await assertRenterExposure(ctx,booking,finalLines);
 await assertRentalInventory(ctx,finalLines,booking._id);
 const catalog=await Promise.all(finalLines.map((line:any)=>ctx.db.get(line.listingId)));
 const equipmentValue=catalog.reduce((sum:number,l:any,i:number)=>sum+(l?.depositAmount??0)*finalLines[i].qty,0);
 const security=securityForPolicy(booking.securityPolicyVersion,booking.protection==="deposit"?"deposit":"verify",equipmentValue);
 const securityCharge=["paid_membership","new_paid_membership"].includes(booking.securityWaiverReason??"")?0:Math.max(0,security.deposit-booking.depositAmount);
 const differencePence=replacementLinePence-removedLinePence;
 // Redeemed credits are not cash. A swap may refund only the rental cash still represented in the booking.
 const totalPence=pence(booking.total),depositPence=pence(booking.depositAmount);
 if(totalPence<depositPence)throw Error("The saved rental payment and security amounts need review.");
 const rentalCashPence=Math.max(0,totalPence-depositPence-pence(booking.deliveryFee??0));
 const priorRefundPence=refunds.reduce((sum:number,r:any)=>sum+(r.parts?r.parts.filter((part:any)=>part.status==="succeeded").reduce((n:number,part:any)=>n+part.amountPence,0):r.status==="succeeded"?r.amountPence:0),0);
 const refundPence=Math.min(Math.max(0,-differencePence),Math.max(0,rentalCashPence-priorRefundPence));
 const nonCashDifferencePence=Math.max(0,-differencePence-refundPence);
 const sourceCatalog=await ctx.db.get(source.listingId);
 const componentFingerprint=(l:any)=>JSON.stringify(l.components.map((c:any)=>[c.inventoryUnitId,c.qty]).sort((a:any,b:any)=>String(a[0]).localeCompare(String(b[0]))));
 const catalogSnapshot=(l:any)=>[l._id,l.title,l.active,l.suppressed??false,l.marketingOnly??false,l.depositAmount,l.pricing,componentFingerprint(l)];
 // Consent belongs to the actual payment and hold generation, not just their amounts.
 // Keep these provider identifiers private: a replacement card or rescheduled hold
 // requires a fresh offer even when the displayed totals happen to stay identical.
 const paymentSnapshot={
  rentalIntent:booking.stripePaymentIntentId??null,membershipCheckout:booking.membershipCheckoutId??null,
  holdStatus:booking.depositHoldStatus??null,holdExpiresAt:booking.depositHoldExpiresAt??null,
  renewalIntent:booking.depositHoldRenewalIntentId??null,renewalStatus:booking.depositHoldRenewalStatus??null,
  holdGeneration:booking.securityHoldGeneration??null,holdDueAt:booking.securityHoldDueAt??null,
  holdCustomer:booking.securityHoldCustomerId??null,holdPaymentMethod:booking.securityHoldPaymentMethodId??null,
  holdConsentAt:booking.securityHoldConsentAt??null,
  recoverySession:booking.securityHoldRecoverySessionId??null,recoveryGeneration:booking.securityHoldRecoveryGeneration??null,
 };
 const snapshot=JSON.stringify([booking.status,booking.lineItems,booking.pickupTime??null,booking.returnTime??null,booking.subtotal,booking.total,booking.depositAmount,booking.depositHoldAmount??0,booking.securityPolicyVersion??null,booking.securityWaiverReason??null,booking.securityHoldPolicyVersion??null,booking.stripeDepositIntentId??null,booking.creditApplied??0,booking.rentalPaidPence??null,booking.deliveryFee??0,booking.discount??0,booking.pricingVersion??null,booking.benefitKind??null,booking.creditAllocations??[],booking.refundCreditApplied??0,booking.earnedCreditApplied??0,booking.membershipCreditApplied??0,booking.membershipSignupOfferSaving??0,booking.agreementDocs??[],catalogSnapshot(sourceCatalog),catalog.map(catalogSnapshot),refunds.map((r:any)=>[r._id,r.status,r.amountPence,r.parts??null]).sort((a:any,b:any)=>String(a[0]).localeCompare(String(b[0])))]);
 return {source,target,selection,replacement,finalLines,allocationMode,snapshot:JSON.stringify([snapshot,paymentSnapshot]),removedLinePence,replacementLinePence,differencePence,refundPence,nonCashDifferencePence,chargePence:Math.max(0,differencePence)+pence(securityCharge),securityCharge,holdTotal:security.hold,equipmentValue};
}

/** An opaque equality token; internal booking/catalogue details never reach the renter. */
export async function swapQuoteKey(booking:any,request:any,q:any){
 const basis=JSON.stringify(["swap-difference-v1",booking._id,request._id,request.accountId,request.kitSelection,q.snapshot,q.finalLines,q.allocationMode,q.removedLinePence,q.replacementLinePence,q.differencePence,q.refundPence,q.nonCashDifferencePence,q.chargePence,q.securityCharge,q.holdTotal]);
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(basis))),byte=>byte.toString(16).padStart(2,"0")).join("");
}
