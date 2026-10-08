import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export type RentalEmailKind = "payment" | "receipt" | "verification" | "cancellation" | "review";
/** Persist in the same transaction as payment, verification or cancellation.
 * Stable financial keys prevent webhook replays from sending twice. Each real
 * verification transition gets a new sequence so returning to a status can notify. */
export async function queueRentalEmail(ctx: MutationCtx, bookingId: Id<"bookings">, kind: RentalEmailKind,
  detail: {verificationStatus?: string; mode?: string; refundAmount?: number; creditAmount?: number} = {}) {
  const previous = (await ctx.db.query("rental_email_deliveries").withIndex("by_booking_kind",q=>q.eq("bookingId",bookingId).eq("kind",kind)).order("desc").take(1))[0];
  if (kind !== "verification" && previous) return previous._id;
  const sequence = (previous?.sequence ?? 0) + 1;
  if (kind === "verification" && previous && ["pending","sending"].includes(previous.state))
    await ctx.db.patch(previous._id,{state:"skipped",updatedAt:Date.now(),lastError:"Superseded verification notice"});
  const now=Date.now(), id=await ctx.db.insert("rental_email_deliveries",{
    bookingId,kind,...detail,key:`${bookingId}:${kind}:${kind === "verification" ? sequence : 1}`,
    sequence,state:"pending",attempts:0,generation:0,dueAt:now,createdAt:now,updatedAt:now,
  });
  await ctx.scheduler.runAfter(0,internal.rentalEmailDelivery.dispatchOne,{deliveryId:id});
  return id;
}
