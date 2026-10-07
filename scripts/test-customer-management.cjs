const assert = require("node:assert/strict");
const { load, db, put, tables } = require("./lib/rentalTestHarness.cjs");
const admin = load("convex/accountAdmin.ts");
process.env.ADMIN_TOKEN = "fixture-admin";
const ctx = {
  db,
  storage: { getUrl: async (id) => `https://example.invalid/${id}` },
};
const account = put("accounts", {
  email: "customer@example.invalid",
  name: "Customer",
  phone: "0123",
  address: "Test address",
  createdAt: 1,
  hash: "secret-password",
  stripeCustomerId: "secret-provider-id",
  membershipTier: "pro",
  membershipActive: true,
  membershipPaidThrough: Date.now() + 86400000,
});
const other = put("accounts", { email: "other@example.invalid", createdAt: 1 });
const listing = put("listings", {
  r2Images: ["https://example.invalid/camera.png"],
  sourceImages: ["https://example.invalid/source.png"],
});
const lineItems = [
  {
    listingId: listing._id,
    title: "Actual camera",
    qty: 2,
    start: 123,
    end: 456,
  },
];
const owned = put("bookings", {
  accountId: account._id,
  guestEmail: account.email,
  status: "confirmed",
  lineItems,
  total: 100,
});
const legacy = put("bookings", {
  guestEmail: account.email,
  status: "returned",
  lineItems,
  total: 80,
});
const foreign = put("bookings", {
  accountId: other._id,
  guestEmail: account.email,
  status: "active",
  lineItems,
  total: 99,
});
put("chat_threads", {
  accountId: account._id,
  bookingId: owned._id,
  lastMessage: "Owned message",
  updatedAt: 1,
});
put("chat_threads", {
  accountId: account._id,
  lastMessage: "Account support",
  updatedAt: 2,
});
put("chat_threads", {
  accountId: account._id,
  bookingId: foreign._id,
  lastMessage: "Must not appear",
  updatedAt: 3,
});
const credit = put("credits", {
  accountId: account._id,
  status: "active",
  kind: "refund",
  remaining: 25,
  expiresAt: Date.now() + 86400000,
});
put("credits", {
  accountId: account._id,
  status: "active",
  kind: "earned",
  remaining: 10,
  expiresAt: Date.now() + 86400000,
  revokedPendingPence: 100,
});
put("credits", {
  accountId: account._id,
  status: "active",
  kind: "refund",
  remaining: 999,
  expiresAt: 1,
});
put("credits", {
  accountId: other._id,
  status: "active",
  remaining: 999,
  expiresAt: Date.now() + 86400000,
});
put("bookings", {
  accountId: account._id,
  guestEmail: account.email,
  status: "pending_payment",
  lineItems: [],
  total: 10,
  creditApplied: 10,
  creditAllocations: [{ creditId: credit._id, amount: 10, kind: "refund" }],
});
(async () => {
  await assert.rejects(
    () => admin.detail.handler(ctx, { token: "bad", accountId: account._id }),
    /unauthorized/,
  );
  await assert.rejects(
    () =>
      admin.addNote.handler(ctx, {
        token: "bad",
        accountId: account._id,
        text: "Private note",
      }),
    /unauthorized/,
  );
  await assert.rejects(
    () =>
      admin.addNote.handler(ctx, {
        token: "fixture-admin",
        accountId: account._id,
        text: " ",
      }),
    /note/,
  );
  await admin.addNote.handler(ctx, {
    token: "fixture-admin",
    accountId: account._id,
    text: "  Insurance claim evidence is linked to the rental.  ",
  });
  const detail = await admin.detail.handler(ctx, {
    token: "fixture-admin",
    accountId: account._id,
  });
  assert.equal(detail.phone, "0123");
  assert.equal(
    detail.credit,
    24,
    "Available balance deducts reserved and revoked credit",
  );
  assert.equal(detail.refundCredit, 15);
  assert.equal(detail.rentals.length, 3);
  assert(detail.rentals.some((r) => r.id === legacy._id));
  assert(!detail.rentals.some((r) => r.id === foreign._id));
  assert.deepEqual(
    detail.rentals.find((r) => r.id === owned._id).imageSources,
    [
      "https://example.invalid/camera.png",
      "https://example.invalid/source.png",
    ],
  );
  assert.equal(detail.rentals.find((r) => r.id === owned._id).quantity, 2);
  assert.deepEqual(
    detail.conversations.map((t) => t.lastMessage),
    ["Account support", "Owned message"],
  );
  assert.equal(
    detail.notes[0].text,
    "Insurance claim evidence is linked to the rental.",
  );
  for (const field of [
    "hash",
    "salt",
    "stripeCustomerId",
    "stripeSubscriptionId",
    "storageId",
  ])
    assert(!(field in detail));
  assert.equal(
    (
      await admin.detail.handler(ctx, {
        token: "fixture-admin",
        accountId: other._id,
      })
    ).notes.length,
    0,
    "Notes are account-specific",
  );
  assert.equal((tables.get("account_admin_notes") ?? []).length, 1);
  console.log(
    "PASS customer management: admin-only projection, permanent/legacy rental links, account-scoped conversations/notes, actual images and credit after reservations/revocation.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
