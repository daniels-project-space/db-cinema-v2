const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { ConvexHttpClient } = require("convex/browser");
const { makeFunctionReference } = require("convex/server");
const root = path.resolve(__dirname, ".."), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-admin-auth-runtime-"));
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
let child, cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  if (child?.pid) {
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) await sleep(100);
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  fs.rmSync(workspace, { recursive: true, force: true });
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) process.once(signal, () => { cleanup().finally(() => process.exit(code)); });
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const base64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");

async function main() {
  for (const name of ["convex", "shared", "src/lib"]) fs.cpSync(path.join(root, name), path.join(workspace, name), { recursive: true });
  for (const name of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(root, name), path.join(workspace, name));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(workspace, "node_modules"), "dir");
  fs.copyFileSync(path.join(__dirname, "fixtures/admin-auth-runtime.ts.fixture"), path.join(workspace, "convex/admin_auth_qualify.ts"));
  const gate = path.join(workspace, "convex/adminAccountSessionV2.ts"), original = fs.readFileSync(gate, "utf8");
  const replacement = original.replace("export function adminSessionMigrationReady(): boolean {\n  return false;\n}", "export function adminSessionMigrationReady(): boolean {\n  return true;\n}");
  assert.notEqual(replacement, original, "Only the temporary isolated fixture opens its test gate"); fs.writeFileSync(gate, replacement);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "fixture-key", alg: "RS256", use: "sig" };
  const jwks = `data:text/plain;charset=utf-8;base64,${Buffer.from(JSON.stringify({ keys: [jwk] })).toString("base64")}`;
  const issuer = "https://synthetic-id.example.invalid", audience = "synthetic-admin-audience";
  fs.writeFileSync(path.join(workspace, "convex/auth.config.ts"), `export default { providers: [{ type: "customJwt", issuer: ${JSON.stringify(issuer)}, applicationID: ${JSON.stringify(audience)}, jwks: ${JSON.stringify(jwks)}, algorithm: "RS256" }] };\n`);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CONVEX_AGENT_MODE: "anonymous", XDG_CONFIG_HOME: path.join(workspace, "config") }, cli = path.join(root, "node_modules/.bin/convex");
  child = spawn(cli, ["dev", "--typecheck", "disable", "--codegen", "disable", "--tail-logs", "disable"], { cwd: workspace, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", exited = false; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; }); child.on("exit", () => { exited = true; });
  for (let attempt = 0; attempt < 180 && !output.includes("Convex functions ready!") && !exited; attempt++) await sleep(1000);
  if (!output.includes("Convex functions ready!")) throw Error(`Isolated backend did not start: ${output.slice(-1200)}`);
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  if (!match || !output.includes("[Local]")) throw Error("The test requires a new loopback-only local deployment.");
  const config = fs.readFileSync(path.join(workspace, ".env.local"), "utf8");
  if (!config.includes(match[0]) || !/CONVEX_DEPLOYMENT=anonymous:/.test(config)) throw Error("Refusing to configure a non-anonymous deployment.");
  const subject = "synthetic-admin", now = Math.floor(Date.now() / 1000);
  function jwt(changes = {}, signingKey = privateKey) {
    const head = base64({ alg: "RS256", typ: "JWT", kid: "fixture-key" }), payload = base64({ sub: subject, iss: issuer, aud: audience, iat: now, exp: now + 300, ...changes });
    return `${head}.${payload}.${crypto.sign("RSA-SHA256", Buffer.from(`${head}.${payload}`), signingKey).toString("base64url")}`;
  }
  const client = new ConvexHttpClient(match[0]), identityQuery = makeFunctionReference("admin_auth_qualify:identity");
  client.setAuth(jwt());
  const tokenIdentifier = await client.query(identityQuery, {});
  assert.equal(typeof tokenIdentifier, "string");
  const secret = "17".repeat(32);
  const fullScopes = ["customers:read", "customers:write", "verification:read", "payments:read", "payments:write", "settings:read", "settings:write"];
  execFileSync(cli, ["env", "set", "ADMIN_SESSION_SCOPES_V2", JSON.stringify({ [tokenIdentifier]: fullScopes })], { cwd: workspace, env, stdio: "pipe" });
  execFileSync(cli, ["env", "set", "ADMIN_SESSION_GATEWAY_HMAC_V2", secret], { cwd: workspace, env, stdio: "pipe" });
  execFileSync(cli, ["env", "set", "ADMIN_SESSION_VERIFICATION_V2", "enabled"], { cwd: workspace, env, stdio: "pipe" });
  execFileSync(cli, ["env", "set", "ADMIN_SESSION_STARRED_V2", "enabled"], { cwd: workspace, env, stdio: "pipe" });
  execFileSync(cli, ["env", "set", "ADMIN_SESSION_CUSTOMER_READ_V2", "enabled"], { cwd: workspace, env, stdio: "pipe" });
  execFileSync(cli, ["env", "set", "ADMIN_SESSION_CREDIT_V2", "enabled"], { cwd: workspace, env, stdio: "pipe" });
  execFileSync(cli, ["env", "set", "ADMIN_SESSION_NOTIFICATIONS_V2", "enabled"], { cwd: workspace, env, stdio: "pipe" });
  execFileSync(cli, ["env", "set", "ADMIN_SESSION_BILLING_PORTAL_V2", "enabled"], { cwd: workspace, env, stdio: "pipe" });
  execFileSync(cli, ["env", "set", "ADMIN_SESSION_MEMBERSHIP_REFRESH_V2", "enabled"], { cwd: workspace, env, stdio: "pipe" });
  const clientDigest = "a".repeat(64), nonce = "b".repeat(64), issuedAt = Date.now();
  const message = `dbc-admin-session-v2|${hash(tokenIdentifier)}|${clientDigest}|${nonce}|${issuedAt}`;
  const attestation = { clientDigest, nonce, issuedAt, mac: crypto.createHmac("sha256", Buffer.from(secret, "hex")).update(message).digest("hex") };
  const result = await client.action(makeFunctionReference("admin_auth_qualify:issue"), { attestation });
  assert.match(result.token, /^[a-f0-9]{64}$/);
  assert.equal(await client.action(makeFunctionReference("admin_auth_qualify:issue"), { attestation }), null, "A signed attestation cannot issue twice");
  const check = makeFunctionReference("adminAccountSessionV2:checkSession"), signOut = makeFunctionReference("adminAccountSessionV2:signOut");
  assert.deepEqual(await client.query(check, { token: result.token, scope: "customers:read" }), { ok: true });
  await assert.rejects(client.query(check, { token: result.token, scope: "verification:write" }));
  const other = new ConvexHttpClient(match[0]); other.setAuth(jwt({ sub: "synthetic-other" }));
  await assert.rejects(other.query(check, { token: result.token, scope: "customers:read" }));
  await assert.rejects(other.mutation(signOut, { token: result.token }));
  const accountId = await client.mutation(makeFunctionReference("admin_auth_qualify:seedAccount"), {});
  const starred = makeFunctionReference("accountAdmin:setStarred"), directoryAccess = makeFunctionReference("accountAdmin:directoryAccess"), inspectAccount = makeFunctionReference("admin_auth_qualify:inspectAccount");
  assert.equal(await client.query(directoryAccess, { token: result.token }), true);
  await assert.rejects(other.query(directoryAccess, { token: result.token }));
  await assert.rejects(other.mutation(starred, { token: result.token, accountId, starred: true }));
  assert.deepEqual(await client.query(inspectAccount, { accountId }), { starred: false, successfulStars: 0 });
  await client.mutation(starred, { token: result.token, accountId, starred: true });
  assert.deepEqual(await client.query(inspectAccount, { accountId }), { starred: true, successfulStars: 1 });
  const grant = makeFunctionReference("accountCredits:grantAdmin"), creditStatus = makeFunctionReference("accountCredits:grantStatus");
  const grantArgs = { token: result.token, accountId, amount: 10, requestId: "synthetic-credit-request-12345", expectedRevision: 0 };
  await assert.rejects(other.mutation(grant, grantArgs));
  const credit = await client.mutation(grant, grantArgs);
  assert.equal(credit.replayed, false);
  assert.equal((await client.mutation(grant, grantArgs)).replayed, true);
  const issuedCredit = await client.query(creditStatus, { token: result.token, accountId, requestId: grantArgs.requestId });
  assert.equal(issuedCredit.latest.amount, 10);
  assert.equal(issuedCredit.receipt.amount, 10);
  assert.equal(issuedCredit.revision, 1);
  await client.mutation(makeFunctionReference("admin_auth_qualify:seedDevice"), {});
  const device = makeFunctionReference("adminNotifications:device"), disable = makeFunctionReference("adminNotifications:disable");
  assert.equal((await client.query(device, { token: result.token, deviceId: "synthetic-device" })).enabled, true);
  await assert.rejects(other.mutation(disable, { token: result.token, deviceId: "synthetic-device" }));
  await client.mutation(disable, { token: result.token, deviceId: "synthetic-device" });
  assert.equal((await client.query(device, { token: result.token, deviceId: "synthetic-device" })).enabled, false);
  const billingAccount = await client.mutation(makeFunctionReference("admin_auth_qualify:seedBillingAccount"), {}), billingTarget = makeFunctionReference("admin_auth_qualify:billingTarget");
  await assert.rejects(other.action(billingTarget, { token: result.token, accountId: billingAccount }));
  assert.equal((await client.action(billingTarget, { token: result.token, accountId: billingAccount })).customerId, "cus_synthetic");
  const refreshTarget = makeFunctionReference("admin_auth_qualify:refreshTarget"), refreshCommit = makeFunctionReference("admin_auth_qualify:refreshCommit"), inspectMembership = makeFunctionReference("admin_auth_qualify:inspectMembership");
  const refreshArgs = { token: result.token, accountId: billingAccount, membershipSnapshot: (await client.action(refreshTarget, { token: result.token, accountId: billingAccount })).membershipSnapshot };
  await assert.rejects(other.action(refreshTarget, { token: result.token, accountId: billingAccount }));
  await assert.rejects(other.action(refreshCommit, refreshArgs));
  assert.equal(await client.query(inspectMembership, { accountId: billingAccount }), null);
  await client.action(refreshCommit, refreshArgs);
  assert.equal(await client.query(inspectMembership, { accountId: billingAccount }), "canceled");
  execFileSync(cli, ["env", "set", "--force", "ADMIN_SESSION_SCOPES_V2", JSON.stringify({ [tokenIdentifier]: ["customers:read", "verification:read"] })], { cwd: workspace, env, stdio: "pipe" });
  await assert.rejects(client.action(refreshCommit, refreshArgs), "Removing the payment scope must prevent the membership update");
  await assert.rejects(client.mutation(starred, { token: result.token, accountId, starred: false }), "Removed scope must take effect for an existing session");
  assert.deepEqual(await client.query(inspectAccount, { accountId }), { starred: true, successfulStars: 1 });
  const site = config.match(/^NEXT_PUBLIC_CONVEX_SITE_URL=(http:\/\/127\.0\.0\.1:\d+)$/m)?.[1];
  if (!site) throw Error("The document test requires a loopback-only HTTP endpoint.");
  const httpNonce = "c".repeat(64), httpIssuedAt = Date.now();
  const httpMessage = `dbc-admin-session-v2|${hash(tokenIdentifier)}|${clientDigest}|${httpNonce}|${httpIssuedAt}`;
  const httpAttestation = { clientDigest, nonce: httpNonce, issuedAt: httpIssuedAt, mac: crypto.createHmac("sha256", Buffer.from(secret, "hex")).update(httpMessage).digest("hex") };
  const sessionRequest = (identityJwt, body = httpAttestation, origin = "https://dbcinemarentals.com") => fetch(`${site}/admin-session`, {
    method: "POST", headers: { origin, authorization: `Bearer ${identityJwt}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await sessionRequest(jwt({ sub: "synthetic-other" }))).status, 401);
  assert.equal((await sessionRequest(jwt(), httpAttestation, "https://foreign.invalid")).status, 403);
  const delivered = await sessionRequest(jwt());
  assert.equal(delivered.status, 200, "Identity propagates through the HTTP action to the internal issuer");
  assert.equal(delivered.headers.get("cache-control"), "no-store");
  const httpSession = await delivered.json();
  assert.match(httpSession.token, /^[a-f0-9]{64}$/);
  assert.equal((await sessionRequest(jwt())).status, 401, "The HTTP delivery endpoint rejects replay");
  assert.deepEqual(await client.query(check, { token: httpSession.token, scope: "verification:read" }), { ok: true });
  const documentId = await client.mutation(makeFunctionReference("admin_auth_qualify:seedDocument"), {});
  const documentRequest = (identityJwt, sessionToken, origin = "https://dbcinemarentals.com") => fetch(`${site}/admin-verification-document`, {
    method: "POST", headers: { origin, authorization: `Bearer ${identityJwt}`, "x-dbc-admin-session": sessionToken, "content-type": "application/json" }, body: JSON.stringify({ documentId }),
  });
  const validJwt = jwt();
  const document = await documentRequest(validJwt, result.token);
  assert.equal(document.status, 200, "Identity and scoped session propagate to the document authorization transaction");
  assert.equal(await document.text(), "synthetic-private-document");
  assert.equal((await documentRequest(jwt({ sub: "synthetic-other" }), result.token)).status, 403);
  assert.equal((await documentRequest(validJwt, "invalid")).status, 403);
  assert.equal((await documentRequest(validJwt, result.token, "https://foreign.invalid")).status, 403);
  for (const bad of [jwt({ aud: "wrong-audience" }), jwt({ iss: "https://wrong.example.invalid" }), jwt({ exp: now - 60 }), jwt({}, crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey)]) {
    const invalid = new ConvexHttpClient(match[0]); invalid.setAuth(bad);
    let identity; try { identity = await invalid.query(identityQuery, {}); } catch { identity = null; }
    assert.equal(identity, null, "Invalid issuer, audience, expiry or signature cannot authenticate");
  }
  execFileSync(cli, ["env", "set", "--force", "ADMIN_SESSION_SCOPES_V2", JSON.stringify({ [tokenIdentifier]: fullScopes })], { cwd: workspace, env, stdio: "pipe" });
  for (let attempt = 0; attempt < 3; attempt++) {
    const raceDigest = crypto.createHash("sha256").update(`synthetic-race-${attempt}`).digest("hex"), raceNonce = crypto.randomBytes(32).toString("hex"), raceAt = Date.now();
    const raceMessage = `dbc-admin-session-v2|${hash(tokenIdentifier)}|${raceDigest}|${raceNonce}|${raceAt}`;
    const raceAttestation = { clientDigest: raceDigest, nonce: raceNonce, issuedAt: raceAt, mac: crypto.createHmac("sha256", Buffer.from(secret, "hex")).update(raceMessage).digest("hex") };
    const raceSession = await client.action(makeFunctionReference("admin_auth_qualify:issue"), { attestation: raceAttestation });
    const raceAccount = await client.mutation(makeFunctionReference("admin_auth_qualify:seedAccount"), {});
    const before = await client.query(inspectAccount, { accountId: raceAccount });
    const [change, revoke] = await Promise.allSettled([
      client.mutation(starred, { token: raceSession.token, accountId: raceAccount, starred: true }),
      client.mutation(signOut, { token: raceSession.token }),
    ]);
    assert.equal(revoke.status, "fulfilled");
    const after = await client.query(inspectAccount, { accountId: raceAccount });
    assert.equal(after.starred, change.status === "fulfilled", "The write only commits if it wins against revocation");
    assert.equal(after.successfulStars, before.successfulStars + (change.status === "fulfilled" ? 1 : 0));
    await assert.rejects(client.mutation(starred, { token: raceSession.token, accountId: raceAccount, starred: false }));
  }
  await client.mutation(signOut, { token: result.token });
  await client.mutation(signOut, { token: httpSession.token });
  await assert.rejects(client.query(check, { token: result.token, scope: "customers:read" }));
  const beforeRevokedAttempt = await client.query(inspectAccount, { accountId });
  await assert.rejects(client.mutation(starred, { token: result.token, accountId, starred: false }));
  await assert.rejects(client.mutation(grant, grantArgs));
  await assert.rejects(client.mutation(disable, { token: result.token, deviceId: "synthetic-device" }));
  await assert.rejects(client.action(billingTarget, { token: result.token, accountId: billingAccount }));
  await assert.rejects(client.action(refreshCommit, refreshArgs));
  assert.deepEqual(await client.query(inspectAccount, { accountId }), beforeRevokedAttempt);
  assert.equal((await documentRequest(validJwt, result.token)).status, 403, "Revoked sessions cannot start a document download");
  console.log("PASS isolated local Convex: signed identity, scoped customer mutation, scope changes, revocation races and private HTTP delivery. Test-only gate, no production services.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(cleanup);
