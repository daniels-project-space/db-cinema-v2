import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { accountForRental } from "./rentalAccount";

/** Preserve the booking conversation as case evidence and mark the live thread. */
export async function archiveCaseConversation(ctx: any, caseRecord: any) {
  const booking = await ctx.db.get(caseRecord.bookingId);
  if (!booking) throw Error("The case rental is unavailable for chat archiving.");
  const account = (caseRecord.accountId ? await ctx.db.get(caseRecord.accountId) : null) ?? await accountForRental(ctx, booking);
  const accountId = account?._id;
  const thread = accountId
    ? await ctx.db.query("chat_threads").withIndex("by_account_booking", (q: any) => q.eq("accountId", accountId).eq("bookingId", caseRecord.bookingId)).first()
    : await ctx.db.query("chat_threads").withIndex("by_booking_updated", (q: any) => q.eq("bookingId", caseRecord.bookingId)).first();
  const archivedAt = Number.isSafeInteger(caseRecord.openedAt) && caseRecord.openedAt > 0
    ? caseRecord.openedAt
    : Date.now();
  let archive = await ctx.db.query("chat_case_archives").withIndex("by_case", (q: any) => q.eq("caseId", caseRecord._id)).first();
  if (!archive) {
    const id = await ctx.db.insert("chat_case_archives", {
      caseId: caseRecord._id,
      bookingId: caseRecord.bookingId,
      ...(accountId ? { accountId } : {}),
      ...(thread ? { threadId: thread._id } : {}),
      archivedAt,
    });
    archive = await ctx.db.get(id);
  } else if ((!archive.threadId && thread) || (!archive.accountId && accountId)) {
    await ctx.db.patch(archive._id, { ...(thread ? { threadId: thread._id } : {}), ...(accountId ? { accountId } : {}) });
  }
  if (thread && (!thread.caseArchivedAt || thread.caseArchivedAt > archivedAt)) {
    await ctx.db.patch(thread._id, { caseArchivedAt: archivedAt });
  }
  return archive;
}

export async function bookingHasCaseArchive(ctx: any, bookingId: any): Promise<boolean> {
  const archive = await ctx.db.query("chat_case_archives").withIndex("by_booking", (q: any) => q.eq("bookingId", bookingId)).first();
  if (archive) return true;
  // Protect legacy evidence immediately, before the one-time archive backfill runs.
  return !!(await ctx.db.query("rental_damage_cases").withIndex("by_booking", (q: any) => q.eq("bookingId", bookingId)).first());
}

export const backfillLegacyCaseArchives = internalMutation({ args: {}, handler: async ctx => {
  let state = await ctx.db.query("chat_case_archive_backfill").withIndex("by_key", (q: any) => q.eq("key", "legacy-v1")).first();
  if (!state) {
    const id = await ctx.db.insert("chat_case_archive_backfill", { key: "legacy-v1", updatedAt: Date.now() });
    state = await ctx.db.get(id);
  }
  if (!state || state.completedAt) return { archived: 0, complete: true };
  const page = await ctx.db.query("rental_damage_cases").withIndex("by_opened", (q: any) => q.gte("openedAt", 0)).paginate({ cursor: state.cursor ?? null, numItems: 25 });
  let archived = 0;
  for (const caseRecord of page.page) {
    const existed = await ctx.db.query("chat_case_archives").withIndex("by_case", (q: any) => q.eq("caseId", caseRecord._id)).first();
    await archiveCaseConversation(ctx, caseRecord);
    if (!existed) archived++;
  }
  await ctx.db.patch(state._id, page.isDone
    ? { cursor: undefined, completedAt: Date.now(), updatedAt: Date.now() }
    : { cursor: page.continueCursor, updatedAt: Date.now() });
  if (!page.isDone) await ctx.scheduler.runAfter(0, (internal as any).chatCaseArchive.backfillLegacyCaseArchives, {});
  return { archived, complete: page.isDone };
} });
