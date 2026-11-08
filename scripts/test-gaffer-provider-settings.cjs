const assert = require("node:assert/strict");
const { load, setMock } = require("./lib/rentalTestHarness.cjs");

const previousFetch = global.fetch;
const previousEnv = {
  NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  NEXT_PUBLIC_GAFFER_AGENT_ID: process.env.NEXT_PUBLIC_GAFFER_AGENT_ID,
  NEXT_PUBLIC_GAFFER_SUPPORT_AGENT_ID: process.env.NEXT_PUBLIC_GAFFER_SUPPORT_AGENT_ID,
};
process.env.NEXT_PUBLIC_CONVEX_URL = "https://synthetic.invalid";
process.env.ELEVENLABS_API_KEY = "synthetic-elevenlabs-key";
process.env.NEXT_PUBLIC_GAFFER_AGENT_ID = "agent-sales";
process.env.NEXT_PUBLIC_GAFFER_SUPPORT_AGENT_ID = "agent-support";

setMock("next/server", {
  NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) },
});
setMock("convex/browser", {
  ConvexHttpClient: class {
    async query(_ref, args) { return { ok: args.token === "admin-fixture" }; }
  },
});
setMock("@cvx/_generated/api", { api: { adminAuth: { verify: "adminAuth.verify" } } });

const requests = [];
global.fetch = async url => {
  requests.push(String(url));
  const sales = String(url).includes("agent-sales");
  return {
    ok: true,
    status: 200,
    json: async () => ({
      name: sales ? "Sales fixture" : "Support fixture",
      metadata: { updated_at_unix_secs: 123 },
      conversation_config: {
        turn: sales
          ? { turn_eagerness: "normal", turn_timeout: 12, noisy_environment_detection: true, noisy_environment_message: "Move somewhere quieter." }
          : { turn_eagerness: "patient", noisy_environment_detection: false },
        conversation: { client_events: sales ? ["interruption"] : [] },
        vad: { background_voice_detection: !sales },
        agent: { disable_first_message_interruptions: sales },
      },
    }),
  };
};

const route = load("src/app/api/admin/gaffer-calls/route.ts");
const request = body => ({ json: async () => body });

(async () => {
  const result = await route.POST(request({ token: "admin-fixture", action: "settings" }));
  assert.equal(result.status, 200);
  assert.equal(result.body.agents.length, 2);
  const sales = result.body.agents.find(agent => agent.agentId === "agent-sales");
  const support = result.body.agents.find(agent => agent.agentId === "agent-support");
  assert.equal(sales.noisyEnvironmentDetection, true);
  assert.equal(sales.noisyEnvironmentMessageConfigured, true);
  assert.equal(sales.backgroundVoiceDetection, false);
  assert.equal(support.noisyEnvironmentDetection, false);
  assert.equal(support.noisyEnvironmentMessageConfigured, null);
  assert.equal(support.backgroundVoiceDetection, true);
  assert.equal(requests.length, 2);

  const unauthorized = await route.POST(request({ token: "renter-fixture", action: "settings" }));
  assert.equal(unauthorized.status, 401);
  assert.equal(requests.length, 2, "Unauthorized requests do not read provider settings");
  console.log("PASS Gaffer provider settings readback: noisy-environment trigger and ASR filter stay distinct; provider message text is not returned; synthetic data only.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  global.fetch = previousFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
