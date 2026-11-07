import { bookingStockLines, rentalWindow } from "../../shared/rentalWindow";
import { stockTimePrecision } from "./stockWindows";
import { verificationValidUntil } from "../../shared/verificationProgress";

export function bookingReadyForStockClaim(booking:any,sessionId:string,paymentIntentId?:string) {
  if(!booking || !["pending_payment","pending_verification"].includes(booking.status) || booking.cancellationDecision || booking.returnDecision || booking.stripeCheckoutSessionId!==sessionId || booking.stripePaymentIntentId && booking.stripePaymentIntentId!==paymentIntentId) return false;
  return booking.verificationProvider!=="didit" || booking.idVerifyStatus==="verified" && (verificationValidUntil(booking)??0)>Date.now();
}

export async function bookingClaimItems(ctx:any,booking:any) {
  const precision=await stockTimePrecision(ctx),items:any[]=[],unitIds=new Map<string,string>();
  for(const line of bookingStockLines(booking) as any[]){
    if(!Number.isSafeInteger(line.qty)||line.qty<1)throw Error("Booking stock quantity needs review.");
    const listing=await ctx.db.get(line.listingId);
    if(!listing?.components?.length)throw Error("Booking equipment mapping needs review.");
    const window=rentalWindow(line,precision);
    for(const component of listing.components){
      const unit=await ctx.db.get(component.inventoryUnitId),itemId=unit?.rmv2ItemId,quantity=component.qty*line.qty;
      if(typeof itemId!=="string"||!itemId||itemId.length>255||!Number.isSafeInteger(component.qty)||component.qty<1||!Number.isSafeInteger(quantity)||quantity<1||quantity>100||unitIds.has(itemId)&&unitIds.get(itemId)!==String(component.inventoryUnitId))throw Error("Booking manager stock mapping needs review.");
      unitIds.set(itemId,String(component.inventoryUnitId));
      items.push({itemId,start:window.start,returnAt:window.end,quantity});
    }
  }
  if(!items.length||items.length>64)throw Error("Booking stock allocation needs review.");
  return items.sort((left,right)=>left.itemId.localeCompare(right.itemId)||left.start-right.start||left.returnAt-right.returnAt||left.quantity-right.quantity);
}
