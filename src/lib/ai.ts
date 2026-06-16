import { createOpenRouter } from "@openrouter/ai-sdk-provider";

let _model: any;
export function botModel() {
  if (_model) return _model;
  const or = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
  // Gaffer needs tools + structured output (response_format). The old
  // `deepseek/deepseek-chat` only had ONE OpenRouter provider (DeepInfra)
  // serving structured output — when it rate-limited, every reply threw and
  // the bot went offline. `deepseek-chat-v3.1` is served by several providers
  // with structured-output support (near-identical price), so a single
  // provider rate-limiting can't take Gaffer down. Skip SiliconFlow (its fp8
  // routing corrupts JSON) and allow fallbacks across the rest.
  _model = or(process.env.BOT_MODEL || "deepseek/deepseek-chat-v3.1", {
    extraBody: {
      provider: { ignore: ["SiliconFlow"], allow_fallbacks: true },
    },
  });
  return _model;
}
