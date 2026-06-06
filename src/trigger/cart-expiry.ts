import { schedules } from "@trigger.dev/sdk/v3";

/**
 * Releases expired soft cart holds from the reservation ledger.
 * Stub — wired to Convex in P1 (calls a mutation that deletes reservations
 * with status:"hold" and holdExpiresAt < now).
 */
export const cartExpiry = schedules.task({
  id: "cart-expiry",
  cron: "*/5 * * * *",
  run: async () => {
    // TODO(P1): convexClient.mutation(api.reservations.releaseExpiredHolds, {})
    return { released: 0 };
  },
});
