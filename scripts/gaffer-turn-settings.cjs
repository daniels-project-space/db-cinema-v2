const { syncGafferVoiceTurnSettings } = require("./lib/gafferVoiceTurnSettings.cjs");

syncGafferVoiceTurnSettings({
  agentId: process.env.GAFFER_AGENT_ID || "agent_4601kvk2pfznfrws6ah700jnxvfv",
  apiKey: process.env.ELEVENLABS_API_KEY,
  apply: process.argv.includes("--apply"),
}).then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
