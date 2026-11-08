const assert = require("node:assert/strict");
const { db, put, load } = require("./lib/rentalTestHarness.cjs");

delete process.env.ADMIN_SESSION_CUSTOMER_READ_V2;
delete process.env.ADMIN_SESSION_CUSTOMER_WRITE_V2;
delete process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2;
process.env.ADMIN_TOKEN = "fixture-admin-boundary";

const customerAdmin = load("convex/accountAdmin.ts");
const rentalChat = load("convex/rentalChat.ts");
const account = put("accounts", {
  email: "boundary-customer@example.invalid",
  name: "Synthetic customer",
  createdAt: Date.now(),
});
const customerToken = "valid-customer-session";
put("sessions", {
  accountId: account._id,
  token: customerToken,
  expiresAt: Date.now() + 60_000,
});
const ctx = { db };

(async () => {
  const directoryArgs = {
    token: customerToken,
    search: "",
    paginationOpts: { cursor: null, numItems: 20 },
    filter: "all",
    tier: "all",
    view: "all",
  };

  assert.equal(await customerAdmin.directoryAccess.handler(ctx, { token: customerToken }), false);
  assert.deepEqual(await customerAdmin.directory.handler(ctx, directoryArgs), {
    page: [],
    isDone: true,
    continueCursor: "",
  });
  assert.deepEqual(await customerAdmin.searchMessages.handler(ctx, {
    token: customerToken,
    search: "Synthetic customer",
    filter: "all",
    tier: "all",
    view: "all",
  }), { items: [], truncated: false });
  assert.deepEqual(await customerAdmin.directoryMetrics.handler(ctx, {
    token: customerToken,
    accountIds: [account._id],
  }), []);
  await assert.rejects(
    customerAdmin.detail.handler(ctx, { token: customerToken, accountId: account._id }),
    /unauthorized/,
  );
  assert.deepEqual(await customerAdmin.history.handler(ctx, {
    token: customerToken,
    accountId: account._id,
  }), []);
  assert.deepEqual(await customerAdmin.possibleRestrictedIdentityMatches.handler(ctx, {
    token: customerToken,
    bookingId: "synthetic-booking",
  }), { matches: [], more: false });

  const paginationOpts = { cursor: null, numItems: 20 };
  assert.deepEqual(await rentalChat.adminInbox.handler(ctx, { token: customerToken }), {
    authorized: false,
    items: [],
  });
  assert.deepEqual(await rentalChat.adminPage.handler(ctx, {
    token: customerToken,
    paginationOpts,
  }), { page: [], isDone: true, continueCursor: "" });
  assert.equal(await rentalChat.messages.handler(ctx, {
    token: customerToken,
    admin: true,
    accountId: account._id,
    paginationOpts,
  }), null);
  assert.deepEqual(await rentalChat.unreadBreakdown.handler(ctx, {
    token: customerToken,
    admin: true,
  }), { rentals: 0, general: 0 });
  await assert.rejects(rentalChat.sendOwner.handler(ctx, {
    token: customerToken,
    accountId: account._id,
    text: "Forged admin reply",
  }), /unauthorized/);

  console.log("PASS customer/admin boundary: a valid customer session cannot read customer-directory insights or use admin rental-chat views/actions; synthetic data only.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
