const QUOTE_PROPERTIES = {
  item: { type: "string", description: "One specific requested item. Use one quote call per distinct item; never combine separate items in this field." },
  quantity: { type: "integer", description: "Number of complete listings or kits when quoting one item." },
  allowAlternatives: { type: "boolean", description: "Set true only when the caller explicitly accepts alternatives for this item. Otherwise false; never silently substitute a named model or configuration." },
  start: { type: "string", description: "Pickup date in YYYY-MM-DD format." },
  end: { type: "string", description: "Return date in YYYY-MM-DD format." },
  pickup_time: { type: "string", description: "Requested pickup time in 24-hour HH:MM format." },
  return_time: { type: "string", description: "Requested return time in 24-hour HH:MM format." },
  days: { type: "integer", description: "Billed rental days when exact dates are not available." },
  requirementsComplete: { type: "boolean", description: "False when the caller has not yet described the complete item list or kit requirements." },
  allowOptionalAddOns: { type: "boolean", description: "Set true only when the caller asks for compatible recommendations, upgrades or a fuller kit. Otherwise false; do not upsell on an availability or price question." },
};

const QUOTE_TOOL_DESCRIPTIONS = {
  check_availability: "Check live stock and the rental price for one requested item and rental period. For multiple distinct items, call once per item using the same dates and times. Set allowAlternatives true only after the caller explicitly accepts substitutes; otherwise keep the exact request.",
  get_price: "Quote live rental price and stock for one requested item and rental dates. For multiple distinct items, call once per item using the same dates and times. Set allowAlternatives true only after the caller explicitly accepts substitutes; otherwise keep the exact request.",
};

function quoteToolSpec(name) {
  const description = QUOTE_TOOL_DESCRIPTIONS[name];
  if (!description) throw new Error(`Unsupported Gaffer quote tool: ${name}`);
  return [name, description, structuredClone(QUOTE_PROPERTIES), name === "check_availability" ? ["item", "start"] : ["item"]];
}

function withMultiItemQuoteSchema(toolConfig) {
  const name = toolConfig?.name;
  if (!QUOTE_TOOL_DESCRIPTIONS[name]) throw new Error("Only check_availability and get_price can be updated here.");
  if (toolConfig.type !== "webhook" || !toolConfig.api_schema?.url || !toolConfig.api_schema?.method) {
    throw new Error(`The existing ${name} tool is not the reviewed webhook configuration.`);
  }
  const current = toolConfig.api_schema.request_body_schema;
  if (!current || current.type !== "object") throw new Error(`The existing ${name} request schema is not an object.`);
  const properties = { ...(current.properties ?? {}) };
  // The Convai webhook schema rejects arrays. Keep webhook inputs scalar; the
  // live endpoint currently accepts one item per call, so Gaffer repeats the
  // call for each distinct request until the batched route is released.
  delete properties.requests;
  for (let index = 2; index <= 8; index += 1) {
    delete properties[`item_${index}`];
    delete properties[`quantity_${index}`];
    delete properties[`allowAlternatives_${index}`];
  }
  return {
    ...toolConfig,
    description: QUOTE_TOOL_DESCRIPTIONS[name],
    api_schema: {
      ...toolConfig.api_schema,
      request_body_schema: {
        ...current,
        properties: { ...properties, ...structuredClone(QUOTE_PROPERTIES) },
        required: name === "check_availability" ? ["item", "start"] : ["item"],
      },
    },
  };
}

function attachedToolReferences(agent) {
  const prompt = agent?.conversation_config?.agent?.prompt ?? agent?.agent?.prompt ?? {};
  const refs = Array.isArray(prompt.tools) ? prompt.tools : [];
  const ids = new Set(Array.isArray(prompt.tool_ids) ? prompt.tool_ids.filter((id) => typeof id === "string") : []);
  const names = new Map();
  for (const ref of refs) {
    const id = ref?.tool_id ?? ref?.id;
    if (typeof id !== "string") continue;
    ids.add(id);
    if (typeof ref?.name === "string") names.set(id, ref.name);
  }
  return { ids: [...ids], names };
}

function hasQuoteSchema(config, name) {
  const body = config?.api_schema?.request_body_schema;
  const properties = body?.properties ?? {};
  const noUnsupportedFields = !Object.hasOwn(properties, "requests") && Array.from({ length: 7 }, (_, index) => index + 2)
    .every((index) => !Object.hasOwn(properties, `item_${index}`) && !Object.hasOwn(properties, `quantity_${index}`) && !Object.hasOwn(properties, `allowAlternatives_${index}`));
  return config?.type === "webhook" && properties.item?.type === "string" && noUnsupportedFields &&
    config?.description === QUOTE_TOOL_DESCRIPTIONS[name] &&
    properties.pickup_time?.type === "string" &&
    properties.return_time?.type === "string" && properties.allowOptionalAddOns?.type === "boolean" &&
    properties.allowAlternatives?.type === "boolean" &&
    /explicitly accepts alternatives/i.test(properties.allowAlternatives.description ?? "") &&
    JSON.stringify(body.required ?? []) === JSON.stringify(name === "check_availability" ? ["item", "start"] : ["item"]);
}

