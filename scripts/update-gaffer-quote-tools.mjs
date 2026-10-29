import { readFileSync } from "node:fs";
import gafferVoiceQuoteTools from "./lib/gafferVoiceQuoteTools.cjs";

const { syncAgentQuoteTools } = gafferVoiceQuoteTools;
const agentId = process.env.GAFFER_VOICE_AGENT_ID ?? "agent_4601kvk2pfznfrws6ah700jnxvfv";
const apiKey = process.env.ELEVENLABS_API_KEY ??
  (process.env.ELEVENLABS_API_KEY_FILE ? readFileSync(process.env.ELEVENLABS_API_KEY_FILE, "utf8").trim() : "");
const apply = process.argv.includes("--apply");

const result = await syncAgentQuoteTools({ agentId, apiKey, apply });
for (const tool of result.updates) {
  const state = tool.changed ? (apply ? "updated" : "would update") : "already current";
  process.stdout.write(`${state}: ${tool.name} (${tool.id})\n`);
}
process.stdout.write(`Gaffer tool IDs preserved (${result.toolIds.length} attached).\n`);
