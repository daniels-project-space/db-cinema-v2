#!/usr/bin/env node
/**
 * Register Gaffer's client tools on the ElevenLabs agent, and allow the
 * first-message override.
 *
 * Passing clientTools to the browser SDK only supplies the *implementation*.
 * The agent's own tool list is what the model sees, so a tool missing from it
 * can never be called no matter what the prompt says — which is why the basket
 * review, enquiry logging and follow-up email were all dead on arrival.
 *
 * Deliberately additive and idempotent:
 *   - existing tools are matched by name and left exactly as they are, so the
 *     webhook tools the phone line depends on are never touched
 *   - only the first_message override flag is flipped; every other security
 *     toggle is preserved
 *   - re-running changes nothing once applied
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... node scripts/gaffer-agent-sync.js --dry-run
 *   ELEVENLABS_API_KEY=... node scripts/gaffer-agent-sync.js --apply
 */

const AGENT_ID = process.env.GAFFER_AGENT_ID || "agent_4601kvk2pfznfrws6ah700jnxvfv";
const API = "https://api.elevenlabs.io/v1/convai/agents";
const KEY = process.env.ELEVENLABS_API_KEY;

const str = (description) => ({
  type: "string",
  description,
  enum: null,
  is_system_provided: false,
  dynamic_variable: "",
  allowed_values_dynamic_variable: "",
  constant_value: "",
});

/** Same envelope the existing client tools use, so nothing looks foreign. */
const clientTool = (name, description, properties = {}, required = []) => ({
  type: "client",
  name,
  description,
  response_timeout_secs: 20,
  disable_interruptions: false,
  interruption_mode: "allow",
  force_pre_tool_speech: false,
  pre_tool_speech: "auto",
  assignments: [],
  tool_call_sound: null,
  tool_call_sound_behavior: "auto",
  tool_error_handling_mode: "auto",
  parameters: {
    description: "",
    dynamic_variable: "",
    is_omitted: false,
    type: "object",
    required,
    properties,
  },
  expects_response: true,
  dynamic_variables: { dynamic_variable_placeholders: {} },
  execution_mode: "immediate",
});

const DATES = {
  start: str("Hire start date. Pass what the customer said, e.g. 'in a week from now', 'next Friday', or an ISO date."),
  end: str("Hire end date, same format as start. Omit for a single day."),
};

const NEW_TOOLS = [
  clientTool(
    "review_basket",
    "Show the full basket breakdown page with dates, line prices and the refundable deposit, and re-check availability. Use this when the customer says they want to book, BEFORE going to checkout.",
  ),
  clientTool(
    "check_basket",
    "Check every line in the basket is still available for its dates. Use before promising a booking.",
  ),
  clientTool(
    "remove_unavailable",
    "Remove any basket lines that are not available for their dates. Only after offering alternatives.",
  ),
  clientTool(
    "log_enquiry",
    "File the customer's enquiry so the team receives it by email. Use as soon as you have their name, contact details or a requirement you cannot settle on the call. Details you only say back to the customer are lost when the call ends.",
    {
      kind: str("One of: booking, inquiry, issue, callback."),
      name: str("Customer's name."),
      phone: str("Phone number, if given."),
      email: str("Email address, if given."),
      message: str("What they need, in full — kit, dates, budget, the problem."),
    },
    ["message"],
  ),
  clientTool(
    "send_follow_up",
    "Email the customer a written summary of what was agreed. Use when something needs following up after the call.",
    {
      email: str("Their email address. Omit if they are signed in."),
      name: str("Their name."),
      summary: str("What to put in the email."),
      subject: str("Optional subject line."),
    },
    ["summary"],
  ),
  clientTool(
    "offer_account",
    "Open sign-up. An account gets them a chat you answer directly instead of waiting on email.",
  ),
  clientTool("open_chat", "Open the customer's own chat thread, where you can reply after the call."),
  clientTool(
    "browse_for",
    "Filter the catalogue on screen and report which of the results are actually free for the dates.",
    { item: str("What they asked for, e.g. 'wide lens'."), category: str("Category, e.g. Lenses, Lighting, Cameras."), ...DATES },
  ),
  clientTool(
    "find_gear",
    "Check what matches a request and which options are genuinely available for the dates, without leaving the page.",
    { item: str("The gear they asked for."), ...DATES },
    ["item"],
  ),
  clientTool("select_item", "Highlight an item on screen without adding it to the basket.", { item: str("The gear to highlight.") }, ["item"]),
  clientTool(
    "suggest_alternatives",
    "Offer same-category items that are actually free for the dates. Use when something is booked out.",
    { item: str("The item that isn't available."), ...DATES },
    ["item"],
  ),
];

