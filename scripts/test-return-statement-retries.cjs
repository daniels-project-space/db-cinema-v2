/** Bounded indexed return-email retries rotate through work without a returned-booking scan. */
const assert = require("node:assert/strict");
const h = require("./lib/rentalTestHarness.cjs");
const bookings = h.load("convex/bookings.ts");

let now = Date.UTC(2030, 0, 1);
const originalNow = Date.now;
Date.now = () => now;
const indexReads = [], takeLimits = [];
const db = {
  ...h.db,
  query(table) {
    const query = h.db.query(table);
    const withIndex = query.withIndex.bind(query);
    query.withIndex = (name, range) => {
      indexReads.push(name);
      return withIndex(name, range);
    };
    const take = query.take.bind(query);
    query.take = async (limit) => {
      takeLimits.push(limit);
      return take(limit);
    };
    return query;
  },
};
const ctx = { db };

function add(status, count, attemptAt) {
  return Array.from({ length: count }, (_, index) => h.put("bookings", {
    status: "returned",
    returnStatement: { number: `DBC-R-${status}-${index}` },
    returnStatementEmailStatus: status,
    ...(attemptAt ? { returnStatementEmailAttemptAt: attemptAt(index) } : {}),
  }));
}

(async () => {
  try {
    const pending = add("pending", 45);
    const failed = add("failed", 45, index => now - 10_000 - index);
    const stale = add("sending", 25, index => now - 60 * 60_000 - index);
    add("sending", 5, () => now - 5 * 60_000);
    const unknown = add("delivery_unknown", 3);

    const first = await bookings.dueReturnStatementEmails.handler(ctx, {});
    assert.equal(first.length, 60, "three state lanes each return at most one bounded batch");
    assert.deepEqual(first.slice(0, 20), pending.slice(0, 20).map(row => row._id));
    assert.deepEqual(first.slice(20, 40), failed.slice(0, 20).map(row => row._id));
    assert.deepEqual(first.slice(40), stale.slice(0, 20).map(row => row._id));
    assert(!first.some(id => unknown.some(row => row._id === id)), "delivery-unknown rows are excluded from automatic sends");
    assert.deepEqual(takeLimits, [20, 20, 20]);
    assert.deepEqual(indexReads, Array(3).fill("by_status_return_statement_email_attempt"));

    // Claiming advances each row out of its old position/state, so the next
    // sweep reaches the remaining pending and failed messages plus stale leases.
    for (const bookingId of first) {
      assert.equal(await bookings.claimReturnStatementEmail.handler(ctx, { bookingId }), true);
    }
    const second = await bookings.dueReturnStatementEmails.handler(ctx, {});
    assert.equal(second.length, 45);
    assert.deepEqual(second.slice(0, 20), pending.slice(20, 40).map(row => row._id));
    assert.deepEqual(second.slice(20, 40), failed.slice(20, 40).map(row => row._id));
    assert.deepEqual(second.slice(40), stale.slice(20).map(row => row._id));
    assert(!second.some(id => id === pending[0]._id || id === failed[0]._id), "claimed work does not monopolise the next batch");
    assert(!second.some(id => id === stale[0]._id), "active sending leases are excluded after their timestamp advances");
    assert(takeLimits.every(limit => limit === 20), "all reads stay bounded");
    assert(indexReads.every(index => index === "by_status_return_statement_email_attempt"), "no full returned-bookings scan is used");
    console.log("PASS return email retry scan: indexed batches are capped at 20 per state, stale leases only, and repeated failures cannot starve later rows.");
  } finally {
    Date.now = originalNow;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
