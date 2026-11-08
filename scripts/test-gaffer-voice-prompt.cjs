const assert = require("node:assert/strict");
const { load } = require("./lib/rentalTestHarness.cjs");
const { GAFFER_VOICE_PROMPT } = require("./lib/gafferVoicePrompt.cjs");
const { syncGafferVoiceAgentPrompt } = require("./lib/gafferVoiceAgentPrompt.cjs");
const { pageBrief } = load("src/components/gaffer/callContext.ts");

assert.match(GAFFER_VOICE_PROMPT, /one quote call for the complete item list/i);
assert.match(GAFFER_VOICE_PROMPT, /item_2 through item_8/i);
assert.match(GAFFER_VOICE_PROMPT, /shared stock is checked together/i);
assert.doesNotMatch(GAFFER_VOICE_PROMPT, /separate item calls do not confirm shared stock/i);
assert.match(GAFFER_VOICE_PROMPT, /Never combine different items into one field or omit an item/i);
assert.match(GAFFER_VOICE_PROMPT, /complete rental listings or kits/i);
assert.match(GAFFER_VOICE_PROMPT, /An FX3 body is not a request for another camera/i);
assert.match(GAFFER_VOICE_PROMPT, /Quote gear hire only; do not add deposits/i);
assert.match(GAFFER_VOICE_PROMPT, /clear shoot context/i);
assert.match(GAFFER_VOICE_PROMPT, /camera-only\/no-extras request/i);
assert.match(GAFFER_VOICE_PROMPT, /Call request_callback only when the caller explicitly asks/i);
assert.doesNotMatch(GAFFER_VOICE_PROMPT, /Always call request_callback|for any booking, inquiry, issue/i);
assert.match(GAFFER_VOICE_PROMPT, /The Grand Building, Trafalgar Square, London, WC2N 5EJ/);
assert.match(GAFFER_VOICE_PROMPT, /outside the Waterstones bookstore at the confirmed time/);
assert.match(GAFFER_VOICE_PROMPT, /Never infer booking status from payment, a saved card or an estimate/);
assert.match(GAFFER_VOICE_PROMPT, /Before speaking, choose one considered answer/i,
  "the agent should settle on its answer before beginning to speak");
assert.match(GAFFER_VOICE_PROMPT, /do not voice provisional conclusions, change conclusions mid-response, or restart your own active response/i,
  "the agent must not revise or interrupt its own spoken response");
assert.match(GAFFER_VOICE_PROMPT, /always yield if the caller interrupts/i,
  "the response-completion rule must preserve caller barge-in");

const salesCallBrief = pageBrief("/gear").brief;
assert.match(salesCallBrief, /Quote the gear hire daily rate and rental total only/i);
assert.match(salesCallBrief, /If asked directly about deposit or security policy, explain it separately/i);
assert.match(salesCallBrief, /clear shoot need/i);
assert.doesNotMatch(salesCallBrief, /Quote the daily rate and the refundable holding deposit/i);

const toolIds = ["quote-tool", "stock-tool"];
const initialAgent = { conversation_config: {
  agent: { first_message: "Hello", prompt: { prompt: "old prompt", tool_ids: toolIds, tools: [{ tool_id: "quote-tool" }, { tool_id: "stock-tool" }] } },
  turn: { turn_eagerness: "eager", speculative_turn: true, turn_timeout: 7 },
  tts: { voice_id: "voice-kept", model_id: "model-kept" },
} };
let agent = structuredClone(initialAgent);
const calls = [];
const fetchImpl = async (_url, options = {}) => {
  const method = options.method ?? "GET";
  calls.push({ method, body: options.body ? JSON.parse(options.body) : null });
  if (method === "PATCH") {
    const patch = JSON.parse(options.body).conversation_config;
    Object.assign(agent.conversation_config.agent.prompt, patch.agent.prompt);
    Object.assign(agent.conversation_config.turn, patch.turn);
  }
  return { ok: true, status: 200, json: async () => structuredClone(agent) };
};

