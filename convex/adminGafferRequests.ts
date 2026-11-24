import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken } from "./adminAuth";
import { adminSessionMigrationReady, assertAdminScopeSession, assertCustomerReadSession } from "./adminAccountSessionV2";
import { belongsToRentalAccount } from "./lib/rentalAccount";
import { rentalRequestStillOpen, RENTAL_EXTENSION_REQUEST_OPEN_STATUSES } from "./lib/rentalRequestStatus";

const LIMIT = 25;

export const selectedRentalRequests = internalQuery({
  args: { token: v.string(), accountId: v.id("accounts"), bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    if (process.env.ADMIN_SESSION_CUSTOMER_READ_V2 === "enabled" || process.env.ADMIN_SESSION_RENTAL_CASES_V2 === "enabled") {
      if (!adminSessionMigrationReady()) throw Error("Admin session migration is not ready.");
      await assertCustomerReadSession(ctx, args.token);
      await assertAdminScopeSession(ctx, args.token, "rentals:read");
    } else if (!checkAdminToken(args.token)) throw Error("unauthorized");
    const [account, booking] = await Promise.all([ctx.db.get(args.accountId), ctx.db.get(args.bookingId)]);
    if (!belongsToRentalAccount(booking, account)) throw Error("Conversation unavailable.");
    const [requests, extensions] = await Promise.all([
      ctx.db.query("rental_change_requests").withIndex("by_booking", q => q.eq("bookingId", args.bookingId)).order("desc").take(LIMIT + 1),
      ctx.db.query("booking_change_requests").withIndex("by_booking", q => q.eq("bookingId", args.bookingId)).order("desc").take(LIMIT + 1),
    ]);
    return {
      incomplete: requests.length > LIMIT || extensions.length > LIMIT,
      renterRequests: requests.slice(0, LIMIT).filter(row => row.accountId === args.accountId && rentalRequestStillOpen(row)).map(row => ({
        kind: row.kind, status: row.status ?? "pending", execution: row.execution?.status ?? null,
      })),
      bookingChanges: extensions.slice(0, LIMIT).filter(row => row.accountId === args.accountId && RENTAL_EXTENSION_REQUEST_OPEN_STATUSES.some(status => status === row.status)).map(row => ({
        type: row.type, status: row.status,
      })),
    };
  },
});
