const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");
const rawPut = harness.put.bind(harness);
harness.put = (table, record) => rawPut(table, table === "bookings" && record.idVerifyStatus === "verified" && record.idVerifiedAt == null && record.verificationExpiresAt == null
  ? { ...record, idVerifiedAt: Date.now() }
  : record);
global.crypto ??= webcrypto;
const access = harness.load("convex/adminAccountSessionV2.ts");
let ready = false;
harness.setMock("./adminAccountSessionV2", { ...access, adminSessionMigrationReady: () => ready });
const admin = harness.load("convex/accountAdmin.ts");
const sessions = harness.load("convex/adminSessionsV2.ts");
const identity = "https://identity.example|match-scopes-fixture";
const hash = value => createHash("sha256").update(value).digest("hex");
const tokens = { customers: "a".repeat(64), verification: "b".repeat(64), both: "c".repeat(64) };
const ctx = { db: harness.db, auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) } };
process.env.ADMIN_TOKEN = "fixture-admin";
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["customers:read", "verification:read"] });
const key = "a".repeat(64);
const renter = harness.put("accounts", { email: "renter@example.invalid", renterPersonKey: key });
const restricted = harness.put("accounts", { email: "restricted@example.invalid", renterPersonKey: key, blockedAt: 1 });
const blacklist = harness.put("accounts", { email: "blacklist@example.invalid", renterPersonKey: key, blockedAt: 2, restrictionClass: "identity_safety_blacklist" });
const accessOnly = harness.put("accounts", { email: "access-only@example.invalid", renterPersonKey: key, blockedAt: 3, restrictionClass: "access_only" });
const booking = harness.put("bookings", { accountId: renter._id, renterPersonKey: key, diditSessionId: "fixture", idVerifyStatus: "verified", idVerificationSource: "didit", verificationProvider: "didit", status: "pending_verification", verificationChecks: { identity: "approved", selfie: "approved", address: "approved" } });
const read = (token, target = booking) => admin.possibleRestrictedIdentityMatches.handler(ctx, { token, bookingId: target._id });
const readAccount = (token, accountId = renter._id) => admin.possibleRestrictedIdentityMatchesForAccount.handler(ctx, { token, accountId });
const approved = { renterPersonKey: key, idVerifyStatus: "verified", verificationProvider: "didit", idVerificationSource: "didit", diditSessionId: "fixture", verificationChecks: { identity: "approved", selfie: "approved", address: "approved" } };
const currentRentals = [
  harness.put("bookings", { ...approved, accountId: renter._id, idVerificationSource: "reused_didit", verificationReusedFrom: booking._id, identityMatchSameAccountSourceBookingId: booking._id, status: "confirmed", lineItems: [{ title: "Sony FX3 camera", start: Date.UTC(2030, 0, 2) }] }),
  harness.put("bookings", { ...approved, accountId: renter._id, idVerificationSource: "reused_didit", verificationReusedFrom: booking._id, identityMatchSameAccountSourceBookingId: booking._id, status: "active", lineItems: [{ title: "24–70mm lens", start: Date.UTC(2030, 0, 3) }] }),
  harness.put("bookings", { ...approved, accountId: renter._id, idVerificationSource: "reused_didit", verificationReusedFrom: booking._id, identityMatchSameAccountSourceBookingId: booking._id, status: "pending_verification", lineItems: [{ title: "Cinema prime", start: Date.UTC(2030, 0, 4) }] }),
];
harness.put("bookings", { ...approved, accountId: renter._id, idVerificationSource: "reused_didit", verificationReusedFrom: booking._id, identityMatchSameAccountSourceBookingId: booking._id, status: "returned", lineItems: [{ title: "Returned kit", start: Date.UTC(2029, 0, 1) }] });
harness.put("bookings", { ...approved, accountId: renter._id, status: "confirmed", verificationChecks: { identity: "approved", selfie: "approved", address: "pending" }, lineItems: [{ title: "Incomplete verification", start: Date.UTC(2030, 0, 5) }] });

