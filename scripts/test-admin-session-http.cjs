const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const harness = require("./lib/rentalTestHarness.cjs");
global.crypto ??= webcrypto;
const routes = [];
harness.setMock("convex/server", { httpRouter: () => ({ route: route => routes.push(route) }) });
harness.setMock("./lib/chatAttachmentScanner", { chatAttachmentsReady: () => true, CHAT_ATTACHMENT_LIMIT: 1024, scanChatAttachment: async () => { throw Error("not used"); } });
harness.load("convex/http.ts");
const document = routes.find(route => route.path === "/admin-verification-document" && route.method === "POST");
const attachment = routes.find(route => route.path === "/chat-attachment" && route.method === "POST");
const options = routes.find(route => route.path === "/admin-verification-document" && route.method === "OPTIONS");
const session = "a".repeat(64), bytes = Buffer.from("synthetic document");
const digest = createHash("sha256").update(bytes).digest("hex");
const origin = "https://dbcinemarentals.com";
let identity = "admin-fixture", received = [];
const ctx = {
  auth: { getUserIdentity: async () => identity ? { tokenIdentifier: identity } : null },
  runMutation: async (ref, args) => {
    received.push({ ref, token: args.token });
    if (identity !== "admin-fixture" || args.token !== session) throw Error("unauthorized");
    if (ref === "verificationArchive.downloadAccess") return { storageId: "file", size: bytes.length, sha256: digest, contentType: "application/pdf" };
    if (ref === "chatAttachments.download") return { storageId: "file", size: bytes.length, sha256: digest, name: "file.pdf" };
    throw Error("unexpected mutation");
  },
  storage: { get: async () => new Blob([bytes]) },
};
const request = (path, headers = {}) => new Request(`https://fixture.convex.site${path}`, {
  method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify({ documentId: "fixture" }),
});

(async () => {
  process.env.ADMIN_SESSION_VERIFICATION_V2 = "enabled";
  process.env.ADMIN_SESSION_ATTACHMENTS_V2 = "enabled";
  assert.match((await options.handler(ctx, new Request("https://fixture.convex.site/admin-verification-document", { method: "OPTIONS", headers: { origin } }))).headers.get("access-control-allow-headers"), /X-DBC-Admin-Session/);
  const path = "/admin-verification-document";
  const headers = { authorization: "Bearer fixture-identity-jwt", "x-dbc-admin-session": session };
  assert.equal((await document.handler(ctx, request(path, headers))).status, 200);
  assert.equal(received.at(-1).token, session);
  assert.equal((await document.handler(ctx, request(path, { authorization: `Bearer ${session}` }))).status, 403);
  assert.equal((await document.handler(ctx, request(path, { "x-dbc-admin-session": session }))).status, 403);
  assert.equal((await document.handler(ctx, request(path, { ...headers, "x-dbc-admin-session": "malformed" }))).status, 403);
  identity = "other";
  assert.equal((await document.handler(ctx, request(path, headers))).status, 403);
  identity = "admin-fixture";
  assert.equal((await attachment.handler(ctx, request("/chat-attachment?admin=1&download=fixture", headers))).status, 200);
  assert.equal(received.at(-1).token, session);
  assert.equal((await attachment.handler(ctx, request("/chat-attachment?admin=1&download=fixture", { authorization: `Bearer ${session}` }))).status, 403);
  const customerCtx = { ...ctx, runMutation: async (_ref, args) => { assert.equal(args.token, "customer-fixture"); return { storageId: "file", size: bytes.length, sha256: digest, name: "file.pdf" }; } };
  assert.equal((await attachment.handler(customerCtx, request("/chat-attachment?download=fixture", { authorization: "Bearer customer-fixture" }))).status, 200);
  delete process.env.ADMIN_SESSION_VERIFICATION_V2;
  const legacyCtx = { ...ctx, runMutation: async (_ref, args) => { assert.equal(args.token, "legacy-fixture"); return { storageId: "file", size: bytes.length, sha256: digest, contentType: "application/pdf" }; } };
  assert.equal((await document.handler(legacyCtx, request(path, { authorization: "Bearer legacy-fixture", "x-dbc-admin-session": session }))).status, 200);
  console.log("PASS scoped admin HTTP transport: dual headers, missing credentials, identity denial, customer and legacy separation; identity validation mocked.");
})().catch(error => { console.error(error); process.exitCode = 1; });
