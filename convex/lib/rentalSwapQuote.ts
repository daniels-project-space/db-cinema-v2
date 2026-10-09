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
export async function rentalSwapQuote(ctx:any,booking:Doc<"bookings">,request:any){
 const selection=request?.kitSelection;
 if(selection?.change!=="swap")throw Error("Choose an approved equipment swap.");
 if(!["confirmed","active"].includes(booking.status)||booking.cancellationDecision||booking.returnDecision||booking.returnedAt)throw Error("This paid rental cannot be swapped now.");
 if(booking.activeAdditionId||booking.activeExtensionId)throw Error("Finish or withdraw the open kit or extension proposal first.");
 if(["starting","requires_action","failed"].includes(booking.depositHoldRenewalStatus??""))throw Error("Resolve the existing card hold renewal before swapping equipment.");
 if((booking.depositHoldAmount??0)>0&&!canDeferAdditionSecurity(booking)&&(booking.depositHoldExpiresAt??0)<=Date.now()+36*3600000)throw Error("Renew the current security hold before swapping equipment; the proposal must not interrupt rental coverage.");
 const source=assertCurrentKitSource(booking,request)!;
 const target=await ctx.db.get(selection.listingId);
 if(!requestableListing(target))throw Error("The replacement equipment is unavailable.");
 const reservations=await ctx.db.query("reservations").withIndex("by_booking",(q:any)=>q.eq("bookingId",booking._id)).collect();
 if(reservations.some((r:any)=>r.source!=="site"||r.status==="hold"))throw Error("Resolve the original platform or open stock hold before swapping equipment.");
 const allocationMode=await assertRentalAllocation(ctx,booking,reservations);
 const refunds=await ctx.db.query("rental_refunds").withIndex("by_booking",(q:any)=>q.eq("bookingId",booking._id)).collect();
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
 const rentalCashPence=totalPence-depositPence;
 const priorRefundPence=refunds.reduce((sum:number,r:any)=>sum+(r.parts?r.parts.filter((part:any)=>part.status==="succeeded").reduce((n:number,part:any)=>n+part.amountPence,0):r.status==="succeeded"?r.amountPence:0),0);
 const refundPence=Math.min(Math.max(0,-differencePence),Math.max(0,rentalCashPence-priorRefundPence));
 const nonCashDifferencePence=Math.max(0,-differencePence-refundPence);
 const sourceCatalog=await ctx.db.get(source.listingId);
 const componentFingerprint=(l:any)=>JSON.stringify(l.components.map((c:any)=>[c.inventoryUnitId,c.qty]).sort((a:any,b:any)=>String(a[0]).localeCompare(String(b[0]))));
 const snapshot=JSON.stringify([booking.lineItems,booking.pickupTime??null,booking.returnTime??null,booking.subtotal,booking.total,booking.depositAmount,booking.depositHoldAmount??0,booking.securityPolicyVersion??null,booking.securityWaiverReason??null,componentFingerprint(sourceCatalog),componentFingerprint(target)]);
 return {source,target,selection,replacement,finalLines,allocationMode,snapshot,removedLinePence,replacementLinePence,differencePence,refundPence,nonCashDifferencePence,chargePence:Math.max(0,differencePence)+pence(securityCharge),securityCharge,holdTotal:security.hold,equipmentValue};
}
