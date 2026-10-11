const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");

const http = load("convex/http.ts").default;
const path = "/dbcinema/manager-marketing-tags";
const handler = http.lookup(path, "POST")?.[0];
const secret = "fixture-rm-sync-secret";
const changes = [{ productId: 12001, marketingOnly: true, mode: "manual", updatedAt: 500 }];
const request = (body, token = secret, contentType = "application/json") => new Request(`https://fixture.convex.site${path}`, {
  method: "POST",
  headers: { ...(contentType ? { "content-type": contentType } : {}), ...(token ? { "x-dbcinema-sync-token": token } : {}) },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

(async () => {
  const previousSecret = process.env.RMV2_WEBHOOK_SECRET;
  try {
    assert.equal(typeof handler, "function", "server-only write route is registered");
    assert.equal(http.lookup(path, "GET"), null, "there is no public GET route");
    process.env.RMV2_WEBHOOK_SECRET = "";
    let calls = 0;
    const denied = await handler({ runMutation: async () => { calls++; } }, request({ protocolVersion: 1, changes }));
    assert.equal(denied.status, 403);
    process.env.RMV2_WEBHOOK_SECRET = secret;
    for (const [req, status] of [
      [request({ protocolVersion: 1, changes }, "wrong"), 403],
      [request({ protocolVersion: 1, changes }, secret, "text/plain"), 415],
      [request("not-json"), 400],
      [request({ protocolVersion: 2, changes }), 400],
      [request({ protocolVersion: 1, changes: [{ ...changes[0], productId: 0 }] }), 400],
      [request({ protocolVersion: 1, changes: [{ ...changes[0], extra: "rejected" }] }), 400],
      [request({ protocolVersion: 1, changes: [changes[0], changes[0]] }), 400],
    ]) {
      assert.equal((await handler({ runMutation: async () => { calls++; } }, req)).status, status);
    }
    assert.equal(calls, 0, "invalid credentials and payloads never reach the mutation");

    let mutationRef, mutationArgs;
    const response = await handler({ runMutation: async (ref, args) => {
      mutationRef = ref;
      mutationArgs = args;
      return { protocolVersion: 1, acknowledged: 1, missing: 0, stale: 0 };
    } }, request({ protocolVersion: 1, changes }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(mutationRef, "sync.applyManagerMarketingTags");
    assert.deepEqual(mutationArgs, { changes });
    assert.deepEqual(await response.json(), { protocolVersion: 1, acknowledged: 1, missing: 0, stale: 0 });

    const failed = await handler({ runMutation: async () => { throw Error("private mutation detail"); } }, request({ protocolVersion: 1, changes }));
    assert.equal(failed.status, 500);
    assert.doesNotMatch(await failed.text(), /private mutation detail/);
    console.log("PASS actual manager-tag HTTP route: auth and validation reject before writes; valid update reaches only the internal mutation and returns its receipt; errors do not leak details.");
  } finally {
    if (previousSecret === undefined) delete process.env.RMV2_WEBHOOK_SECRET;
    else process.env.RMV2_WEBHOOK_SECRET = previousSecret;
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
