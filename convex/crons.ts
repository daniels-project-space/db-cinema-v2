import { cronJobs } from "convex/server";
import { api, internal } from "./_generated/api";

const crons = cronJobs();

// Release expired soft cart holds.
crons.interval("release-holds", { minutes: 5 }, internal.bookings.releaseExpiredHolds, {});

// Expire old login sessions (enforces session TTL — queries can't read the clock).
crons.interval("sweep-sessions", { hours: 1 }, internal.accounts.sweepExpiredSessions, {});

// Pickup-tomorrow / return-today reminders (email + Telegram).
crons.interval("send-reminders", { hours: 12 }, internal.notify.sendReminders, {});

// Expire store credit past its 90-day window (Phase 3).
crons.interval("expire-credits", { hours: 24 }, internal.credits.expire, {});

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
