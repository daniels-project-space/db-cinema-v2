function attachedToolIds(prompt = {}) {
  const ids = new Set(Array.isArray(prompt.tool_ids) ? prompt.tool_ids.filter(id => typeof id === "string") : []);
  for (const tool of Array.isArray(prompt.tools) ? prompt.tools : []) {
    const id = tool?.tool_id ?? tool?.id;
    if (typeof id === "string") ids.add(id);
  }
  return [...ids].sort();
}

async function syncGafferVoiceAgentPrompt({ agentId, apiKey, prompt, apply = false, fetchImpl = fetch }) {
  if (typeof agentId !== "string" || !agentId.trim()) throw new Error("A Gaffer voice agent ID is required.");
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("An ElevenLabs API key is required.");
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("The reviewed Gaffer prompt is required.");

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
  const base = { agentId, promptLength: prompt.length, attachedTools: originalToolIds.length, toolIds: originalToolIds };
  if (originalPrompt === prompt) return { mode: "already-current", ...base };
  if (!apply) return { mode: "dry-run", ...base };

  await request("PATCH", { conversation_config: { agent: { prompt: { prompt } } } });
  const after = await request();
  const afterConfig = after?.conversation_config ?? {};
  const afterPrompt = afterConfig?.agent?.prompt?.prompt ?? "";
  const afterToolIds = attachedToolIds(afterConfig?.agent?.prompt);
  if (afterPrompt !== prompt || JSON.stringify(afterToolIds) !== JSON.stringify(originalToolIds)) {
    try {
      await request("PATCH", { conversation_config: { agent: { prompt: { prompt: originalPrompt } } } });
    } catch {}
    throw new Error("Gaffer prompt verification failed; a rollback was attempted.");
  }
  return { mode: "applied-and-verified", ...base };
}

module.exports = { attachedToolIds, syncGafferVoiceAgentPrompt };
