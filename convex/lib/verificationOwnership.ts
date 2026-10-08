import { belongsToRentalAccount } from "./rentalAccount";
import type { Id, Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Attach pre-account copies using rental ownership; never transfer an owner. */
export async function linkVerificationCopies(ctx: MutationCtx, bookingId: Id<"bookings">, accountId: Id<"accounts">) {
  const booking = await ctx.db.get(bookingId);
  const account = await ctx.db.get(accountId);
  if (!belongsToRentalAccount(booking, account)) throw Error("Verification copies do not belong to this rental account.");
  const archives = await ctx.db.query("verification_archives").withIndex("by_booking", q => q.eq("bookingId", bookingId)).collect();
  const documents: Doc<"verification_documents">[] = [];
  for (const archive of archives) {
    if (archive.accountId && archive.accountId !== accountId) throw Error("Verification archive owner does not match the rental account.");
    const copies = await ctx.db.query("verification_documents").withIndex("by_archive", q => q.eq("archiveId", archive._id)).collect();
    for (const copy of copies) {
      if (copy.bookingId !== bookingId || copy.sessionId !== archive.sessionId || (copy.accountId && copy.accountId !== accountId))
        throw Error("Verification document owner or rental binding does not match.");
    }
    documents.push(...copies);
  }
  // Validate every binding before applying any metadata repair. File bytes,
  // integrity hashes, retention dates and deleted status remain unchanged.
  for (const archive of archives) if (!archive.accountId) await ctx.db.patch(archive._id, { accountId });
  for (const document of documents) if (!document.accountId) await ctx.db.patch(document._id, { accountId });
}
