const assert = require("node:assert/strict");
const { webcrypto, createHash } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const access = harness.load("convex/adminAccountSessionV2.ts");
harness.setMock("./adminAccountSessionV2", { ...access, adminSessionMigrationReady: () => true });
const archive = harness.load("convex/verificationArchive.ts");
const sessions = harness.load("convex/adminSessionsV2.ts");
const hash = value => createHash("sha256").update(value).digest("hex");
const identity = "https://identity.example|verification-fixture";
const readToken = "c".repeat(64), writeToken = "d".repeat(64);
const account = harness.put("accounts", { email: "verification@example.invalid" });
const job = harness.put("verification_archives", { accountId: account._id, status: "complete", retentionHoldRevision: 0 });
const ctx = { db: harness.db, auth: { getUserIdentity: async () => ({ tokenIdentifier: identity }) } };
process.env.ADMIN_SESSION_VERIFICATION_V2 = "enabled";
process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["verification:read", "verification:write"] });
process.env.ADMIN_TOKEN = "legacy-verification-fixture";

(async () => {
  for (const [token, scopes] of [[readToken, ["verification:read"]], [writeToken, ["verification:write"]]])
    await sessions.createSession.handler(ctx, { tokenDigest: hash(token), principalId: `admin:${hash(identity)}`, scopes, expiresAt: Date.now() + 60_000 });
  const read = { token: readToken, accountId: account._id };
  await assert.rejects(archive.accountDocuments.handler(ctx, { ...read, token: writeToken }), /unauthorized/);
  await assert.rejects(archive.accountDocuments.handler(ctx, { ...read, token: process.env.ADMIN_TOKEN }), /unauthorized/);
  await assert.rejects(archive.accountDocuments.handler({ ...ctx, auth: { getUserIdentity: async () => ({ tokenIdentifier: "other" }) } }, read), /unauthorized/);
  assert.equal((await archive.accountDocuments.handler(ctx, read)).length, 1);
  const hold = { token: writeToken, archiveId: job._id, reason: "", expectedReason: "", expectedRevision: 0, confirmed: true };
  await assert.rejects(archive.retentionHold.handler(ctx, { ...hold, token: readToken }), /unauthorized/);
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["verification:read"] });
  await assert.rejects(archive.retentionHold.handler(ctx, hold), /unauthorized/);
  process.env.ADMIN_SESSION_SCOPES_V2 = JSON.stringify({ [identity]: ["verification:read", "verification:write"] });
  await archive.retentionHold.handler(ctx, hold);
  await assert.rejects(archive.downloadAccess.handler(ctx, { token: writeToken, documentId: "missing" }), /unauthorized/);
  await assert.rejects(archive.downloadAccess.handler(ctx, { token: readToken, documentId: "missing" }), /Document not found/);
  await sessions.revoke.handler(ctx, { tokenDigest: hash(readToken) });
  await assert.rejects(archive.accountDocuments.handler(ctx, read), /unauthorized/);
  assert(harness.tables.get("admin_audit_log").some(row => row.fn === "verificationArchive.retentionHold"));
  console.log("PASS scoped verification archive access, ownership, revocation and auditing fixtures; readiness mocked only in test.");
})().catch(error => { console.error(error); process.exitCode = 1; });
