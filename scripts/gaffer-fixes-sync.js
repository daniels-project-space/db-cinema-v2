#!/usr/bin/env node
/** Narrow, reviewable rollout: no catalogue rebuild, key changes, model changes, or deletions.
 * node --env-file=.env.local scripts/gaffer-fixes-sync.js [--apply]
 */
const { PROMPT } = require("./gaffer-system-prompt");
const { PARTNER_DOC } = require("./gaffer-knowledge");
const { NEW_TOOLS } = require("./gaffer-agent-sync");
const API = "https://api.elevenlabs.io/v1/convai";
const ID = process.env.GAFFER_AGENT_ID || "agent_4601kvk2pfznfrws6ah700jnxvfv";
const MAX_DURATION_SECONDS = 3600;

async function main() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is required");
  const call = async (path, body, method = "POST") => {
    const response = await fetch(API + path, {
      method: body ? method : "GET",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  };
  const agent = await call(`/agents/${ID}`);
  const current = agent.conversation_config.agent.prompt;
  const name = "request_better_price";
  const tools = current.tools || [];
  const oldPartner = (current.knowledge_base || []).find((d) => d.name.includes("FORM / SEVEN collaboration"));
  const partnerName = "Db Cinema — the FORM / SEVEN collaboration (AI fact-check 2026-09-13)";
  const needsPartner = oldPartner?.name !== partnerName;
  const missingTool = !tools.some((t) => t.name === name);
  console.log(JSON.stringify({ agent: agent.name, callLimit: { before: agent.conversation_config.conversation?.max_duration_seconds, after: MAX_DURATION_SECONDS }, promptChanged: current.prompt !== PROMPT, addTool: missingTool, replacePartnerBrief: needsPartner, retainedCatalogueDocuments: (current.knowledge_base || []).length - Number(!!oldPartner), modelUnchanged: true }, null, 2));
  if (!process.argv.includes("--apply")) { console.log("Dry run; no provider changes made."); return; }
  const ids = [...(current.tool_ids || [])];
  if (missingTool) {
    const created = await call("/tools", { tool_config: NEW_TOOLS.find((t) => t.name === name) });
    ids.push(created.id);
  }
  let kb = [...(current.knowledge_base || [])];
  if (needsPartner) {
    const created = await call("/knowledge-base/text", { name: partnerName, text: PARTNER_DOC });
    kb = kb.filter((d) => d.id !== oldPartner?.id);
    kb.push({ type: "text", name: partnerName, id: created.id, usage_mode: "auto" });
  }
  await call(`/agents/${ID}`, {
    conversation_config: {
      conversation: { max_duration_seconds: MAX_DURATION_SECONDS },
      agent: { prompt: { prompt: PROMPT, tool_ids: ids, knowledge_base: kb } },
    },
  }, "PATCH");
  const after = await call(`/agents/${ID}`);
  const prompt = after.conversation_config.agent.prompt;
  if (after.conversation_config.conversation.max_duration_seconds !== MAX_DURATION_SECONDS || prompt.prompt !== PROMPT || !prompt.tools.some((t) => t.name === name) || !prompt.knowledge_base.some((d) => d.name === partnerName)) throw new Error("Provider verification failed");
  console.log("Verified: one-hour limit, requested-price tool, corrected prompt and partner brief. Previous knowledge document retained for rollback.");
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { MAX_DURATION_SECONDS };
