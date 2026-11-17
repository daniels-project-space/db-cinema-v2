const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");

const accounts = load("convex/accounts.ts");
const now = Date.now();
const rows = [];
const byId = new Map();
const queued = [];
const pageCaps = [];
const raceId = "accounts-000-race";
let raceOnce = true;
function add(id, expiresAt) {
  const row = { _id: id, idVerified: true, rentalVerification: { sourceBookingId: `bookings-${id}`, verifiedAt: expiresAt - 90 * 86400000, expiresAt } };
  rows.push(row);
  byId.set(id, row);
  return row;
}

// More than one bounded batch, including an exactly-expired badge.
const race = add(raceId, now - 1);
for (let index = 1; index < 51; index++) add(`accounts-${String(index).padStart(3, "0")}`, now - 1);
const exact = add("accounts-051-exact", now);
const future = add("accounts-052-future", now + 86400000);
const activeBooking = { _id: "bookings-active", status: "active", idVerifyStatus: "verified", verificationExpiresAt: now - 1 };
const confirmedBooking = { _id: "bookings-confirmed", status: "confirmed", idVerifyStatus: "verified", verificationExpiresAt: now - 1 };

function expiry(row) { return row.rentalVerification?.expiresAt; }
function compare(left, right) { return expiry(left) - expiry(right) || String(left._id).localeCompare(String(right._id)); }
const db = {
  query(table) {
    assert.equal(table, "accounts", "the cleanup reads accounts only");
    let candidates = [...rows];
    return {
      withIndex(name, filter) {
        assert.equal(name, "by_rental_verification_expiry", "the query must use the expiry index");
        const predicate = { lte(field, value) { assert.equal(field, "rentalVerification.expiresAt"); candidates = candidates.filter(row => expiry(row) <= value); return predicate; } };
        filter(predicate);
        return this;
      },
      order(direction) { assert.equal(direction, "asc"); candidates.sort(compare); return this; },
      async paginate({ cursor, numItems, maximumRowsRead }) {
        pageCaps.push({ numItems, maximumRowsRead });
        const boundary = cursor ? JSON.parse(cursor) : null;
        const afterBoundary = boundary ? candidates.filter(row => compare(row, { _id: boundary[1], rentalVerification: { expiresAt: boundary[0] } }) > 0) : candidates;
        const page = afterBoundary.slice(0, numItems).map(row => ({ ...row, rentalVerification: { ...row.rentalVerification } }));
        const last = page.at(-1);
        return {
          page,
          isDone: afterBoundary.length <= numItems,
          continueCursor: last ? JSON.stringify([expiry(last), last._id]) : cursor ?? "",
        };
      },
    };
  },
  async get(id) {
    if (id === raceId && raceOnce) {
      raceOnce = false;
      // Simulate an approved renewal landing after the indexed page snapshot.
      race.rentalVerification = { ...race.rentalVerification, verifiedAt: now, expiresAt: now + 90 * 86400000 };
    }
    return byId.get(id) ?? null;
  },
  async patch(id, patch) { Object.assign(byId.get(id), patch); },
};
const ctx = { db, scheduler: { runAfter: async (_delay, reference, args) => queued.push({ reference: String(reference), args }) } };

(async () => {
  let result = await accounts.purgeExpiredRentalVerification.handler(ctx, {});
  assert.equal(result.hasMore, true, "large cleanup continues in another bounded page");
  assert.equal(result.cleared, 49, "expired records from page one are deleted; the concurrently renewed grant is preserved");
  assert.equal(race.rentalVerification.expiresAt, now + 90 * 86400000, "a renewed grant cannot be cleared by a stale page snapshot");
  assert.equal(race.idVerified, true);
  assert.equal(queued.length, 1);
  assert.match(queued[0].reference, /accounts\.purgeExpiredRentalVerification/);
  while (queued.length) {
    const job = queued.shift();
    result = await accounts.purgeExpiredRentalVerification.handler(ctx, job.args);
  }

  assert.equal(exact.rentalVerification, undefined, "an expiry at the exact cutoff is no longer reusable");
  assert.equal(exact.idVerified, false);
  assert.equal(future.rentalVerification.expiresAt, now + 86400000, "future grants remain available");
  assert.equal(future.idVerified, true);
  assert.equal(rows.filter(row => row.rentalVerification === undefined).length, 51, "all eligible records are eventually removed across pages; the concurrently renewed grant is retained");
  assert.equal(activeBooking.idVerifyStatus, "verified", "the active rental's own provider approval is preserved");
  assert.equal(activeBooking.verificationExpiresAt, now - 1);
  assert.equal(confirmedBooking.idVerifyStatus, "verified", "the confirmed rental's own provider approval is preserved");
  assert(pageCaps.every(cap => cap.numItems === 50 && cap.maximumRowsRead === 50), "every page has an explicit 50-row bound");
  console.log("PASS expired account verification cleanup: indexed 50-row pages, expiry cutoff, renewal concurrency guard, future grants, and unchanged confirmed/active booking approvals.");
})().catch(error => { console.error(error); process.exitCode = 1; });
