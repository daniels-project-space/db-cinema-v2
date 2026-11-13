const { isDeepStrictEqual } = require("node:util");
const proposedTurnSettings = Object.freeze({
  turn_eagerness: "normal",
  speculative_turn: false,
  interruption_ignore_terms: Object.freeze(["mm-hmm", "mm hmm", "mhm", "uh-huh", "uh huh", "hmm"]),
  merge_with_default_ignore_terms: true,
});
const DEFAULT_GAFFER_AGENT_ID = "agent_4601kvk2pfznfrws6ah700jnxvfv";

function configuredGafferVoiceAgentIds(env = process.env) {
  const primary = String(env.GAFFER_AGENT_ID || env.NEXT_PUBLIC_GAFFER_AGENT_ID || DEFAULT_GAFFER_AGENT_ID).trim();
  const support = String(env.GAFFER_SUPPORT_AGENT_ID || env.NEXT_PUBLIC_GAFFER_SUPPORT_AGENT_ID || primary).trim();
  if (!primary || !support) throw new Error("Configured Gaffer voice agent IDs must not be empty.");
  return [...new Set([primary, support])];
}

async function syncGafferVoiceTurnSettings({ agentId, apiKey, apply = false, fetchImpl = fetch }) {
  if (typeof agentId !== "string" || !agentId.trim()) throw new Error("A Gaffer voice agent ID is required.");
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("An ElevenLabs API key is required.");
  const url = `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`;
  const request = async (method = "GET", body) => {
    const response = await fetchImpl(url, {
      method,
      headers: { "xi-api-key": apiKey, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`ElevenLabs ${method} failed with HTTP ${response.status}.`);
    return response.json();
  };
  const before = await request();
  const turn = before?.conversation_config?.turn;
  if (!turn || typeof turn !== "object") throw new Error("The voice agent did not return turn settings.");
  const previous = Object.fromEntries(Object.keys(proposedTurnSettings).map(key => [key, turn[key] ?? null]));
  if (Object.entries(proposedTurnSettings).every(([key, value]) => isDeepStrictEqual(turn[key], value))) return { mode: "already-current", previous, proposed: proposedTurnSettings };
  if (!apply) return { mode: "dry-run", previous, proposed: proposedTurnSettings };
  await request("PATCH", { conversation_config: { turn: proposedTurnSettings } });
  const after = await request();
  if (!Object.entries(proposedTurnSettings).every(([key, value]) => isDeepStrictEqual(after?.conversation_config?.turn?.[key], value)))
    throw new Error("ElevenLabs did not confirm the requested turn settings. Inspect the agent before retrying.");
  const unchangedTurn = value => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !(key in proposedTurnSettings)));
  const beforeConfig = before.conversation_config;
  const afterConfig = after.conversation_config;
  if (!isDeepStrictEqual(unchangedTurn(beforeConfig.turn), unchangedTurn(afterConfig.turn)) ||
      !isDeepStrictEqual(beforeConfig.conversation?.client_events, afterConfig.conversation?.client_events) ||
      !isDeepStrictEqual(beforeConfig.agent?.prompt, afterConfig.agent?.prompt) ||
      !isDeepStrictEqual(beforeConfig.tts, afterConfig.tts))
    throw new Error("Other voice settings changed during the update. Inspect the agent before retrying.");
  return { mode: "applied-and-verified", previous, proposed: proposedTurnSettings };
}

async function syncGafferVoiceTurnSettingsForAgents({ agentIds, apiKey, apply = false, fetchImpl = fetch }) {
  if (!Array.isArray(agentIds) || !agentIds.length || agentIds.some(id => typeof id !== "string" || !id.trim()))
    throw new Error("At least one Gaffer voice agent ID is required.");
  const uniqueIds = [...new Set(agentIds.map(id => id.trim()))];
  const agents = [];
  for (const agentId of uniqueIds) {
    try {
      agents.push({ agentId, ...(await syncGafferVoiceTurnSettings({ agentId, apiKey, apply, fetchImpl })) });
    } catch (error) {
      const failure = new Error(`Gaffer voice settings failed for ${agentId}: ${error instanceof Error ? error.message : "unknown provider error"}`);
      failure.failedAgentId = agentId;
      failure.completedAgentIds = agents.map(agent => agent.agentId);
      throw failure;
    }
  }
  return {
    mode: apply
      ? agents.some(agent => agent.mode === "applied-and-verified") ? "applied-and-verified" : "already-current"
      : agents.some(agent => agent.mode === "dry-run") ? "dry-run" : "already-current",
    agents,
  };
}

module.exports = { proposedTurnSettings, configuredGafferVoiceAgentIds, syncGafferVoiceTurnSettings, syncGafferVoiceTurnSettingsForAgents };