async function main() {
  if (!KEY) throw new Error("ELEVENLABS_API_KEY is not set");
  const apply = process.argv.includes("--apply");

  const res = await fetch(`${API}/${AGENT_ID}`, { headers: { "xi-api-key": KEY } });
  if (!res.ok) throw new Error(`GET agent failed: ${res.status} ${await res.text()}`);
  const agent = await res.json();

  const existing = agent.conversation_config?.agent?.prompt?.tools ?? [];
  const have = new Set(existing.map((t) => t.name));
  const missing = NEW_TOOLS.filter((t) => !have.has(t.name));

  const ov = agent.platform_settings?.overrides?.conversation_config_override ?? {};
  const firstMessageAllowed = ov.agent?.first_message === true;

  console.log(`agent:            ${agent.name}`);
  console.log(`tools before:     ${existing.length} (${existing.map((t) => t.name).join(", ")})`);
  console.log(`adding:           ${missing.length} (${missing.map((t) => t.name).join(", ") || "none"})`);
  console.log(`first_message override: ${firstMessageAllowed ? "already on" : "OFF -> turning ON"}`);

  if (!missing.length && firstMessageAllowed) {
    console.log("\nNothing to do — already in sync.");
    return;
  }
  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  /**
   * Tools are their own entities; the agent only holds tool_ids. Sending an
   * inline `tools` array alongside them is rejected outright, so each new tool
   * is created first and then attached by id — leaving the existing ids, and
   * the webhook tools the phone line depends on, completely untouched.
   */
  const existingIds = agent.conversation_config.agent.prompt.tool_ids ?? [];
  const newIds = [];
  for (const tool_config of missing) {
    const r = await fetch("https://api.elevenlabs.io/v1/convai/tools", {
      method: "POST",
      headers: { "xi-api-key": KEY, "content-type": "application/json" },
      body: JSON.stringify({ tool_config }),
    });
    if (!r.ok) throw new Error(`create ${tool_config.name} failed: ${r.status} ${await r.text()}`);
    const created = await r.json();
    newIds.push(created.id);
    console.log(`  created ${tool_config.name} -> ${created.id}`);
  }

  const prompt = { ...agent.conversation_config.agent.prompt, tool_ids: [...existingIds, ...newIds] };
  delete prompt.tools; // mutually exclusive with tool_ids

  const body = {
    conversation_config: { agent: { prompt } },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          ...ov,
          agent: { ...(ov.agent ?? {}), first_message: true },
        },
      },
    },
  };

  const patch = await fetch(`${API}/${AGENT_ID}`, {
    method: "PATCH",
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!patch.ok) throw new Error(`PATCH failed: ${patch.status} ${await patch.text()}`);

  const after = await (await fetch(`${API}/${AGENT_ID}`, { headers: { "xi-api-key": KEY } })).json();
  const names = (after.conversation_config?.agent?.prompt?.tools ?? []).map((t) => t.name);
  const webhooks = (after.conversation_config?.agent?.prompt?.tools ?? []).filter((t) => t.type === "webhook");
  console.log(`\ntools after:      ${names.length} (${names.join(", ")})`);
  console.log(`webhook tools intact: ${webhooks.length}`);
  console.log(`first_message override now: ${after.platform_settings?.overrides?.conversation_config_override?.agent?.first_message}`);
  console.log(`prompt unchanged: ${after.conversation_config.agent.prompt.prompt === agent.conversation_config.agent.prompt.prompt}`);
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
