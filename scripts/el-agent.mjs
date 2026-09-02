import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)];
  })
);
const KEY = env.ELEVENLABS_API_KEY, SEC = env.VOICE_WEBHOOK_SECRET;
const H = { "xi-api-key": KEY, "content-type": "application/json" };
const HOOK = (fn) => `https://dbcinemarentals.com/api/voice?key=${SEC}&fn=${fn}`;

async function mkTool(name, description, properties, required) {
  const body = { tool_config: { type: "webhook", name, description, response_timeout_secs: 20,
    api_schema: { url: HOOK(name), method: "POST", request_body_schema: { type: "object", properties, required }, content_type: "application/json" } } };
  const r = await fetch("https://api.elevenlabs.io/v1/convai/tools", { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await r.json();
  const id = j.tool_id || j.id || j.tool?.tool_id;
  if (!r.ok || !id) { console.log(`tool ${name} ERR ${r.status}:`, JSON.stringify(j).slice(0, 280)); return null; }
  console.log(`tool ${name}: ${id}`);
  return id;
}

// best-effort cleanup of the partial first run (so we don't leave duplicates)
for (const id of ["agent_0601kvk2n9ecfer9nfsr7919y6sw"]) await fetch(`https://api.elevenlabs.io/v1/convai/agents/${id}`, { method: "DELETE", headers: H }).catch(() => {});
for (const id of ["tool_7701kvk2n8tnfy3994bxwbm8c7pt"]) await fetch(`https://api.elevenlabs.io/v1/convai/tools/${id}`, { method: "DELETE", headers: H }).catch(() => {});

const specs = [
  ["check_availability", "Check if a piece of gear is free for given dates and its price", { item: { type: "string", description: "gear name e.g. Sony FX3" }, start: { type: "string", description: "start date YYYY-MM-DD" }, end: { type: "string", description: "end date YYYY-MM-DD" } }, ["item", "start"]],
  ["get_price", "Get the daily and total price of a piece of gear", { item: { type: "string", description: "gear name e.g. Sony 24-70 GM lens" }, days: { type: "integer", description: "number of rental days" } }, ["item"]],
  ["check_stock", "Check whether the shop stocks a piece of gear", { item: { type: "string", description: "gear name e.g. Sony FX3" } }, ["item"]],
  ["request_callback", "Log a callback request for the team", { name: { type: "string", description: "the caller's name" }, phone: { type: "string", description: "the caller's phone number" }, message: { type: "string", description: "what the caller needs" } }, ["name", "phone"]],
];
const tool_ids = [];
for (const s of specs) { const id = await mkTool(...s); if (id) tool_ids.push(id); }

const prompt = [
  "You are Gaffer, the phone assistant for Db Cinema Rentals, a London cinema-gear rental shop (cameras, lenses, lighting, audio, drones). Be warm, concise and natural.",
  "To answer do-you-have / is-it-free / what-does-it-cost, ALWAYS call the matching tool (check_stock, check_availability, get_price). Never guess prices or stock.",
  "Convert spoken dates to YYYY-MM-DD before calling check_availability. Ask for dates if not given.",
  "If the caller wants to book or you cannot fully help, call request_callback with their name, phone and need, and say the team will call back.",
  "Hours are 09:00-22:00 daily; you deliver across London.",
].join(" ");

const agentBody = {
  name: "Db Cinema Rentals - Gaffer",
  conversation_config: {
    agent: { prompt: { prompt, llm: "gpt-4o", tool_ids }, first_message: "Hi, you've reached Db Cinema Rentals - this is Gaffer. How can I help with your shoot?", language: "en" },
    tts: { model_id: "eleven_flash_v2", voice_id: "JBFqnCBsd6RMkjVDRZzb" },
  },
};
const r = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", { method: "POST", headers: H, body: JSON.stringify(agentBody) });
const j = await r.json();
if (!r.ok) { console.log("AGENT ERR", r.status, JSON.stringify(j).slice(0, 400)); }
else console.log("AGENT created:", j.agent_id, "| tools:", tool_ids.length);