(async () => {
  const preview = await syncGafferVoiceAgentPrompt({
    agentId: "fixture-agent", apiKey: "fixture-key", prompt: GAFFER_VOICE_PROMPT, fetchImpl,
  });
  assert.equal(preview.mode, "dry-run");
  assert.deepEqual(preview.turnSettings, { turn_eagerness: "normal", speculative_turn: false });
  assert.deepEqual(calls.map(call => call.method), ["GET"], "default run must stay read-only");

  const applied = await syncGafferVoiceAgentPrompt({
    agentId: "fixture-agent", apiKey: "fixture-key", prompt: GAFFER_VOICE_PROMPT, apply: true, fetchImpl,
  });
  assert.equal(applied.mode, "applied-and-verified");
  assert.deepEqual(calls.slice(1).map(call => call.method), ["GET", "PATCH", "GET"]);
  assert.deepEqual(calls[2].body.conversation_config, {
    agent: { prompt: { prompt: GAFFER_VOICE_PROMPT } },
    turn: { turn_eagerness: "normal", speculative_turn: false },
  }, "the release update changes only the reviewed prompt and turn settings");
  assert.equal(agent.conversation_config.tts.voice_id, "voice-kept");
  assert.deepEqual(agent.conversation_config.agent.prompt.tool_ids, toolIds);
  assert.equal(agent.conversation_config.agent.first_message, "Hello");
  assert.equal(agent.conversation_config.turn.turn_timeout, 7, "other turn settings stay untouched");
  assert.equal(agent.conversation_config.turn.turn_eagerness, "normal");
  assert.equal(agent.conversation_config.turn.speculative_turn, false);
  assert.equal((await syncGafferVoiceAgentPrompt({
    agentId: "fixture-agent", apiKey: "fixture-key", prompt: GAFFER_VOICE_PROMPT, fetchImpl,
  })).mode, "already-current");

  let rollbackAgent = structuredClone(initialAgent);
  let ignoreFirstSpeculativeChange = true;
  const rollbackFetch = async (_url, options = {}) => {
    if ((options.method ?? "GET") === "PATCH") {
      const patch = JSON.parse(options.body).conversation_config;
      Object.assign(rollbackAgent.conversation_config.agent.prompt, patch.agent.prompt);
      Object.assign(rollbackAgent.conversation_config.turn, patch.turn);
      if (ignoreFirstSpeculativeChange) {
        rollbackAgent.conversation_config.turn.speculative_turn = true;
        ignoreFirstSpeculativeChange = false;
      }
    }
    return { ok: true, status: 200, json: async () => structuredClone(rollbackAgent) };
  };
  await assert.rejects(syncGafferVoiceAgentPrompt({
    agentId: "fixture-agent", apiKey: "fixture-key", prompt: GAFFER_VOICE_PROMPT, apply: true, fetchImpl: rollbackFetch,
  }), /verification failed; a rollback was attempted/);
  assert.equal(rollbackAgent.conversation_config.agent.prompt.prompt, "old prompt", "failed readback restores the original prompt");
  assert.equal(rollbackAgent.conversation_config.turn.turn_eagerness, "eager", "failed readback restores prior turn eagerness");
  assert.equal(rollbackAgent.conversation_config.turn.speculative_turn, true, "failed readback restores prior speculative-turn setting");
  assert.equal(rollbackAgent.conversation_config.turn.turn_timeout, 7, "rollback preserves other turn settings");
  assert.deepEqual(rollbackAgent.conversation_config.agent.prompt.tool_ids, toolIds, "rollback retains attached tools");
  assert.equal(rollbackAgent.conversation_config.tts.voice_id, "voice-kept", "rollback retains the voice");
  console.log("PASS Gaffer voice update: concise answer policy, normal non-speculative turns, read-only preview, exact readback, rollback and preservation of tools, voice and other turn settings.");
})().catch(error => { console.error(error); process.exitCode = 1; });
