import { bumpVerificationRetentionRevision } from "./verificationRetentionRevision";

export async function retainVerificationArchiveLink(ctx:any, booking:any, sourceId = booking?.verificationReusedFrom) {
  if (!booking?._id || !sourceId || sourceId === booking._id) return;
  const existing = await ctx.db.query("verification_archive_links").withIndex("by_source_booking",(q:any)=>q.eq("sourceBookingId",sourceId).eq("bookingId",booking._id)).unique();
  if (!existing) {
    await ctx.db.insert("verification_archive_links",{sourceBookingId:sourceId,bookingId:booking._id,createdAt:Date.now()});
    const source = await ctx.db.get(sourceId);
    await bumpVerificationRetentionRevision(ctx, source ?? booking);
  }
}
