const assert = require("node:assert/strict");
const {
  configuredGafferVoiceAgentIds,
  syncGafferVoiceTurnSettings,
  syncGafferVoiceTurnSettingsForAgents,
} = require("./lib/gafferVoiceTurnSettings.cjs");

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
  assert.deepEqual(calls[2].body, { conversation_config: { turn: {
    turn_eagerness: "normal",
    speculative_turn: false,
    interruption_ignore_terms: ["mm-hmm", "mm hmm", "mhm", "uh-huh", "uh huh", "hmm"],
    merge_with_default_ignore_terms: true,
  } } });
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

  assert.deepEqual(configuredGafferVoiceAgentIds({
    GAFFER_AGENT_ID: "sales-agent",
    NEXT_PUBLIC_GAFFER_SUPPORT_AGENT_ID: "support-agent",
  }), ["sales-agent", "support-agent"]);
  assert.deepEqual(configuredGafferVoiceAgentIds({
    GAFFER_AGENT_ID: "same-agent",
    GAFFER_SUPPORT_AGENT_ID: "same-agent",
  }), ["same-agent"]);

  const agents = new Map([["sales-agent", structuredClone(original)], ["support-agent", structuredClone(original)]]);
  const multiCalls = [];
  const multiFetch = async (url, options) => {
    const agentId = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
    multiCalls.push({ agentId, method: options.method, body: options.body && JSON.parse(options.body) });
    const current = agents.get(agentId);
    if (!current) return { ok: false, status: 503, json: async () => ({}) };
    if (options.method === "PATCH") Object.assign(current.conversation_config.turn, JSON.parse(options.body).conversation_config.turn);
    return { ok: true, status: 200, json: async () => structuredClone(current) };
  };
  const multiArgs = { agentIds: ["sales-agent", "support-agent"], apiKey: "fixture-key", fetchImpl: multiFetch };
  const preview = await syncGafferVoiceTurnSettingsForAgents(multiArgs);
  assert.equal(preview.mode, "dry-run");
  assert.deepEqual(preview.agents.map(agent => agent.agentId), ["sales-agent", "support-agent"]);
  assert.deepEqual(multiCalls.map(call => call.method), ["GET", "GET"], "dry run only reads both configured agents");
  multiCalls.length = 0;
  const applied = await syncGafferVoiceTurnSettingsForAgents({ ...multiArgs, apply: true });
  assert.equal(applied.mode, "applied-and-verified");
  assert.deepEqual(multiCalls.map(call => [call.agentId, call.method]), [
    ["sales-agent", "GET"], ["sales-agent", "PATCH"], ["sales-agent", "GET"],
    ["support-agent", "GET"], ["support-agent", "PATCH"], ["support-agent", "GET"],
  ]);
  for (const agent of agents.values()) assert.deepEqual(
    {
      turn_eagerness: agent.conversation_config.turn.turn_eagerness,
      speculative_turn: agent.conversation_config.turn.speculative_turn,
      interruption_ignore_terms: agent.conversation_config.turn.interruption_ignore_terms,
      merge_with_default_ignore_terms: agent.conversation_config.turn.merge_with_default_ignore_terms,
    },
    {
      turn_eagerness: "normal",
      speculative_turn: false,
      interruption_ignore_terms: ["mm-hmm", "mm hmm", "mhm", "uh-huh", "uh huh", "hmm"],
      merge_with_default_ignore_terms: true,
    },
  );
  await assert.rejects(
    syncGafferVoiceTurnSettingsForAgents({ agentIds: ["sales-agent", "missing-agent"], apiKey: "fixture-key", fetchImpl: multiFetch }),
    error => error.failedAgentId === "missing-agent" && error.completedAgentIds[0] === "sales-agent",
    "partial support-agent failures identify the failed and already-inspected agent without hiding partial progress",
  );

  console.log("PASS Gaffer turn settings: read-only preview, minimal update, readback, all configured agents, and partial-failure reporting.");
})().catch(error => { console.error(error); process.exitCode = 1; });
