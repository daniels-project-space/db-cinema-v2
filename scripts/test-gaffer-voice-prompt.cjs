const assert = require("node:assert/strict");
const { GAFFER_VOICE_PROMPT } = require("./lib/gafferVoicePrompt.cjs");
const { syncGafferVoiceAgentPrompt } = require("./lib/gafferVoiceAgentPrompt.cjs");

assert.match(GAFFER_VOICE_PROMPT, /one quote call per distinct requested item/i);
assert.match(GAFFER_VOICE_PROMPT, /separate item calls do not confirm shared stock across the whole group/i);
assert.match(GAFFER_VOICE_PROMPT, /Never combine different items into one field or omit an item/i);
assert.match(GAFFER_VOICE_PROMPT, /complete rental listings or kits/i);
assert.match(GAFFER_VOICE_PROMPT, /An FX3 body is not a request for another camera/i);
assert.match(GAFFER_VOICE_PROMPT, /Quote gear hire only; do not add deposits/i);
assert.match(GAFFER_VOICE_PROMPT, /Call request_callback only when the caller explicitly asks/i);
assert.doesNotMatch(GAFFER_VOICE_PROMPT, /Always call request_callback|for any booking, inquiry, issue/i);

const toolIds = ["quote-tool", "stock-tool"];
const initialAgent = { conversation_config: {
  agent: { first_message: "Hello", prompt: { prompt: "old prompt", tool_ids: toolIds, tools: [{ tool_id: "quote-tool" }, { tool_id: "stock-tool" }] } },
  tts: { voice_id: "voice-kept", model_id: "model-kept" },
} };
let agent = structuredClone(initialAgent);
const calls = [];
const fetchImpl = async (_url, options = {}) => {
  const method = options.method ?? "GET";
  calls.push({ method, body: options.body ? JSON.parse(options.body) : null });
  if (method === "PATCH") {
    const patch = JSON.parse(options.body).conversation_config;
    agent.conversation_config.agent.prompt.prompt = patch.agent.prompt.prompt;
  }
  return { ok: true, status: 200, json: async () => structuredClone(agent) };
};

(async () => {
  const preview = await syncGafferVoiceAgentPrompt({
    agentId: "fixture-agent", apiKey: "fixture-key", prompt: GAFFER_VOICE_PROMPT, fetchImpl,
  });
  assert.equal(preview.mode, "dry-run");
  assert.deepEqual(calls.map(call => call.method), ["GET"], "default run must stay read-only");

  const applied = await syncGafferVoiceAgentPrompt({
    agentId: "fixture-agent", apiKey: "fixture-key", prompt: GAFFER_VOICE_PROMPT, apply: true, fetchImpl,
  });
  assert.equal(applied.mode, "applied-and-verified");
  assert.deepEqual(calls.slice(1).map(call => call.method), ["GET", "PATCH", "GET"]);
  assert.deepEqual(calls[2].body.conversation_config, { agent: { prompt: { prompt: GAFFER_VOICE_PROMPT } } },
    "the live update must change only prompt text, preserving voice and attached tools");
  assert.equal(agent.conversation_config.tts.voice_id, "voice-kept");
  assert.deepEqual(agent.conversation_config.agent.prompt.tool_ids, toolIds);
  assert.equal((await syncGafferVoiceAgentPrompt({
    agentId: "fixture-agent", apiKey: "fixture-key", prompt: GAFFER_VOICE_PROMPT, fetchImpl,
  })).mode, "already-current");
  console.log("PASS Gaffer voice prompt: concise direct answers, exact quantities, consented alternatives, and callback only for explicit/unresolved cases; dry-run and apply preserve the live tool and voice configuration.");
})().catch(error => { console.error(error); process.exitCode = 1; });
