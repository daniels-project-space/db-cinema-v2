import { cronJobs } from "convex/server";
import { api, internal } from "./_generated/api";

const crons = cronJobs();

// Release expired soft cart holds.
crons.interval("release-holds", { minutes: 5 }, internal.bookings.releaseExpiredHolds, {});

// Reconcile paid checkouts when webhooks are delayed; retire only Stripe-confirmed unpaid ones.
crons.interval("reconcile-rental-checkouts", { minutes: 5 }, internal.checkout.reconcilePendingPayments, {});

// Lapse membership perks with the real Stripe subscription (deactivates cancelled/unpaid members).
crons.interval("reconcile-memberships", { hours: 6 }, internal.checkout.reconcileMemberships, {});

// Expire old login sessions (enforces session TTL — queries can't read the clock).
crons.interval("sweep-sessions", { hours: 1 }, internal.accounts.sweepExpiredSessions, {});

// Pickup-tomorrow / return-today reminders (email + Telegram).
crons.interval("send-reminders", { hours: 12 }, internal.notify.sendReminders, {});
crons.interval("late-fee-notices-and-collection", { hours: 1 }, internal.lateFees.processDue, {});
crons.interval("send-return-statements", { hours: 1 }, internal.invoice.retryReturnStatements, {});
crons.interval("renew-rental-security-holds", { hours: 1 }, internal.holdRenewal.renewDue, {});

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

// Demand is historical analytics, not live availability. Recompute daily
// rather than rereading the history during every 15-minute reservation sync.
crons.interval("refresh-rental-demand", { hours: 24 }, api.sync.refreshDemandFromRmv2, {});

// Sweep stale API rate-limit rows.
crons.interval("sweep-rate-limits", { hours: 24 }, internal.rateLimit.sweep, {});

// Notify "tell me when it's free" waiters whose item has opened up for their dates.
crons.interval("waitlist-check", { hours: 2 }, internal.waitlist.checkAndNotify, {});

// Keep "quiet deals" only on genuinely-owned, idle stock (re-checks ownership + demand).
crons.interval("refresh-quiet-deals", { hours: 12 }, api.catalog.refreshQuietDeals, {});

export default crons;
