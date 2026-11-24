const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { db, load, put } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "email-inbox-pagination-fixture";
const inbox = load("convex/emailInbox.ts");
const rows = Array.from({ length: 251 }, (_, index) => put("email_threads", {
  email: index === 250 ? "older-search-match@example.invalid" : `renter-${index}@example.invalid`,
  subject: index === 250 ? "Old rental conversation" : `Conversation ${index}`,
  status: "open",
  updatedAt: 10_000 - index,
  lastAt: 10_000 - index,
  lastDirection: "in",
  lastText: index === 250 ? "older-only phrase" : "Recent message",
  unreadOwner: 0,
}));

let paginateCalls = 0;
let rowsRead = 0;
const ctx = { db: Object.create(db) };
ctx.db.query = table => {
  assert.equal(table, "email_threads");
  const query = {
    withIndex(indexName) {
      assert.equal(indexName, "by_updated", "the inbox pages from its ordered index");
      return query;
    },
    order(direction) {
      assert.equal(direction, "desc");
      return query;
    },
    async paginate({ cursor, numItems }) {
      paginateCalls++;
      assert.ok(numItems <= 100, "a caller cannot request an unbounded page");
      const offset = cursor ? Number(cursor) : 0;
      const ordered = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
      const page = ordered.slice(offset, offset + numItems);
      rowsRead += page.length;
      const nextOffset = offset + page.length;
      const isDone = nextOffset >= ordered.length;
      return {
        page,
        isDone,
        continueCursor: isDone ? "" : String(nextOffset),
      };
    },
    take() {
      throw new Error("admin inbox must use bounded cursor pagination, not take()");
    },
  };
  return query;
};

(async () => {
  let cursor = null;
  let olderSearchMatch = null;
  let pageCount = 0;
  do {
    const result = await inbox.adminInboxPage.handler(ctx, {
      token: process.env.ADMIN_TOKEN,
      paginationOpts: { cursor, numItems: 50 },
    });
    assert.equal(result.authorized, true);
    pageCount++;
    olderSearchMatch ??= result.page.find(thread =>
      `${thread.email} ${thread.subject} ${thread.lastText}`.toLowerCase().includes("older-only phrase"),
    ) ?? null;
    cursor = result.continueCursor || null;
    if (result.isDone) break;
    assert.ok(cursor, "every non-final page exposes a continuation cursor");
  } while (pageCount < 10);

  assert.equal(pageCount, 6, "251 threads are reachable through six bounded pages of 50");
  assert.equal(rowsRead, 251, "each thread is read once across the cursor sequence");
  assert.ok(olderSearchMatch, "a search match on the oldest thread becomes reachable after loading older pages");
  assert.equal(paginateCalls, pageCount);

  const clamped = await inbox.adminInboxPage.handler(ctx, {
    token: process.env.ADMIN_TOKEN,
    paginationOpts: { cursor: null, numItems: 10_000 },
  });
  assert.equal(clamped.page.length, 100, "even a large requested page is capped at 100 rows");

  let unauthorizedReads = 0;
  const deniedCtx = { db: Object.create(ctx.db) };
  deniedCtx.db.query = () => { unauthorizedReads++; throw new Error("unauthorized query touched storage"); };
  const denied = await inbox.adminInboxPage.handler(deniedCtx, {
    token: "wrong-token",
    paginationOpts: { cursor: null, numItems: 50 },
  });
  assert.equal(denied.authorized, false);
  assert.deepEqual(denied.page, []);
  assert.equal(unauthorizedReads, 0, "unauthorized access does not read inbox rows");

  const component = fs.readFileSync(path.join(__dirname, "../src/components/admin/RentalInbox.tsx"), "utf8");
  const rentalConversation = fs.readFileSync(path.join(__dirname, "../src/components/rentals/RentalConversation.tsx"), "utf8");
  assert.match(component, /usePaginatedQuery\(\s*api\.emailInbox\.adminInboxPage/);
  assert.match(component, /emailPages\.loadMore\(50\)/);
  assert.match(component, /Search loaded emails · load older to search further/);
  assert.match(component, /visibleEmails\s*=\s*emailItems\s*\.filter/);
  assert.match(component, /!thread\.rentalConversation/);
  assert.match(component, /linkedEmailMatches/);
  assert.match(component, /openRenterConversation\(String\(rental\.accountId\), String\(rental\.bookingId\)\)/);
  assert.match(component, /onOpenRenterChat: \(accountId: string, bookingId\?: string\) => void/);
  assert.match(rentalConversation, /email-chat-reply-routing/);
  console.log("PASS admin email inbox pagination and routing: exact mirrored rental emails stay searchable and open the rental chat; unrelated emails remain standalone.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