(async () => {
  process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2 = "enabled";
  await assert.rejects(read(process.env.ADMIN_TOKEN), /not ready/);
  ready = true;
  for (const [name, scopes] of Object.entries({ customers: ["customers:read"], verification: ["verification:read"], both: ["customers:read", "verification:read"] }))
    await sessions.createSession.handler(ctx, { tokenDigest: hash(tokens[name]), principalId: `admin:${hash(identity)}`, scopes, expiresAt: Date.now() + 60_000 });
  await assert.rejects(read(tokens.customers), /unauthorized/);
  await assert.rejects(read(tokens.verification), /unauthorized/, "Verification scope alone cannot expose renter identity and booking data");
  await assert.rejects(readAccount(tokens.customers), /unauthorized/);
  await assert.rejects(readAccount(tokens.verification), /unauthorized/, "The account-level alert also requires customer-read scope");
  assert.deepEqual((await read(tokens.both)).matches.map(row => row.id), [blacklist._id, restricted._id]);
  const scopedAccountMatches = await readAccount(tokens.both);
  assert.deepEqual(scopedAccountMatches.matches.map(row => row.id), [blacklist._id, restricted._id]);
  assert.deepEqual(scopedAccountMatches.matches[0].bookings.map(row => row.id).sort(), [booking._id, ...currentRentals.map(row => row._id)].sort(), "one restricted account match is grouped across the renter's current rentals");
  assert.equal("renterPersonKey" in scopedAccountMatches.matches[0], false, "The account alert does not return identity hashes");
  assert.equal("diditSessionId" in scopedAccountMatches.matches[0].bookings[0], false, "The account alert does not return provider session identifiers");
  process.env.ADMIN_SESSION_CUSTOMER_READ_V2 = "enabled";
  await assert.rejects(read(tokens.verification), /unauthorized/);
  assert.deepEqual((await read(tokens.both)).matches.map(row => row.id), [blacklist._id, restricted._id]);
  await assert.rejects(readAccount(tokens.verification), /unauthorized/);
  assert.equal((await readAccount(tokens.both)).matches.length, 2, "Account-level alert requires both configured admin read scopes");
  delete process.env.ADMIN_SESSION_IDENTITY_ALERTS_V2;
  await assert.rejects(read(tokens.customers), /unauthorized/);
  assert.equal((await read(tokens.both)).matches.length, 2);
  await sessions.revoke.handler(ctx, { tokenDigest: hash(tokens.both) });
  await assert.rejects(read(tokens.both), /unauthorized/);
  delete process.env.ADMIN_SESSION_CUSTOMER_READ_V2;
  assert.equal((await read(process.env.ADMIN_TOKEN)).matches.length, 2);
  const accountMatches = await readAccount(process.env.ADMIN_TOKEN);
  assert.equal(accountMatches.matches.length, 2, "Legacy admin authorization remains compatible");
  assert.equal(accountMatches.more, false);
  assert.equal((await harness.db.get(currentRentals[0]._id)).status, "confirmed", "Reading a match never changes booking status or blocks the renter");

  const largeRenter = harness.put("accounts", { email: "large@example.invalid" });
  for (let index = 0; index < 26; index++) {
    const distinctKey = hash(`large-renter-${index}`);
    harness.put("accounts", { email: `restricted-${index}@example.invalid`, renterPersonKey: distinctKey, blockedAt: index + 10 });
    harness.put("bookings", { ...approved, renterPersonKey: distinctKey, accountId: largeRenter._id, status: "confirmed", lineItems: [{ title: `Rental ${index}`, start: Date.UTC(2030, 0, 1) + index }] });
  }
  const boundedMatches = await readAccount(process.env.ADMIN_TOKEN, largeRenter._id);
  assert.equal(boundedMatches.matches.length, 20, "The result caps the number of distinct possible matches shown to an administrator");
  assert.equal(boundedMatches.more, true, "The UI can disclose that more verified rentals or matches exist beyond the bounded scan");

  const guestBooking = harness.put("bookings", { guestEmail: restricted.email, renterPersonKey: key, diditSessionId: "guest-fixture", idVerifyStatus: "verified", idVerificationSource: "didit", verificationChecks: { identity: "approved", selfie: "approved", address: "approved" } });
  assert.deepEqual((await read(process.env.ADMIN_TOKEN, guestBooking)).matches.map(row => row.id), [blacklist._id, restricted._id], "New explicit blacklists and unclassified legacy restrictions remain visible");
  assert.equal((await read(process.env.ADMIN_TOKEN, guestBooking)).matches.some(row => row.id === accessOnly._id), false, "An access-only restriction is not treated as a blacklisted identity");
  assert.equal((await harness.db.get(guestBooking._id)).blockedAt, undefined, "A possible match never blocks the guest booking");
  assert.deepEqual(await read("wrong"), { matches: [], more: false });
  const sameAccount = harness.put("accounts", { email: "same-account@example.invalid", renterPersonKey: key });
  const sameAccountSource = harness.put("bookings", { accountId: sameAccount._id, renterPersonKey: key, diditSessionId: "same-account-prior-session", idVerifyStatus: "verified", idVerificationSource: "didit", verificationChecks: { identity: "approved", selfie: "approved", address: "approved" }, status: "returned" });
  const sameAccountHistorical = harness.put("bookings", { accountId: sameAccount._id, renterPersonKey: key, diditSessionId: "same-account-historical-session", idVerifyStatus: "verified", idVerificationSource: "didit", verificationProvider: "didit", verificationChecks: { identity: "approved", selfie: "approved", address: "approved" }, status: "confirmed", lineItems: [{ title: "Earlier rental", start: Date.UTC(2030, 0, 5) }] });
  const sameAccountRenewal = harness.put("bookings", { accountId: sameAccount._id, renterPersonKey: key, identityMatchSameAccountSourceBookingId: sameAccountSource._id, diditSessionId: "same-account-new-session", idVerifyStatus: "verified", idVerificationSource: "didit", verificationProvider: "didit", verificationChecks: { identity: "approved", selfie: "approved", address: "approved" }, status: "confirmed", lineItems: [{ title: "Renewed rental", start: Date.UTC(2030, 0, 6) }] });
  sameAccount.rentalVerification = { sourceBookingId: sameAccountRenewal._id, verifiedAt: Date.now(), expiresAt: Date.now() + 90 * 86400000 };
  assert.deepEqual((await read(process.env.ADMIN_TOKEN, sameAccountRenewal)).matches.map(row => row.id), [blacklist._id, restricted._id], "same-account history must not hide distinct restricted identities from the booking profile");
  assert.deepEqual((await read(process.env.ADMIN_TOKEN, sameAccountHistorical)).matches.map(row => row.id), [blacklist._id, restricted._id], "the admin panel preserves true cross-account matches across rentals");
  const sameAccountMatches = await readAccount(process.env.ADMIN_TOKEN, sameAccount._id);
  assert.deepEqual(sameAccountMatches.matches.map(row => row.id), [blacklist._id, restricted._id], "the account profile surfaces distinct restricted accounts but not its own account");

  const cleanKey = hash("returning-renter-without-restrictions");
  const cleanAccount = harness.put("accounts", { email: "clean-returning@example.invalid", renterPersonKey: cleanKey });
  const cleanSource = harness.put("bookings", { accountId: cleanAccount._id, renterPersonKey: cleanKey, diditSessionId: "expired-clean-session", idVerifyStatus: "requires_input", idVerificationSource: "didit", verificationNote: "Your verification expired. Complete a new check before handover.", idVerifiedAt: Date.now() - 91 * 86400000, verificationChecks: { identity: "approved", selfie: "approved", address: "approved" } });
  const cleanRenewal = harness.put("bookings", { accountId: cleanAccount._id, renterPersonKey: cleanKey, identityMatchSameAccountSourceBookingId: cleanSource._id, diditSessionId: "fresh-clean-session", idVerifyStatus: "verified", idVerificationSource: "didit", verificationProvider: "didit", verificationChecks: { identity: "approved", selfie: "approved", address: "approved" }, status: "confirmed" });
  cleanAccount.rentalVerification = { sourceBookingId: cleanRenewal._id, verifiedAt: Date.now(), expiresAt: Date.now() + 90 * 86400000 };
  assert.deepEqual(await read(process.env.ADMIN_TOKEN, cleanRenewal), { matches: [], more: false }, "routine same-account re-verification without a different restricted account has no identity-match warning");
  assert.deepEqual(await readAccount(process.env.ADMIN_TOKEN, cleanAccount._id), { matches: [], more: false }, "the account profile remains clear for an ordinary verified account");
  console.log("PASS restricted identity alerts are scoped, bounded, privacy-limited and account-wide without blocking rentals");
})().catch(error => { console.error(error); process.exitCode = 1; });
