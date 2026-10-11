const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
const { page, __bookingPage } = load("convex/rentalChatSearch.ts");
process.env.ADMIN_TOKEN = "fixture-owner-only";
const token = process.env.ADMIN_TOKEN;
const account = put("accounts", { name: "Fixture account" });
const booking = put("bookings", { accountId: account._id });
for (let i = 0; i < 65; i++)
  put("messages", {
    accountId: account._id,
    bookingId: booking._id,
    sender: "renter",
    text:
      i === 3
        ? "acetate screening"
        : i === 21
          ? "Café pickup"
          : "ordinary recent text",
    at: i,
    readByOwner: false,
  });
put("messages", {
  accountId: "foreign-account",
  bookingId: booking._id,
  sender: "renter",
  text: "foreign secret",
  at: 9999,
});
const ctx = {
  runQuery: async (ref, args) => {
    let reads = 0;
    const scopedDb = {
      ...db,
      query: (table) => {
        const query = db.query(table);
        const bind = query.withIndex.bind(query);
        query.withIndex = (...args) => {
          const indexed = bind(...args);
          const paginate = indexed.paginate.bind(indexed);
          indexed.paginate = (...opts) => {
            assert.equal(++reads, 1, "one pagination per query");
            return paginate(...opts);
          };
          return indexed;
        };
        return query;
      },
    };
    return __bookingPage.handler({ db: scopedDb }, args);
  },
};
(async () => {
  const before = JSON.stringify(
    [...tables].map(([name, rows]) => [name, [...rows.values()]]),
  );
  await assert.rejects(
    page.handler(ctx, { token: "foreign", requests: [] }),
    /Unauthorized/,
  );
  let terms = ["café", "acetate"],
    cursor = null,
    result,
    calls = 0;
  do {
    [result] = await page.handler(ctx, {
      token,
      requests: [{ bookingId: booking._id, terms, cursor }],
    });
    terms = result.remaining;
    cursor = result.cursor;
    calls++;
  } while (!result.done);
  assert.equal(calls, 4);
  assert.deepEqual(result.remaining, []);
  let [foreign] = await page.handler(ctx, {
    token,
    requests: [{ bookingId: booking._id, terms: ["foreign"], cursor: null }],
  });
  while (!foreign.done) {
    [foreign] = await page.handler(ctx, {
      token,
      requests: [
        {
          bookingId: booking._id,
          terms: foreign.remaining,
          cursor: foreign.cursor,
        },
      ],
    });
  }
  assert.deepEqual(foreign.remaining, ["foreign"]);
  assert.equal(
    JSON.stringify(
      [...tables].map(([name, rows]) => [name, [...rows.values()]]),
    ),
    before,
  );
  await assert.rejects(
    page.handler(ctx, {
      token,
      requests: Array.from({ length: 17 }, () => ({
        bookingId: booking._id,
        terms: ["x"],
        cursor: null,
      })),
    }),
    /16 conversations/,
  );
  console.log(
    "PASS actual read-only history paging: words beyond40 across separate pages, canonical account isolation, owner authentication, bounded pages and no database/unread/message/rental mutations.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
