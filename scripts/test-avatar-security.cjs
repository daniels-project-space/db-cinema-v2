const assert = require("node:assert/strict");
const { load, db, put, setMock, tables } = require("./lib/rentalTestHarness.cjs");
const routes = [];
setMock("convex/server", { ...require("convex/server"), httpRouter: () => ({ route: route => routes.push(route) }) });
load("convex/http.ts");
const accounts = load("convex/accounts.ts");
const googleAuth = load("convex/googleAuth.ts");
const { legalVersionForPolicy, CURRENT_PRIVACY_NOTICE_VERSION } = load("shared/legalVersioning.ts");
const acceptedAt = Date.now();
const legalAcceptance = {
  termsAndPrivacyAcknowledged: true,
  accountTermsVersion: legalVersionForPolicy({}),
  accountTermsAcceptedAt: acceptedAt,
  privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION,
  privacyNoticeAcknowledgedAt: acceptedAt,
};
const upsertGoogle = (args, acceptance = legalAcceptance) => googleAuth._upsertGoogle.handler(
  { ...inner, scheduler: { runAfter: async () => {} } }, { ...args, ...acceptance },
);
const upload = routes.find(route => route.path === "/renter-avatar" && route.method === "POST").handler;
const account = put("accounts", { email: "fixture@example.invalid", hash: "fixture-password-hash", salt: "fixture-password-salt", avatarStorageId: "foreign-private", googleAvatarUrl: "https://example.invalid/photo" });
put("sessions", { token: "owner", accountId: account._id, expiresAt: Date.now() + 60000 });
const other = put("accounts", { email: "other@example.invalid", hash: "fixture-password-hash", salt: "fixture-password-salt" });
put("sessions", { token: "other", accountId: other._id, expiresAt: Date.now() + 60000 });
const files = new Map();
let serial = 0, failBinding = false;
const storage = { store: async blob => { const id = `upload-${++serial}`; files.set(id, blob); return id; }, delete: async id => { files.delete(id); }, getUrl: async id => `https://storage.example.invalid/${id}` };
const inner = { db, storage };
const ctx = { storage, runMutation: async (ref, args) => {
  if (ref === "accounts.reserveAvatarUpload") return accounts.reserveAvatarUpload.handler(inner, args);
  if (ref === "accounts.commitAvatarUpload") { if (failBinding) throw Error("before transaction"); return accounts.commitAvatarUpload.handler(inner, args); }
  throw Error("unexpected mutation");
} };
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
const request = (token = "owner", body = jpeg, type = "image/jpeg", origin = "https://dbcinemarentals.com") => new Request("https://fixture.convex.site/renter-avatar", { method: "POST", headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": type }, body });
(async () => {
  const googlePicture = "https://lh3.googleusercontent.com/a/synthetic-profile-photo";
  await upsertGoogle({
    email: other.email,
    googleId: "google-profile-fixture",
    picture: googlePicture,
    token: "google-profile-session",
  });
  assert.equal((await db.get(other._id)).googleId, "google-profile-fixture",
    "a password account with the same verified email can establish its first Google link");
  assert.equal((await db.get(other._id)).hash, "fixture-password-hash",
    "first-linking Google preserves the existing password credentials");
  assert.equal((await accounts.me.handler(inner, { token: "google-profile-session" })).avatarUrl, googlePicture,
    "a verified Google sign-in supplies the default profile photo when the renter has not uploaded or removed one");
  const linkedBeforeMismatch = await db.get(other._id);
  const sessionsBeforeMismatch = (tables.get("sessions") ?? []).length;
  await assert.rejects(
    () => upsertGoogle({ email: other.email, googleId: "different-google-subject", name: "Changed Name", picture: "https://example.invalid/changed", token: "mismatch-session" }),
    /does not match the identity linked to this email/,
    "a different Google subject cannot take over an already linked account",
  );
  assert.deepEqual(await db.get(other._id), linkedBeforeMismatch, "mismatched Google identity cannot mutate profile or verification fields");
  assert.equal((tables.get("sessions") ?? []).length, sessionsBeforeMismatch, "mismatched Google identity cannot mint a session");
  await upsertGoogle({ email: other.email, googleId: "google-profile-fixture", token: "matching-google-session" });
  assert.equal((tables.get("sessions") ?? []).length, sessionsBeforeMismatch + 1, "the already linked Google subject can still sign in");
  const accountCountBeforeEmailChange = (tables.get("accounts") ?? []).length;
  const sessionCountBeforeEmailChange = (tables.get("sessions") ?? []).length;
  await assert.rejects(
    () => upsertGoogle({ email: "changed-google-email@example.invalid", googleId: "google-profile-fixture", token: "changed-email-session" }),
    /already linked to a different account/,
    "a linked Google subject with a newly changed email cannot create a duplicate account",
  );
  assert.equal((tables.get("accounts") ?? []).length, accountCountBeforeEmailChange,
    "changed Google email leaves the existing account set unchanged");
  assert.equal((tables.get("sessions") ?? []).length, sessionCountBeforeEmailChange,
    "changed Google email cannot mint a second account session");
  assert.equal(await db.query("accounts").withIndex("by_email", q => q.eq("email", "changed-google-email@example.invalid")).first(), null,
    "changed Google email does not create a duplicate account row");
  const emailOnly = put("accounts", { email: "email-link-only@example.invalid" });
  const emailOnlyBefore = await db.get(emailOnly._id);
  const sessionsBeforeEmailOnly = (tables.get("sessions") ?? []).length;
  await assert.rejects(
    () => upsertGoogle({ email: emailOnly.email, googleId: "unlinked-google-subject", token: "email-only-google-session" }),
    /cannot be linked to Google using email alone/,
    "first-linking Google is limited to an existing password account with the same verified email",
  );
  assert.deepEqual(await db.get(emailOnly._id), emailOnlyBefore, "email-only accounts cannot be silently linked to a Google identity");
  assert.equal((tables.get("sessions") ?? []).length, sessionsBeforeEmailOnly, "email-only account link rejection creates no session");
  await db.patch(other._id, { avatarStorageId: "owned-google-custom", avatarOwnedStorageId: "owned-google-custom" });
  assert.equal((await accounts.me.handler(inner, { token: "google-profile-session" })).avatarUrl,
    "https://storage.example.invalid/owned-google-custom", "an uploaded profile photo takes precedence over Google's default");
  const newGooglePicture = "https://lh3.googleusercontent.com/a/new-account-profile-photo";
  await assert.rejects(() => upsertGoogle({ email: "unaccepted-google@example.invalid", googleId: "google-unaccepted", token: "unaccepted-session" }, { termsAndPrivacyAcknowledged: false }), /Terms and Conditions/);
  assert.equal(await db.query("accounts").withIndex("by_email", q => q.eq("email", "unaccepted-google@example.invalid")).first(), null, "A first-time Google account is never created without account terms acceptance");
  await upsertGoogle({
    email: "new-google@example.invalid",
    name: "Google Renter",
    googleId: "google-new-account-fixture",
    picture: newGooglePicture,
    token: "new-google-profile-session",
  });
  assert.equal((await accounts.me.handler(inner, { token: "new-google-profile-session" })).avatarUrl, newGooglePicture,
    "a new Google-created account immediately displays its verified Google photo as the profile default");

  files.set("foreign-private", new Blob(["private"]));
  await assert.rejects(() => accounts.setAvatar.handler(inner, { token: "owner", avatarStorageId: "another-private" }));
  await accounts.setAvatar.handler(inner, { token: "owner" });
  assert.equal((await db.get(account._id)).googleAvatarUrl, undefined, "removing a photo also clears the Google fallback");
  await upsertGoogle({ email: account.email, googleId: "google-fixture", picture: "https://example.invalid/photo", token: "new-google-session" }, { termsAndPrivacyAcknowledged: false });
  assert.equal((await db.get(account._id)).googleAvatarUrl, undefined, "Google sign-in cannot restore a removed photo");
  assert(files.has("foreign-private"), "untrusted legacy references cannot delete private files");
  assert.equal((await upload(ctx, request("invalid"))).status, 403);
  assert.equal((await upload(ctx, request("owner", jpeg, "image/jpeg", "https://evil.invalid"))).status, 403);
  assert.equal((await upload(ctx, request("owner", Buffer.from("not an image")))).status, 403);
  assert.equal((await upload(ctx, request())).status, 200);
  const saved = await db.get(account._id);
  assert.equal(saved.avatarStorageId, saved.avatarOwnedStorageId);
  assert(files.has(saved.avatarStorageId));
  assert.equal((await accounts.me.handler(inner, { token: "owner" })).avatarUrl, `https://storage.example.invalid/${saved.avatarStorageId}`, "a newly selected upload displays even when the old Google fallback stays suppressed");
  const binding = { token: "owner", accountId: account._id, storageId: saved.avatarStorageId, revision: saved.avatarUploadRevision, uploadKey: "00000000-0000-0000-0000-000000000000" };
  await assert.rejects(() => accounts.bindAvatarUpload.handler(inner, { ...binding, token: "other" }));
  await accounts.bindAvatarUpload.handler(inner, binding);
  assert(files.has(saved.avatarStorageId), "retry cannot delete an already bound photo");
  await assert.rejects(() => accounts.bindAvatarUpload.handler(inner, { ...binding, storageId: "foreign-private" }));
  const stale = await accounts.reserveAvatarUpload.handler(inner, { token: "owner" });
  await accounts.setAvatar.handler(inner, { token: "owner" });
  await assert.rejects(() => accounts.bindAvatarUpload.handler(inner, { token: "owner", accountId: account._id, revision: stale.revision, storageId: "stale-photo" }));
  assert(!files.has(saved.avatarStorageId), "proven owned avatar is deleted on removal");

  // Reject unbounded public OAuth credentials before JWT decoding, provider
  // certificate fetch, email lookup, or account/session mutations.
  const oldClientId = process.env.GOOGLE_CLIENT_ID;
  const oldFetch = global.fetch;
  process.env.GOOGLE_CLIENT_ID = "synthetic-google-client-id";
  let providerFetches = 0, accountLookups = 0, accountWrites = 0;
  global.fetch = async () => { providerFetches++; throw new Error("Provider fetch must not run"); };
  const accountCountBeforeOversize = (tables.get("accounts") ?? []).length;
  const sessionCountBeforeOversize = (tables.get("sessions") ?? []).length;
  const oversizedCtx = {
    runQuery: async () => { accountLookups++; throw new Error("Account lookup must not run"); },
    runMutation: async () => { accountWrites++; throw new Error("Account mutation must not run"); },
  };
  try {
    await assert.rejects(
      () => googleAuth.signInWithGoogle.handler(oversizedCtx, { credential: "x".repeat(16 * 1024 + 1) }),
      /too large/,
      "oversized Google credentials are rejected before parsing or provider access",
    );
    assert.equal(providerFetches, 0, "oversized credential never fetches Google certificates");
    assert.equal(accountLookups, 0, "oversized credential never reads the account table");
    assert.equal(accountWrites, 0, "oversized credential never writes account/session rows");
    assert.equal((tables.get("accounts") ?? []).length, accountCountBeforeOversize);
    assert.equal((tables.get("sessions") ?? []).length, sessionCountBeforeOversize);
  } finally {
    global.fetch = oldFetch;
    if (oldClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = oldClientId;
  }
  failBinding = true;
  const countBeforeFailure = files.size;
  assert.equal((await upload(ctx, request())).status, 403);
  assert.equal(files.size, countBeforeFailure, "failure before the atomic mutation stores nothing");
  failBinding = false;
  const legacyReserved = await accounts.reserveAvatarUpload.handler(inner, { token: "owner" });
  const legacyStorage = "legacy-ledger-photo";
  files.set(legacyStorage, new Blob(["photo"]));
  await accounts.recordAvatarUpload.handler(inner, { token: "owner", ...legacyReserved, storageId: legacyStorage, uploadKey: "00000000-0000-0000-0000-000000000000" });
  const ledger = await db.query("avatar_upload_ledger").withIndex("by_storage", q => q.eq("storageId", legacyStorage)).first();
  assert(ledger, "old ledger records remain recoverable");
  await db.patch(ledger._id, { dueAt: Date.now() - 1 });
  const damageCase = put("rental_damage_cases", { accountId: account._id, status: "open" });
  await accounts.sweepAvatarUploads.handler(inner, {});
  assert(files.has(ledger.storageId), "a case preserves the upload");
  await db.delete(damageCase._id);
  await db.patch(ledger._id, { dueAt: Date.now() - 1 });
  await db.patch(other._id, { avatarStorageId: ledger.storageId });
  await accounts.sweepAvatarUploads.handler(inner, {});
  assert(files.has(ledger.storageId), "any current account reference prevents deletion");
  assert.equal(await db.get(ledger._id), null);
  failBinding = false;
  const reserved = await accounts.reserveAvatarUpload.handler(inner, { token: "owner" });
  const orphan = "orphan-photo", uploadKey = "00000000-0000-0000-0000-000000000000";
  files.set(orphan, new Blob(["photo"]));
  await accounts.recordAvatarUpload.handler(inner, { token: "owner", ...reserved, storageId: orphan, uploadKey });
  const orphanLedger = await db.query("avatar_upload_ledger").withIndex("by_storage", q => q.eq("storageId", orphan)).first();
  await db.patch(orphanLedger._id, { dueAt: Date.now() - 1 });
  await accounts.sweepAvatarUploads.handler(inner, {});
  assert(!files.has(orphan), "proved orphan is removed");
  assert(files.has("foreign-private"), "legacy files are never swept");
  await assert.rejects(() => accounts.bindAvatarUpload.handler(inner, { token: "owner", ...reserved, storageId: orphan, uploadKey }));
  const bytes = new Uint8Array(5 * 1024 * 1024);
  bytes.set(jpeg);
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  const chunks = Array.from({ length: 10 }, (_, index) => bytes.slice(index * 512 * 1024, (index + 1) * 512 * 1024).buffer);
  const atomic = { token: "owner", ...reserved, contentType: "image/jpeg", digest, chunks };
  const beforeAtomic = files.size;
  await accounts.commitAvatarUpload.handler(inner, atomic);
  await accounts.commitAvatarUpload.handler(inner, atomic);
  assert.equal(files.size, beforeAtomic + 1, "same revision and bytes retry without a second stored file");
  const tampered = chunks.slice(); tampered[1] = tampered[1].slice(0); new Uint8Array(tampered[1])[0] = 1;
  await assert.rejects(() => accounts.commitAvatarUpload.handler(inner, { ...atomic, chunks: tampered }));
  await assert.rejects(() => accounts.commitAvatarUpload.handler(inner, { ...atomic, digest: "0".repeat(64) }));
  await assert.rejects(() => accounts.commitAvatarUpload.handler(inner, { ...atomic, chunks: [...chunks, new ArrayBuffer(1)] }));
  assert.equal(files.size, beforeAtomic + 1, "mismatched, oversize and stale retries cannot store files");
  console.log("PASS Google identity binding, oversized credential rejection, profile-photo fallback/removal, avatar ownership, bounded cleanup, legacy preservation and stale binding");
})().catch(error => { console.error(error); process.exitCode = 1; });