async function providerError(response, method) {
  let detail = "";
  try {
    const body = await response.json();
    if (Array.isArray(body?.detail)) {
      detail = body.detail.map((entry) => {
        const path = Array.isArray(entry?.loc) ? entry.loc.filter((part) => typeof part === "string" || typeof part === "number").join(".") : "";
        const message = typeof entry?.msg === "string" ? entry.msg.slice(0, 300) : "";
        return [path, message].filter(Boolean).join(": ");
      }).filter(Boolean).join("; ");
    }
  } catch {}
  return `ElevenLabs ${method} failed with HTTP ${response.status}${detail ? ` (${detail})` : ""}.`;
}

async function syncAgentQuoteTools({ agentId, apiKey, apply = false, fetchImpl = fetch }) {
  if (typeof agentId !== "string" || !agentId.trim()) throw new Error("A Gaffer voice agent ID is required.");
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("An ElevenLabs API key is required.");
  const base = "https://api.elevenlabs.io/v1/convai";
  const request = async (path, method = "GET", body) => {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: { "xi-api-key": apiKey, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(await providerError(response, method));
    return response.json();
  };
  const path = `/agents/${encodeURIComponent(agentId)}`;
  const beforeAgent = await request(path);
  const beforeRefs = attachedToolReferences(beforeAgent);
  if (!beforeRefs.ids.length) throw new Error("The Gaffer agent returned no attached tool IDs; no changes were made.");

  const targets = new Map();
  for (const id of beforeRefs.ids) {
    const knownName = beforeRefs.names.get(id);
    if (knownName && !QUOTE_TOOL_DESCRIPTIONS[knownName]) continue;
    let record;
    try {
      record = await request(`/tools/${encodeURIComponent(id)}`);
    } catch (error) {
      if (knownName && QUOTE_TOOL_DESCRIPTIONS[knownName]) throw error;
      continue;
    }
    const config = record?.tool_config;
    const name = config?.name ?? knownName;
    if (QUOTE_TOOL_DESCRIPTIONS[name]) {
      if (targets.has(name)) throw new Error(`The Gaffer agent has duplicate ${name} tools; no changes were made.`);
      targets.set(name, { id, original: config, updated: withMultiItemQuoteSchema(config) });
    }
  }
  for (const name of Object.keys(QUOTE_TOOL_DESCRIPTIONS)) {
    if (!targets.has(name)) throw new Error(`The Gaffer agent is missing its attached ${name} tool; no changes were made.`);
  }

  const updates = [...targets].map(([name, { id, original, updated }]) => ({
    name,
    id,
    changed: !hasQuoteSchema(original, name),
    original,
    updated,
  }));
  if (!apply) return { applied: false, toolIds: beforeRefs.ids, updates: updates.map(({ name, id, changed }) => ({ name, id, changed })) };

  const patched = [];
  const rollback = async () => {
    const failures = [];
    for (const tool of [...patched].reverse()) {
      try { await request(`/tools/${encodeURIComponent(tool.id)}`, "PATCH", { tool_config: tool.original }); }
      catch { failures.push(tool.name); }
    }
    return failures;
  };
  try {
    for (const tool of updates) {
      if (tool.changed) {
        await request(`/tools/${encodeURIComponent(tool.id)}`, "PATCH", { tool_config: tool.updated });
        patched.push(tool);
      }
    }
    for (const tool of updates) {
      const readback = await request(`/tools/${encodeURIComponent(tool.id)}`);
      if (!hasQuoteSchema(readback?.tool_config, tool.name)) throw new Error(`The ${tool.name} schema did not read back as expected.`);
    }
    const afterRefs = attachedToolReferences(await request(path));
    if (JSON.stringify([...afterRefs.ids].sort()) !== JSON.stringify([...beforeRefs.ids].sort())) {
      throw new Error("The Gaffer tool IDs changed during the schema update.");
    }
    return { applied: true, toolIds: afterRefs.ids, updates: updates.map(({ name, id, changed }) => ({ name, id, changed })) };
  } catch (error) {
    const failedRollbacks = await rollback();
    if (failedRollbacks.length) throw new Error(`Quote tool update failed; rollback also failed for ${failedRollbacks.join(", ")}.`);
    throw new Error(`Quote tool update failed and was rolled back: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

module.exports = { quoteToolSpec, withMultiItemQuoteSchema, attachedToolReferences, hasQuoteSchema, syncAgentQuoteTools };
