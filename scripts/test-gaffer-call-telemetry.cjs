const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { load, db, tables } = require("./lib/rentalTestHarness.cjs");

process.env.ADMIN_TOKEN = "fixture-owner";
const analytics = load("convex/analytics.ts");
const callKey = crypto.randomUUID();
const conversationId = "conv_synthetic_telemetry";
const now = Date.now();
const scheduled = [];
const ctx = { db, scheduler: { runAfter: async (...args) => scheduled.push(args) } };
const record = (overrides = {}) => analytics.recordGafferCallTelemetry.handler(ctx, {
  callKey,
  kind: "connected",
  sequence: 1,
  occurredAt: Date.now(),
  ...overrides,
});

(async () => {
  assert.deepEqual(await analytics.gafferCallTelemetryForAdmin.handler(ctx, { token: "wrong", conversationId }), null,
    "diagnostics are unavailable without the admin token");

  const events = [
    { kind: "conversation_metadata", conversationId, sequence: 1 },
    { kind: "connected", conversationId, sequence: 2 },
    { kind: "interruption", providerEventId: 11, agentWasSpeaking: true, sequence: 3 },
    { kind: "agent_correction", providerEventId: 12, originalResponseChars: 83, correctedResponseChars: 41, sequence: 4 },
    { kind: "agent_response_start", providerEventId: 13, sequence: 5 },
    { kind: "agent_response_stop", providerEventId: 13, sequence: 6 },
    { kind: "agent_speaking_start", sequence: 7 },
    { kind: "agent_speaking_stop", sequence: 8 },
  ];
  for (const event of events) {
    const result = await record({ ...event, occurredAt: now, original_agent_response: "must not persist", transcript: "must not persist" });
    assert.deepEqual(result, { recorded: true });
  }
  const initialTrace = (tables.get("gaffer_call_telemetry") ?? []).find(row => row.callKey === callKey);
  assert.equal(initialTrace.events.find(event => event.kind === "interruption").agentWasSpeaking, true,
    "the trace distinguishes caller interruptions that arrive during Gaffer speech");
  assert.deepEqual(
    [initialTrace.events.find(event => event.kind === "agent_correction").originalResponseChars, initialTrace.events.find(event => event.kind === "agent_correction").correctedResponseChars],
    [83, 41], "the trace stores response lengths but no spoken content",
  );
  assert.deepEqual(await record({ kind: "interruption", providerEventId: 11, sequence: 3, occurredAt: now }),
    { recorded: false, reason: "duplicate" }, "retried callbacks are idempotently ignored");
  assert.deepEqual(await record({ kind: "interruption", providerEventId: 14, sequence: 9, occurredAt: now, conversationId: "conv_other_call" }),
    { recorded: false, reason: "conversation_mismatch" }, "a telemetry key cannot be rebound to another provider call");

  for (let sequence = 9; sequence <= 132; sequence++)
    await record({ kind: "agent_speaking_start", sequence, occurredAt: now });
  const stored = (tables.get("gaffer_call_telemetry") ?? []).find(row => row.callKey === callKey);
  assert.ok(stored);
  assert.equal(stored.eventCount, 132);
  assert.equal(stored.events.length, 128, "the per-call event trace has a hard size cap");
  assert.equal(stored.counts.interruption, 1);
  assert.equal(stored.counts.agentCorrection, 1);
  assert.equal(stored.counts.agentResponseStart, 1);
  assert.equal(stored.counts.agentResponseStop, 1);
  assert.equal(stored.counts.agentSpeakingStart, 125);
  assert(!JSON.stringify(stored).includes("must not persist"), "caller/agent content is not written even if extra input is supplied");

  const admin = await analytics.gafferCallTelemetryForAdmin.handler(ctx, { token: "fixture-owner", conversationId });
  assert.equal(admin.eventCount, 132);
  assert.equal(admin.timelineTruncated, true);
  assert.equal(admin.events.length, 128);
  assert.equal(admin.events.at(-1).sequence, 132);
  assert.equal(Object.hasOwn(admin, "callKey"), false, "the admin read model does not expose the random client key");
  assert(!JSON.stringify(admin).includes("must not persist"));

  await assert.rejects(record({ callKey: "not-a-uuid" }), /Invalid Gaffer call telemetry key/);
  await assert.rejects(record({ kind: "raw_transcript", sequence: 133 }), /Invalid Gaffer call telemetry event/);
  await assert.rejects(record({ kind: "connected", providerEventId: 4, sequence: 133 }), /Invalid Gaffer provider event identifier/);
  await assert.rejects(record({ kind: "connected", agentWasSpeaking: true, sequence: 133 }), /Speaking state is only valid/);
  await assert.rejects(record({ kind: "agent_correction", originalResponseChars: 200001, sequence: 133 }), /Invalid original Gaffer response length/);
  await assert.rejects(record({ kind: "agent_correction", correctedResponseChars: 1.5, sequence: 133 }), /Invalid corrected Gaffer response length/);
  await assert.rejects(record({ occurredAt: Date.now() - 10 * 60 * 1000, sequence: 133 }), /Invalid Gaffer call telemetry timestamp/);

  const expiredKey = crypto.randomUUID();
  await record({ callKey: expiredKey, kind: "connected", sequence: 1, occurredAt: Date.now() });
  const expired = (tables.get("gaffer_call_telemetry") ?? []).find(row => row.callKey === expiredKey);
  await db.patch(expired._id, { expiresAt: Date.now() - 1 });
  const purge = await analytics.purgeGafferCallTelemetry.handler(ctx, {});
  assert.equal(purge.purged, 1);
  assert.equal((tables.get("gaffer_call_telemetry") ?? []).some(row => row.callKey === expiredKey), false);
  assert.equal(scheduled.length, 0, "small expiry batches do not schedule unnecessary follow-up work");

  const globalRateLimit = (tables.get("rate_limits") ?? []).find(row => row.key === "gaffer-call-telemetry:global");
  await db.patch(globalRateLimit._id, { windowStart: Date.now(), count: 1200 });
  const limitedKey = crypto.randomUUID();
  assert.deepEqual(await record({ callKey: limitedKey, sequence: 1, occurredAt: Date.now() }),
    { recorded: false, reason: "rate_limited" }, "a saturated global guard drops telemetry instead of allowing more writes");
  assert.equal((tables.get("rate_limits") ?? []).some(row => row.key === `gaffer-call-telemetry:${limitedKey}`), false,
    "globally rate-limited calls do not create per-call limiter rows");

  console.log("PASS Gaffer call telemetry: strict event allowlist, bounded and expiring storage, idempotency, admin-only readback, and no speech content persisted.");
})().catch(error => { console.error(error); process.exitCode = 1; });
