function attachedToolIds(prompt = {}) {
  const ids = new Set(Array.isArray(prompt.tool_ids) ? prompt.tool_ids.filter(id => typeof id === "string") : []);
  for (const tool of Array.isArray(prompt.tools) ? prompt.tools : []) {
    const id = tool?.tool_id ?? tool?.id;
    if (typeof id === "string") ids.add(id);
  }
  return [...ids].sort();
}

async function syncGafferVoiceAgentPrompt({
  agentId,
  apiKey,
  prompt,
  turnSettings = { turn_eagerness: "normal", speculative_turn: false },
  apply = false,
  fetchImpl = fetch,
}) {
  if (typeof agentId !== "string" || !agentId.trim()) throw new Error("A Gaffer voice agent ID is required.");
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("An ElevenLabs API key is required.");
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("The reviewed Gaffer prompt is required.");
  if (!turnSettings || !["normal", "eager", "patient"].includes(turnSettings.turn_eagerness) || typeof turnSettings.speculative_turn !== "boolean") {
    throw new Error("Reviewed Gaffer turn-taking settings are invalid.");
  }

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
  const config = before?.conversation_config ?? {};
  const originalPrompt = config?.agent?.prompt?.prompt ?? "";
  const originalToolIds = attachedToolIds(config?.agent?.prompt);
  const originalTurn = config?.turn ?? {};
  const currentTurn = {
    turn_eagerness: originalTurn.turn_eagerness ?? null,
    speculative_turn: originalTurn.speculative_turn ?? null,
  };
  const turnMatches = currentTurn.turn_eagerness === turnSettings.turn_eagerness && currentTurn.speculative_turn === turnSettings.speculative_turn;
  const base = {
    agentId,
    promptLength: prompt.length,
    attachedTools: originalToolIds.length,
    toolIds: originalToolIds,
    turnSettings: { ...turnSettings },
  };
  if (originalPrompt === prompt && turnMatches) return { mode: "already-current", ...base };
  if (!apply) return { mode: "dry-run", ...base };

  await request("PATCH", { conversation_config: {
    agent: { prompt: { prompt } },
    turn: {
      turn_eagerness: turnSettings.turn_eagerness,
      speculative_turn: turnSettings.speculative_turn,
    },
  } });
  const after = await request();
  const afterConfig = after?.conversation_config ?? {};
  const afterPrompt = afterConfig?.agent?.prompt?.prompt ?? "";
  const afterToolIds = attachedToolIds(afterConfig?.agent?.prompt);
  const afterTurn = afterConfig?.turn ?? {};
  const afterTurnMatches = afterTurn.turn_eagerness === turnSettings.turn_eagerness && afterTurn.speculative_turn === turnSettings.speculative_turn;
  if (afterPrompt !== prompt || JSON.stringify(afterToolIds) !== JSON.stringify(originalToolIds) || !afterTurnMatches) {
    try {
      await request("PATCH", { conversation_config: {
        agent: { prompt: { prompt: originalPrompt } },
        turn: {
          ...(originalTurn.turn_eagerness !== undefined ? { turn_eagerness: originalTurn.turn_eagerness } : {}),
          ...(originalTurn.speculative_turn !== undefined ? { speculative_turn: originalTurn.speculative_turn } : {}),
        },
      } });
    } catch {}
    throw new Error("Gaffer prompt/turn verification failed; a rollback was attempted.");
  }
  return { mode: "applied-and-verified", ...base };
}

module.exports = { attachedToolIds, syncGafferVoiceAgentPrompt };
