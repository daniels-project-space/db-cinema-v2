import { task } from "@trigger.dev/sdk/v3";

/**
 * Releases expired soft cart holds from the reservation ledger.
 * Stub — wired to Convex in P1 (calls a mutation that deletes reservations
 * with status:"hold" and holdExpiresAt < now). It must not be scheduled until
 * that mutation exists; the former 5-minute cron only created empty runs.
 */
export const cartExpiry = task({
  id: "cart-expiry",
  run: async () => {
    // TODO(P1): convexClient.mutation(api.reservations.releaseExpiredHolds, {})
    return { released: 0 };
  },
});
