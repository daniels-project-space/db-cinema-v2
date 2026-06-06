import { cronJobs } from "convex/server";
import { api, internal } from "./_generated/api";

const crons = cronJobs();

// Release expired soft cart holds.
crons.interval("release-holds", { minutes: 5 }, internal.bookings.releaseExpiredHolds, {});

// Keep the storefront catalog fresh from RMv2 (listings, pricing, images-source).
crons.interval("sync-rmv2-catalog", { minutes: 30 }, api.sync.syncFromRmv2, {});

// Cross-check active + upcoming Hygglo rentals into the availability ledger so
// stock reflects what's already booked on Hygglo (by unit, dates, qty).
crons.interval(
  "sync-hygglo-reservations",
  { minutes: 15 },
  api.sync.syncHyggloReservations,
  {},
);

export default crons;
