const { configuredGafferVoiceAgentIds, syncGafferVoiceTurnSettingsForAgents } = require("./lib/gafferVoiceTurnSettings.cjs");

syncGafferVoiceTurnSettingsForAgents({
  agentIds: configuredGafferVoiceAgentIds(),
  apiKey: process.env.ELEVENLABS_API_KEY,
  apply: process.argv.includes("--apply"),
}).then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(JSON.stringify({
    mode: "failed",
    failedAgentId: error.failedAgentId ?? null,
    completedAgentIds: error.completedAgentIds ?? [],
    error: error.message,
  }));
  process.exitCode = 1;
});
