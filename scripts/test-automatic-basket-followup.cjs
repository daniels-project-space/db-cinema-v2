/** Opt-in basket reminders through real mutations/worker with fake clock and mail; no provider writes. */
const assert = require("node:assert/strict");
const h = require("./lib/rentalTestHarness.cjs");
const recovery = h.load("convex/checkoutRecovery.ts");
const lib = h.load("convex/lib/checkoutRecovery.ts");
const promo = h.load("convex/promo.ts");
const originalNow = Date.now;
let now = Date.parse("2026-10-09T12:00:00Z");
Date.now = () => now;

const makeAccount = (email, token) => {
  const account = h.put("accounts", { email });
  h.put("sessions", { token, accountId: account._id, expiresAt: now + 30 * 86400000 });
  return account;
};
const owner = makeAccount("owner@example.invalid", "owner");
const listing = h.put("listings", {
  title: "Marketing cinema kit",
  active: true,
  marketingOnly: true,
  displayOnly: true,
  components: [],
  pricing: { daily: 50 },
});
const lines = [{
  listingId: listing._id,
  qty: 1,
  start: Date.parse("2026-11-01T00:00Z"),
  end: Date.parse("2026-11-02T00:00Z"),
  pickupTime: "18:00",
  returnTime: "09:00",
}];
const ctx = { db: h.db };
let mailResult = true;
const deliveries = [];
h.setMock("./lib/mailer", { sendMail: async (message) => { deliveries.push(message); return mailResult; } });
const mail = h.load("convex/checkoutRecoveryMail.ts");
const worker = {
  runQuery: (ref, args) => recovery[ref.split(".").at(-1)].handler(ctx, args),
  runMutation: (ref, args) => recovery[ref.split(".").at(-1)].handler(ctx, args),
};
const runDue = () => mail.processDue.handler(worker, {});

