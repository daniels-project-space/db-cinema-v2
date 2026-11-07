const assert = require("node:assert/strict");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");
const { renterValueBookings, attachRenterPerson } = load("convex/lib/rentalExposure.ts");
const owner = put("accounts", { email: "new-owner@example.invalid" });
const reusedMailbox = put("accounts", { email: "old-owner@example.invalid", renterPersonKey: "different-person" });
const original = put("bookings", { accountId: owner._id, guestEmail: reusedMailbox.email, status: "confirmed" });
const ownOtherEmail = put("bookings", { accountId: owner._id, guestEmail: owner.email, status: "active" });
const ownLegacy = put("bookings", { guestEmail: owner.email, status: "confirmed" });
const foreign = put("bookings", { accountId: reusedMailbox._id, guestEmail: reusedMailbox.email, status: "confirmed" });
const oldUnlinked = put("bookings", { guestEmail: reusedMailbox.email, status: "confirmed" });
const ctx = { db };

(async () => {
  const initial = await renterValueBookings(ctx, original);
  assert.equal(initial.personKey, undefined, "a recycled email address cannot supply the linked renter's identity");
  assert.deepEqual(new Set(initial.rows.map(row => row._id)), new Set([original._id, ownOtherEmail._id, ownLegacy._id]));
  await attachRenterPerson(ctx, original, "verified-owner");
  assert.equal(owner.renterPersonKey, "verified-owner");
  assert.equal(ownOtherEmail.renterPersonKey, "verified-owner");
  assert.equal(ownLegacy.renterPersonKey, "verified-owner");
  assert.equal(reusedMailbox.renterPersonKey, "different-person");
  assert.equal(foreign.renterPersonKey, undefined);
  assert.equal(oldUnlinked.renterPersonKey, undefined);
  const samePerson = put("bookings", { accountId: reusedMailbox._id, guestEmail: reusedMailbox.email, status: "confirmed", renterPersonKey: "verified-owner" });
  assert((await renterValueBookings(ctx, original)).rows.some(row => row._id === samePerson._id), "provider-attested identity still links overlapping rentals across accounts");
  await assert.rejects(renterValueBookings(ctx, { accountId: "accounts-missing", guestEmail: reusedMailbox.email }), /account needs a team check/);
  console.log("PASS rental identity ownership: changed email, recycled mailbox, legacy bookings and provider-attested cross-account exposure.");
})().catch(error => { console.error(error); process.exitCode = 1; });
