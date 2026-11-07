const { isDeepStrictEqual } = require("node:util");
const proposedTurnSettings = Object.freeze({ turn_eagerness: "normal", speculative_turn: false });

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
  if (Object.entries(proposedTurnSettings).every(([key, value]) => turn[key] === value)) return { mode: "already-current", previous, proposed: proposedTurnSettings };
  if (!apply) return { mode: "dry-run", previous, proposed: proposedTurnSettings };
  await request("PATCH", { conversation_config: { turn: proposedTurnSettings } });
  const after = await request();
  if (!Object.entries(proposedTurnSettings).every(([key, value]) => after?.conversation_config?.turn?.[key] === value))
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

module.exports = { proposedTurnSettings, syncGafferVoiceTurnSettings };
