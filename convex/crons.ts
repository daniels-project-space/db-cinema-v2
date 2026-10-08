import { cronJobs } from "convex/server";
import { api, internal } from "./_generated/api";

const crons = cronJobs();

// Durable pickup scheduling recovery; requests only due/new-policy bookings.
crons.interval("pickup-rental-security-holds", { minutes: 5 }, internal.holdRenewal.pickupsDue, {});

// Release expired soft cart holds.
crons.interval("release-holds", { minutes: 5 }, internal.bookings.releaseExpiredHolds, {});

// Reconcile paid checkouts when webhooks are delayed; retire only Stripe-confirmed unpaid ones.
crons.interval("reconcile-rental-checkouts", { minutes: 5 }, internal.checkout.reconcilePendingPayments, {});
crons.interval("reconcile-requested-cancellations", { minutes: 5 }, internal.checkout.reconcileCancellations, {});

crons.interval("reconcile-rental-extensions",{minutes:5},internal.rentalExtensionPayments.reconcile,{});

crons.interval("reconcile-rental-additions",{minutes:5},internal.rentalAdditions.reconcile,{});
crons.interval("retry-owner-phone-alerts", { minutes: 5 }, internal.adminPushDelivery.retryDue, {});
crons.interval("retry-rental-account-links", { minutes: 5 }, internal.accountAccess.retryRentalAccess, {});

// Lapse membership perks with the real Stripe subscription (deactivates cancelled/unpaid members).
crons.interval("reconcile-memberships", { hours: 6 }, internal.checkout.reconcileMemberships, {});

// Expire old login sessions (enforces session TTL — queries can't read the clock).
crons.interval("sweep-sessions", { hours: 1 }, internal.accounts.sweepExpiredSessions, {});

// Pickup-tomorrow / return-today reminders (email + Telegram).
crons.interval("send-reminders", { hours: 12 }, internal.notify.sendReminders, {});
crons.daily("review-story-prize-deadlines", { hourUTC: 8, minuteUTC: 15 }, internal.reviewPrize.maintenance, {});
crons.interval("settled-rental-review-emails", { hours: 12 }, internal.reviewFollowUp.processDue, {});
crons.interval("late-fee-notices-and-collection", { hours: 1 }, internal.lateFees.processDue, {});
crons.interval("send-return-statements", { hours: 1 }, internal.invoice.retryReturnStatements, {});
// This is an expiry check, not a repeated charge. A hold is replaced only when it
// is within 24 hours of its issuer-provided expiry, so a six-hour cadence leaves
// several opportunities to resolve any authentication request for long rentals.
crons.interval("renew-rental-security-holds", { hours: 6 }, internal.holdRenewal.renewDue, {});
crons.interval("reconcile-rental-verifications", { hours: 1 }, internal.didit.reconcileOpenSessions, {});
crons.interval("archive-verification-documents", { minutes: 5 }, internal.verificationArchiveWorker.retryDue, {});
crons.interval("retry-rental-manager-delivery", { minutes: 1 }, internal.rmv2_webhook.retryDue, {});
crons.interval("purge-expired-verification-documents", { hours: 24 }, internal.verificationArchive.purgeExpired, {});

crons.interval("expire-rental-verifications", { hours: 1 }, internal.bookings.expireRentalVerifications, {});

// Expire store credit past its one-year window (Phase 3).
crons.interval("expire-credits", { hours: 24 }, internal.credits.expire, {});

// Keep the storefront catalog fresh from RMv2 (listings, pricing, images-source).
crons.interval("sync-rmv2-catalog", { minutes: 30 }, api.sync.syncFromRmv2, {});

// Mirror all upstream shared stock, repair holds and owner blocks. Website
// reservations stay local; their manager copies are excluded to avoid duplication.
// Precise stock expires after five minutes: two-minute polling tolerates one
// missed refresh without making every intraday release fall back to whole days.
crons.interval(
  "sync-hygglo-reservations",
  { minutes: 2 },
  api.sync.syncHyggloReservations,
  {},
);

// Demand is historical analytics, not live availability. Recompute daily
// rather than rereading the history during every reservation sync.
crons.interval("refresh-rental-demand", { hours: 24 }, api.sync.refreshDemandFromRmv2, {});

// Sweep stale API rate-limit rows.
crons.interval("sweep-rate-limits", { hours: 24 }, internal.rateLimit.sweep, {});

// Notify "tell me when it's free" waiters whose item has opened up for their dates.
crons.interval("waitlist-check", { minutes: 15 }, internal.waitlist.checkAndNotify, {});

// Keep "quiet deals" only on genuinely-owned, idle stock (re-checks ownership + demand).
crons.interval("refresh-quiet-deals", { hours: 12 }, api.catalog.refreshQuietDeals, {});

crons.interval("consented-checkout-reminders", { minutes: 15 }, internal.checkoutRecoveryMail.processDue, {});
crons.interval("consented-film-fund-opening", { minutes: 15 }, internal.filmFundNotifications.processOpeningAnnouncements, {});

crons.interval("expire-referral-vouchers",{hours:1},internal.referrals.expire,{});
crons.interval("reconcile-completed-referrals",{hours:1},internal.referrals.reconcile,{});
crons.interval("referral-campaign-delivery",{minutes:5},internal.referralMail.sendCampaign,{});
crons.interval("renter-push-recovery", { minutes: 2 }, internal.renterPushDelivery.retryDue, {});
crons.interval("admin-push-recovery", { minutes: 2 }, internal.adminPushDelivery.retryDue, {});
export default crons;
