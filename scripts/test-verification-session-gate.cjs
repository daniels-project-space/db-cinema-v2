const assert = require("node:assert/strict");
const { load, db } = require("./lib/rentalTestHarness.cjs");
const archive = load("convex/verificationArchive.ts");
process.env.ADMIN_TOKEN = "legacy-verification-fixture";
process.env.ADMIN_SESSION_VERIFICATION_V2 = "enabled";
const ctx = { db };
const args = { token: process.env.ADMIN_TOKEN, accountId: "account", archiveId: "archive", documentId: "document" };
(async () => {
  for (const name of ["accountDocuments", "retry", "retrySupplemental", "reportDisplayFailure", "downloadAccess", "backfillAccount", "retentionHold"])
    await assert.rejects(archive[name].handler(ctx, args), /session migration is not ready/i, name);
  console.log("PASS verification archive session paths fail closed while migration is not ready.");
})().catch(error => { console.error(error); process.exitCode = 1; });
