const assert = require("node:assert/strict");
const { syncGafferVoiceTurnSettings } = require("./lib/gafferVoiceTurnSettings.cjs");

const original = { conversation_config: {
  turn: { turn_eagerness: "eager", speculative_turn: true, turn_timeout: 7, silence_end_call_timeout: 90 },
  conversation: { client_events: ["audio", "interruption"] },
  agent: { prompt: { tool_ids: ["fixture-tool"] } },
  tts: { voice_id: "fixture-voice" },
} };
let agent = structuredClone(original);
const calls = [];
const fetchImpl = async (_url, options) => {
  calls.push({ method: options.method, body: options.body && JSON.parse(options.body) });
  if (options.method === "PATCH") Object.assign(agent.conversation_config.turn, JSON.parse(options.body).conversation_config.turn);
  return { ok: true, status: 200, json: async () => structuredClone(agent) };
};

(async () => {
  const args = { agentId: "fixture-agent", apiKey: "fixture-key", fetchImpl };
  assert.equal((await syncGafferVoiceTurnSettings(args)).mode, "dry-run");
  assert.deepEqual(calls.map(call => call.method), ["GET"]);
  assert.equal((await syncGafferVoiceTurnSettings({ ...args, apply: true })).mode, "applied-and-verified");
  assert.deepEqual(calls.slice(1).map(call => call.method), ["GET", "PATCH", "GET"]);
  assert.deepEqual(calls[2].body, { conversation_config: { turn: { turn_eagerness: "normal", speculative_turn: false } } });
  assert.equal(agent.conversation_config.turn.silence_end_call_timeout, 90);
  assert.deepEqual(agent.conversation_config.conversation.client_events, ["audio", "interruption"]);
  assert.deepEqual(agent.conversation_config.agent, original.conversation_config.agent);
  assert.deepEqual(agent.conversation_config.tts, original.conversation_config.tts);
  assert.equal((await syncGafferVoiceTurnSettings(args)).mode, "already-current");
  agent = structuredClone(original);
  const ignoredPatch = async (_url, options) => ({ ok: true, status: 200, json: async () => structuredClone(agent) });
  await assert.rejects(syncGafferVoiceTurnSettings({ ...args, fetchImpl: ignoredPatch, apply: true }), /did not confirm/);
  const destructivePatch = async (_url, options) => {
    if (options.method === "PATCH") {
      Object.assign(agent.conversation_config.turn, JSON.parse(options.body).conversation_config.turn);
      agent.conversation_config.conversation.client_events = ["audio"];
    }
    return { ok: true, status: 200, json: async () => structuredClone(agent) };
  };
  await assert.rejects(syncGafferVoiceTurnSettings({ ...args, fetchImpl: destructivePatch, apply: true }), /Other voice settings changed/);
  console.log("PASS Gaffer turn settings: read-only preview, minimal update, readback and failed-update detection.");
})().catch(error => { console.error(error); process.exitCode = 1; });
