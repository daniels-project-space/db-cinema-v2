import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { bookingStockLines } from "../../shared/rentalWindow";

export function pickupScheduleFingerprint(booking:{lineItems:any[];pickupTime?:string|null;returnTime?:string|null}) {
  return JSON.stringify(bookingStockLines({...booking,lineItems:booking.lineItems??[]}).map(line=>[String(line.listingId),line.qty,line.start,line.pickupTime??null]));
}

export type RentalEmailKind = "payment" | "receipt" | "verification" | "cancellation" | "review" | "encore" | "encore_guest_claim" | "cancellation_choice" | "time_change";
/** Persist in the same transaction as payment, verification or cancellation.
 * Stable financial keys prevent webhook replays from sending twice. Each real
 * verification transition gets a new sequence so returning to a status can notify. */
export async function queueRentalEmail(ctx: MutationCtx, bookingId: Id<"bookings">, kind: RentalEmailKind,
  detail: {verificationStatus?: string; mode?: string; refundAmount?: number; creditAmount?: number; changeDetail?:string;changeSchedule?:string;encoreLevel?:number;encoreAccountId?:Id<"accounts">} = {},options?:{repeatGuestClaim?:boolean}) {
  const previous = (await ctx.db.query("rental_email_deliveries").withIndex("by_booking_kind",q=>q.eq("bookingId",bookingId).eq("kind",kind)).order("desc").take(1))[0];
  if (kind === "encore" && previous?.state === "skipped" && previous.attempts === 0 && !previous.sentAt) {
    const now=Date.now();
    await ctx.db.patch(previous._id,{...detail,encoreLevel:previous.encoreAccountId===detail.encoreAccountId?previous.encoreLevel:detail.encoreLevel,state:"pending",generation:previous.generation+1,dueAt:now,updatedAt:now,lastError:undefined});
    await ctx.scheduler.runAfter(0,internal.rentalEmailDelivery.dispatchOne,{deliveryId:previous._id});
    return previous._id;
  }
  if(kind==="encore_guest_claim"&&previous&&(!options?.repeatGuestClaim||["pending","sending"].includes(previous.state)))return previous._id;
  if (kind !== "verification" && kind !== "cancellation_choice" && kind !== "time_change" && kind!=="encore_guest_claim" && previous) return previous._id;
  const sequence = (previous?.sequence ?? 0) + 1;
  if ((kind === "verification" || kind === "time_change") && previous && ["pending","sending"].includes(previous.state))
    await ctx.db.patch(previous._id,{state:"skipped",updatedAt:Date.now(),lastError:"Superseded by a newer notice"});
  const booking=kind==="verification"&&detail.verificationStatus==="verified"?await ctx.db.get(bookingId):null;
  const now=Date.now(), id=await ctx.db.insert("rental_email_deliveries",{
    bookingId,kind,...detail,...(booking?{verificationSchedule:pickupScheduleFingerprint(booking)}:{}),key:`${bookingId}:${kind}:${kind === "verification" || kind === "cancellation_choice" || kind === "time_change" || kind==="encore_guest_claim" ? sequence : 1}`,
    sequence,state:"pending",attempts:0,generation:0,dueAt:now,createdAt:now,updatedAt:now,
  });
  await ctx.scheduler.runAfter(0,internal.rentalEmailDelivery.dispatchOne,{deliveryId:id});
  return id;
}
export async function refreshQueuedVerificationEmail(ctx:MutationCtx,bookingId:Id<"bookings">){
  const previous=(await ctx.db.query("rental_email_deliveries").withIndex("by_booking_kind",q=>q.eq("bookingId",bookingId).eq("kind","verification")).order("desc").take(1))[0];
  if(previous?.verificationStatus==="verified"&&["pending","sending"].includes(previous.state))await queueRentalEmail(ctx,bookingId,"verification",{verificationStatus:"verified"});
}
