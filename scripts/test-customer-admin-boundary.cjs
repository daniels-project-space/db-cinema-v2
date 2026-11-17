const assert = require("node:assert/strict");
const { db, put, load, tables } = require("./lib/rentalTestHarness.cjs");

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
  }), { page: [], isDone: true, continueCursor: "" });
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
  await assert.rejects(customerAdmin.verificationReviews.handler(ctx, {
    token: customerToken,
    accountId: account._id,
  }), /unauthorized/);

  const beforeAccount = structuredClone(tables.get("accounts").find(row => row._id === account._id));
  const beforeAudits = (tables.get("account_admin_changes") ?? []).length;
  const beforeNotes = (tables.get("account_admin_notes") ?? []).length;
  const beforeNotices = (tables.get("account_restriction_notices") ?? []).length;
  const forbiddenWrites = [
    ["star", customerAdmin.setStarred, { token: customerToken, accountId: account._id, starred: true }],
    ["membership", customerAdmin.setLevel, { token: customerToken, accountId: account._id, level: "pro", expectedLevel: "automatic", reason: "Fixture" }],
    ["Encore", customerAdmin.setEncoreLevel, { token: customerToken, accountId: account._id, level: 3, expectedLevel: "automatic", reason: "Fixture" }],
    ["combined access", customerAdmin.setRentalAccess, { token: customerToken, accountId: account._id, level: "pro", expectedLevel: "automatic", encoreLevel: 3, expectedEncoreLevel: "automatic", reason: "Fixture" }],
    ["profile", customerAdmin.updateProfile, { token: customerToken, accountId: account._id, name: "Changed", phone: "", address: "", expected: { name: account.name, phone: null, address: null }, reason: "Fixture profile update" }],
    ["restriction", customerAdmin.setBlocked, { token: customerToken, accountId: account._id, blocked: true, reason: "Fixture restriction", expected: { blockedAt: null, noticeId: null, reason: "", revision: 0 } }],
    ["internal note", customerAdmin.addNote, { token: customerToken, accountId: account._id, text: "Forged internal note" }],
  ];
  for (const [name, mutation, args] of forbiddenWrites)
    await assert.rejects(mutation.handler(ctx, args), /unauthorized/, `A renter cannot use the admin ${name} control.`);
  assert.deepEqual(tables.get("accounts").find(row => row._id === account._id), beforeAccount, "Rejected customer-side controls leave the account unchanged.");
  assert.equal((tables.get("account_admin_changes") ?? []).length, beforeAudits, "Rejected customer-side controls create no admin audit rows.");
  assert.equal((tables.get("account_admin_notes") ?? []).length, beforeNotes, "Rejected customer-side controls create no internal notes.");
  assert.equal((tables.get("account_restriction_notices") ?? []).length, beforeNotices, "Rejected customer-side controls send no restriction notice.");

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

  console.log("PASS customer/admin boundary: a valid customer session cannot read account insights, verify cases or invoke profile/access/restriction/note writes, directory queries or admin rental-chat actions; no account or audit rows changed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