(async () => {
  process.env.CHECKOUT_RECOVERY_ENABLED = "true";
  process.env.RENTAL_CHECKOUT_ENABLED = "true";

  const recoveryCode = await promo.validate.handler(ctx, { code: "DBC10OFF", eligibleSubtotal: 123.45, rentalSubtotal: 123.45, email: owner.email });
  assert.equal(recoveryCode.valid, true);
  assert.equal(recoveryCode.discount, 12.35, "DBC10OFF discounts eligible rental charges by ten percent");
  assert.equal((await promo.validate.handler(ctx, { code: "DBC10OFF", eligibleSubtotal: 100, email: owner.email })).valid, true);
  assert.equal((await promo.validate.handler(ctx, { code: "DBC10OFF", eligibleSubtotal: 100 })).valid, false, "A one-use email code requires an email identity");

  await assert.rejects(() => recovery.sync.handler(ctx, { token: "missing", lines }), /sign in/);
  assert.equal(await recovery.sync.handler(ctx, { token: "owner", lines }), null, "A populated basket without explicit opt-in creates no email recovery");
  assert.deepEqual(await recovery._due.handler(ctx, {}), [], "No reminder is scheduled without consent");

  const id = await recovery.sync.handler(ctx, { token: "owner", lines, emailFollowupConsent: true });
  const row = await h.db.get(id);
  const originalConsentAt = row.emailFollowupConsentAt;
  assert.equal(row.accountId, owner._id);
  assert.equal(row.followupStage, "day_one");
  assert.equal(row.dueAt, now + 86400000, "First reminder is scheduled one day after abandonment");
  const resumed = await recovery.resume.handler(ctx, { token: "owner", id });
  assert.equal(resumed.emailFollowupsEnabled, true);
  assert.deepEqual(resumed.lines, lines);
  assert.deepEqual(await recovery.resume.handler(ctx, { token: "owner", id }), resumed, "Repeated reads do not create duplicate recovery rows");
  assert.equal((await recovery.mine.handler(ctx, { token: "owner" }))?._id, id, "The owner can read their own checkout recovery");
  makeAccount("unrelated@example.invalid", "unrelated");
  assert.equal(await recovery.mine.handler(ctx, { token: "unrelated" }), null, "A different account cannot read the owner's checkout recovery");
  await assert.rejects(() => recovery.mine.handler(ctx, { token: "missing" }), /sign in/i, "A missing account token cannot read checkout recovery");

  const unchangedDue = row.dueAt;
  now += 60 * 1000;
  assert.equal(await recovery.sync.handler(ctx, { token: "owner", enabled: false, lines, emailFollowupConsent: true }), id);
  assert.equal(row.dueAt, unchangedDue, "Repeated opted-in sync does not duplicate or prematurely reschedule the reminder");
  now = originalConsentAt + 23 * 60 * 60 * 1000;
  assert.equal(await recovery._claim.handler(ctx, { id }), null, "No day-one reminder is claimed early");
  now += 60 * 60 * 1000;

  mailResult = false;
  assert.equal((await runDue()).sent, 0, "A failed delivery is not counted as sent");
  assert.equal(row.state, "waiting");
  assert.equal(row.followupStage, "day_one");
  assert.equal(row.attempts, 1);
  assert(row.dueAt > now, "A failed delivery is retried with backoff");
  const firstAttemptKey = deliveries.at(-1).deliveryKey;
  assert.match(firstAttemptKey, new RegExp(`${id}-day_one-${originalConsentAt}-${row.updatedAt}`));

  now = row.dueAt;
  mailResult = true;
  assert.equal((await runDue()).sent, 1);
  const dayOneMail = deliveries.at(-1);
  assert.equal(dayOneMail.deliveryKey, firstAttemptKey, "Provider retries reuse a stable idempotency key");
  assert.equal(dayOneMail.to, owner.email);
  assert(dayOneMail.html.includes(`/plan?recovery=${id}`));
  assert(dayOneMail.html.includes("equipment is not reserved"));
  assert(dayOneMail.html.includes("turn off future reminders"));
  assert(!dayOneMail.html.includes("DBC10OFF"), "The recovery code is withheld from the day-one email");
  assert.equal(row.state, "waiting");
  assert.equal(row.followupStage, "week_one");
  assert.equal(row.dueAt, row.updatedAt + 7 * 86400000, "Second reminder is one week after the last basket activity");

  const weekDue = row.dueAt;
  now = weekDue - 1;
  assert.equal(await recovery._claim.handler(ctx, { id }), null, "Week-one reminder is not claimed early");
  now = weekDue;
  assert.equal((await runDue()).sent, 1);
  const weekOneMail = deliveries.at(-1);
  assert.notEqual(weekOneMail.deliveryKey, dayOneMail.deliveryKey, "Each stage has a distinct provider idempotency key");
  assert.match(weekOneMail.deliveryKey, new RegExp(`${id}-week_one-${originalConsentAt}-${row.updatedAt}`));
  assert(weekOneMail.html.includes("DBC10OFF"), "The one-week email includes the working recovery code");
  assert(weekOneMail.html.includes("10% off eligible rental charges"));
  await h.db.insert("promo_redemptions", { email: owner.email, code: "dbc10off", at: now });
  assert.equal((await promo.validate.handler(ctx, { code: "DBC10OFF", eligibleSubtotal: 100, email: owner.email })).valid, false, "A redeemed code cannot be reused on a later rental");
  assert.equal(row.followupStage, "complete");
  assert.equal(row.state, "sent");
  assert.equal((await runDue()).sent, 0, "Completed reminder stages are never sent twice");

  const changedLines = [{ ...lines[0], pickupTime: "19:00" }];
  await recovery.sync.handler(ctx, { token: "owner", lines: changedLines, emailFollowupConsent: false });
  assert.equal(row.emailFollowupConsentAt, undefined, "Opting out removes active follow-up consent");
  assert.equal(row.followupStage, "complete");
  await recovery.sync.handler(ctx, { token: "owner", lines: [] });
  assert.equal(row.state, "stopped", "Clearing the basket suppresses all future stages");

  const reoptInId = await recovery.sync.handler(ctx, { token: "owner", lines: changedLines, emailFollowupConsent: true });
  const reopted = await h.db.get(reoptInId);
  assert.equal(reopted.followupStage, "day_one");
  assert.equal(reopted.dueAt, now + 86400000, "A later explicit opt-in starts a new two-stage schedule");
  const newerConsentAt = reopted.emailFollowupConsentAt;
  assert(newerConsentAt > originalConsentAt);
  assert.equal(await recovery.sync.handler(ctx, { token: "owner", lines: changedLines, emailFollowupConsent: true }), reoptInId, "Repeat opt-in reuses one row");

  const claimed = await recovery._claim.handler(ctx, { id: reoptInId });
  assert.equal(claimed, null, "A newly opted-in row is not due early");
  const raceLines = [{ ...changedLines[0], returnTime: "10:00" }];
  const raceOwner = makeAccount("race@example.invalid", "race");
  const raceId = await recovery.sync.handler(ctx, { token: "race", lines: raceLines, emailFollowupConsent: true });
  now = (await h.db.get(raceId)).dueAt;
  const lease = await recovery._claim.handler(ctx, { id: raceId });
  assert(lease);
  assert.equal(await recovery._claim.handler(ctx, { id: raceId }), null, "Concurrent workers cannot claim the same lease");
  assert(await recovery._ready.handler(ctx, lease));
  await recovery.sync.handler(ctx, { token: "race", lines: [{ ...raceLines[0], pickupTime: "20:00" }], emailFollowupConsent: true });
  assert.equal(await recovery._ready.handler(ctx, lease), false, "Basket edits fence an already claimed delivery");
  await recovery._finish.handler(ctx, { id: raceId, leaseUntil: lease.leaseUntil, sent: true, stage: lease.stage, updatedAt: lease.updatedAt, emailFollowupConsentAt: lease.emailFollowupConsentAt });
  assert.equal((await h.db.get(raceId)).followupStage, "day_one", "Stale worker completion cannot consume edited work");
  assert.equal((await h.db.get(raceId)).accountId, raceOwner._id);

  const paymentRaceOwner = makeAccount("payment-race@example.invalid", "payment-race");
  const paymentRaceId = await recovery.sync.handler(ctx, { token: "payment-race", lines, emailFollowupConsent: true });
  now = (await h.db.get(paymentRaceId)).dueAt;
  const paymentRaceLease = await recovery._claim.handler(ctx, { id: paymentRaceId });
  assert(paymentRaceLease);
  const paymentRaceBooking = h.put("bookings", { accountId: paymentRaceOwner._id, guestEmail: paymentRaceOwner.email, lineItems: lines, status: "pending_payment" });
  assert.equal(await recovery._ready.handler(ctx, paymentRaceLease), false, "A checkout created after the email lease stops a stale basket reminder");
  paymentRaceBooking.status = "confirmed";
  assert.equal(await recovery._ready.handler(ctx, paymentRaceLease), false, "A paid booking created after the email lease cannot receive a stale basket reminder");
  paymentRaceBooking.status = "cancelled";
  paymentRaceBooking.checkoutExpiredAt = now;
  assert.equal(await recovery._ready.handler(ctx, paymentRaceLease), true, "An attested unpaid expired checkout remains recoverable");

  const workerRaceOwner = makeAccount("worker-payment-race@example.invalid", "worker-payment-race");
  const workerRaceId = await recovery.sync.handler(ctx, { token: "worker-payment-race", lines, emailFollowupConsent: true });
  now = (await h.db.get(workerRaceId)).dueAt;
  const sentBeforePaymentRace = deliveries.length;
  const racingWorker = {
    runQuery: (ref, args) => {
      if (ref.endsWith("._due")) return [{ _id: workerRaceId }];
      if (ref.endsWith("._ready")) h.put("bookings", { accountId: workerRaceOwner._id, guestEmail: workerRaceOwner.email, lineItems: lines, status: "confirmed" });
      return recovery[ref.split(".").at(-1)].handler(ctx, args);
    },
    runMutation: worker.runMutation,
  };
  assert.equal((await mail.processDue.handler(racingWorker, {})).sent, 0, "A paid booking that appears between claim and readiness is not emailed");
  assert.equal(deliveries.length, sentBeforePaymentRace, "The email transport is not invoked after the payment race is detected");

  const optOutOwner = makeAccount("optout@example.invalid", "optout");
  const optOutId = await recovery.sync.handler(ctx, { token: "optout", lines, emailFollowupConsent: true });
  const optOutRow = await h.db.get(optOutId);
  const optOutConsentAt = optOutRow.emailFollowupConsentAt;
  now = optOutRow.dueAt;
  const optOutLease = await recovery._claim.handler(ctx, { id: optOutId });
  assert(optOutLease);
  assert.equal(await recovery.disableFollowups.handler(ctx, { token: "owner", id: optOutId }), false, "Another account cannot unsubscribe from a recovery it does not own");
  assert.equal(optOutRow.state, "waiting", "A foreign unsubscribe token does not change the owner's recovery state");
  assert.equal(optOutRow.emailFollowupConsentAt, optOutConsentAt, "A foreign unsubscribe token preserves the owner's consent state");
  assert.equal(await recovery.disableFollowups.handler(ctx, { token: "optout", id: optOutId }), true);
  assert.equal(await recovery._ready.handler(ctx, optOutLease), false, "Unsubscribe invalidates an in-flight email lease");
  assert.equal((await recovery.resume.handler(ctx, { token: "optout", id: optOutId })).emailFollowupsEnabled, false);
  assert.equal(optOutRow.emailFollowupConsentAt, undefined);
  assert.equal(optOutOwner._id, optOutRow.accountId);

  const convertedOwner = makeAccount("converted@example.invalid", "converted");
  const convertedLines = [{ ...lines[0], end: Date.parse("2026-11-03T00:00Z") }];
  const convertedId = await recovery.sync.handler(ctx, { token: "converted", lines: convertedLines, emailFollowupConsent: true });
  const convertedRow = await h.db.get(convertedId);
  const confirmed = h.put("bookings", { accountId: convertedOwner._id, guestEmail: convertedOwner.email, status: "confirmed", lineItems: convertedLines });
  await lib.stopMatchingRecovery(ctx, convertedOwner.email, convertedLines, confirmed._id);
  assert.equal(convertedRow.state, "stopped", "A converted confirmed rental suppresses all recovery email");
  assert.equal(await recovery._claim.handler(ctx, { id: convertedId }), null);

  const pendingOwner = makeAccount("pending@example.invalid", "pending");
  const pendingId = await recovery.sync.handler(ctx, { token: "pending", lines: [{ ...lines[0], end: Date.parse("2026-11-04T00:00Z") }], emailFollowupConsent: true });
  const pendingLines = (await h.db.get(pendingId)).lines;
  h.put("bookings", { accountId: pendingOwner._id, guestEmail: pendingOwner.email, status: "pending_payment", lineItems: pendingLines });
  const pendingRow = await h.db.get(pendingId);
  now = pendingRow.dueAt;
  assert.equal(await recovery._claim.handler(ctx, { id: pendingId }), null, "An in-flight booking defers follow-up, not falsely marks it sent");
  assert.equal(pendingRow.state, "waiting");

  const verifyingOwner = makeAccount("verifying@example.invalid", "verifying");
  const verifyingLines = [{ ...lines[0], end: Date.parse("2026-11-08T00:00Z") }];
  const verifyingId = await recovery.sync.handler(ctx, { token: "verifying", lines: verifyingLines, emailFollowupConsent: true });
  const verifyingRow = await h.db.get(verifyingId);
  h.put("bookings", { accountId: verifyingOwner._id, guestEmail: verifyingOwner.email, status: "pending_verification", checkoutPaidAt: now, lineItems: verifyingLines });
  now = verifyingRow.dueAt;
  const mailCountBeforePaidVerification = deliveries.length;
  assert.equal(await recovery._claim.handler(ctx, { id: verifyingId }), null, "A paid rental awaiting verification is not treated as abandoned");
  assert.equal(verifyingRow.state, "stopped", "A paid pending-verification booking permanently suppresses basket follow-up");
  assert.equal(deliveries.length, mailCountBeforePaidVerification, "No recovery email is sent for a paid pending-verification rental");

  const blocked = makeAccount("blocked@example.invalid", "blocked");
  const blockedId = await recovery.sync.handler(ctx, { token: "blocked", lines, emailFollowupConsent: true });
  await h.db.patch(blocked._id, { blockedAt: now });
  now = (await h.db.get(blockedId)).dueAt;
  assert.equal(await recovery._claim.handler(ctx, { id: blockedId }), null);
  assert.equal((await h.db.get(blockedId)).state, "stopped", "Blocked accounts are suppressed");

  const unverified = makeAccount("unverified@example.invalid", "unverified");
  const unverifiedId = await recovery.sync.handler(ctx, { token: "unverified", lines, emailFollowupConsent: true });
  await h.db.patch(unverified._id, { emailVerificationRequired: true });
  now = (await h.db.get(unverifiedId)).dueAt;
  assert.equal(await recovery._claim.handler(ctx, { id: unverifiedId }), null);
  assert.equal((await h.db.get(unverifiedId)).state, "stopped", "Unverified email addresses are suppressed");

  const paused = makeAccount("paused@example.invalid", "paused");
  const pausedId = await recovery.sync.handler(ctx, { token: "paused", lines, emailFollowupConsent: true });
  now = (await h.db.get(pausedId)).dueAt;
  process.env.RENTAL_CHECKOUT_ENABLED = "false";
  assert.deepEqual(await recovery._due.handler(ctx, {}), []);
  assert.equal(await recovery._claim.handler(ctx, { id: pausedId }), null, "Paused checkout never emits reminders");
  process.env.RENTAL_CHECKOUT_ENABLED = "true";

  const recoveryPaused = makeAccount("recovery-paused@example.invalid", "recovery-paused");
  const recoveryPausedId = await recovery.sync.handler(ctx, { token: "recovery-paused", lines: [{ ...lines[0], end: Date.parse("2026-11-09T00:00Z") }], emailFollowupConsent: true });
  const recoveryPausedRow = await h.db.get(recoveryPausedId);
  now = recoveryPausedRow.dueAt;
  process.env.CHECKOUT_RECOVERY_ENABLED = "false";
  assert.deepEqual(await recovery._due.handler(ctx, {}), [], "The dedicated recovery kill switch suppresses the entire due queue");
  assert.equal(await recovery._claim.handler(ctx, { id: recoveryPausedId }), null, "The dedicated recovery kill switch prevents a claim");
  assert.equal(recoveryPausedRow.state, "waiting", "Pausing recovery preserves consented work for a later safe resume");
  process.env.CHECKOUT_RECOVERY_ENABLED = "true";
  assert.equal(recoveryPaused._id, recoveryPausedRow.accountId);

  const recycledMailbox = makeAccount("owner@example.invalid", "recycled");
  const unrelated = await recovery.sync.handler(ctx, { token: "recycled", lines: [{ ...lines[0], end: Date.parse("2026-11-06T00:00Z") }], emailFollowupConsent: true });
  assert(unrelated, "A recycled email cannot inherit another account's permanent booking state");
  assert.equal((await h.db.get(unrelated)).accountId, recycledMailbox._id);

  console.log("PASS opt-in day-one/week-one basket recovery: explicit consent, exact stages, unsubscribe, idempotent retry and stage keys, activity/lease fencing, conversion and pending-payment suppression, blocked/unverified account suppression, checkout pause, ownership and private resume. No provider writes.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  Date.now = originalNow;
});
