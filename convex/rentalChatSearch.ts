import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { checkAdminToken } from "./adminAuth";

function remainingTerms(terms: string[], texts: string[]) {
  if (terms.length > 32 || terms.some((term) => term.length > 256))
    throw Error("Use up to 32 search words.");
  const normalized = [
    ...new Set(
      terms.map((term) => term.trim().toLocaleLowerCase()).filter(Boolean),
    ),
  ];
  const haystacks = texts.map((text) => text.toLocaleLowerCase());
  return normalized.filter(
    (term) => !haystacks.some((text) => text.includes(term)),
  );
}

/** Owner-only history search. The renter's unread state is never changed. */
export const page = action({
  args: {
    token: v.string(),
    requests: v.array(
      v.object({
        bookingId: v.id("bookings"),
        terms: v.array(v.string()),
        cursor: v.union(v.string(), v.null()),
      }),
    ),
  },
  handler: async (ctx, { token, requests }): Promise<any> => {
    if (!checkAdminToken(token)) throw Error("Unauthorized");
    if (requests.length > 16)
      throw Error("Search up to 16 conversations per page.");
    requests.forEach((request) => remainingTerms(request.terms, []));
    return Promise.all(
      requests.map((request) =>
        ctx.runQuery(
          internal.rentalChatSearch.__bookingPage,
          request,
        ),
      ),
    );
  },
});

// Convex permits one built-in paginated read per query execution. Each booking
// therefore runs in its own internal query, with one owner-authenticated batch.
export const __bookingPage = internalQuery({
  args: {
    bookingId: v.id("bookings"),
    terms: v.array(v.string()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, request) => {
    const terms = remainingTerms(request.terms, []);
    const booking = await ctx.db.get(request.bookingId);
    if (!terms.length || !booking?.accountId)
      return {
        bookingId: request.bookingId,
        remaining: terms,
        done: true,
        cursor: null,
        scanned: 0,
      };
    const result = await ctx.db
      .query("messages")
      .withIndex("by_booking_at", (q) => q.eq("bookingId", request.bookingId))
      .order("desc")
      .filter((q) => q.eq(q.field("accountId"), booking.accountId))
      .paginate({ numItems: 16, cursor: request.cursor });
    const remaining = remainingTerms(
      terms,
      result.page.map((message) => message.text),
    );
    const done = result.isDone || !remaining.length;
    return {
      bookingId: request.bookingId,
      remaining,
      done,
      cursor: done ? null : result.continueCursor,
      scanned: result.page.length,
    };
  },
});
