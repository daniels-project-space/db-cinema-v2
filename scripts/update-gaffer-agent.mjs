import gafferPrompt from "./lib/gafferVoicePrompt.cjs";
import gafferAgentUpdater from "./lib/gafferVoiceAgentPrompt.cjs";

const agentId = process.env.GAFFER_VOICE_AGENT_ID ?? "agent_4601kvk2pfznfrws6ah700jnxvfv";
const apiKey = process.env.ELEVENLABS_API_KEY ?? "";
const apply = process.argv.includes("--apply");
const result = await gafferAgentUpdater.syncGafferVoiceAgentPrompt({
  agentId,
  apiKey,
  prompt: gafferPrompt.GAFFER_VOICE_PROMPT,
  apply,
});
console.log(`${result.mode}: Gaffer voice prompt (${result.promptLength} characters); ${result.attachedTools} tools attached, IDs preserved.`);
