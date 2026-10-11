const assert = require("node:assert/strict");
const fs = require("node:fs");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
const chats = load("convex/rentalChat.ts");
process.env.ADMIN_TOKEN = "fixture-renter-clock";
const account = put("accounts", { email: "clock@example.invalid", name: "Fixture clock" });
const booking = put("bookings", { accountId: account._id, status: "pending_payment", lineItems: [], total: 20 });
const thread = put("chat_threads", { accountId: account._id, bookingId: booking._id, lastMessage: "Owner follow-up", lastSender: "owner", updatedAt: 900 });
let indexedReads = 0;
const ctx = {
  db: { ...db, query(table) {
    const query = db.query(table), bind = query.withIndex.bind(query);
    query.withIndex = (name, callback) => {
      const indexed = bind(name, callback);
      if (name === "by_booking_account_sender_at") {
        indexedReads++;
        // The shared fixture first() does not emulate descending index order.
        indexed.first = async () => (await indexed.take(1))[0] ?? null;
        indexed.collect = async () => { throw Error("Unbounded clock read"); };
      }
      return indexed;
    };
    return query;
  } },
  storage: { getUrl: async () => null },
};
async function read() {
  const before = JSON.stringify([...tables]), reads = indexedReads;
  const feed = await chats.adminInbox.handler(ctx, { token: process.env.ADMIN_TOKEN });
  assert.equal(indexedReads - reads, 1, "one indexed clock point read per rental");
  assert.equal(JSON.stringify([...tables]), before, "clock inspection never changes source messages or rentals");
  return feed.items[0];
}
(async () => {
  const denied = await chats.adminInbox.handler(ctx, { token: "wrong" });
  assert.equal(denied.authorized, false);
  assert.equal(indexedReads, 0);
  assert.equal((await read()).lastRenterAt, booking._creationTime, "no-message request has a stable creation clock");
  put("messages", { accountId: account._id, bookingId: booking._id, sender: "renter", text: "Original enquiry", at: 100 });
  put("messages", { accountId: account._id, bookingId: booking._id, sender: "renter", text: "Follow-up", at: 200 });
  put("messages", { accountId: "foreign-account", bookingId: booking._id, sender: "renter", text: "Foreign", at: 9999 });
  for (let i = 0; i < 75; i++) put("messages", { accountId: account._id, bookingId: booking._id, sender: ["owner", "system", "bot"][i % 3], text: "Non-renter activity", at: 300 + i });
  assert.equal((await read()).lastRenterAt, 200, "genuine renter survives beyond preview transcript without foreign or owner activity");
  thread.updatedAt = 1000;
  assert.equal((await read()).lastRenterAt, 200);
  put("messages", { accountId: account._id, bookingId: booking._id, sender: "renter", text: "New enquiry", at: 1100 });
  assert.equal((await read()).lastRenterAt, 1100);
  assert(fs.readFileSync("convex/schema.ts", "utf8").includes('.index("by_booking_account_sender_at", ["bookingId", "accountId", "sender", "at"])'));
  console.log("PASS actual admin inbox renter-only clock: bounded index, >40 owner/bot/system messages, foreign account isolation, request creation fallback, new renter restoration and zero source writes.");
})().catch(error => { console.error(error); process.exitCode = 1; });
