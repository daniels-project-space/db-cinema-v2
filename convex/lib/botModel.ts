/**
 * The one model id every Gaffer surface runs on.
 *
 * There are two independent Gaffers — the website chat (src/lib/gaffer.ts, via
 * src/lib/ai.ts) and the booking-chat auto-reply (convex/gaffer.ts) — and they used to
 * carry SEPARATE copies of the same `process.env.BOT_MODEL || "…"` default. They drifted:
 * Vercel pinned BOT_MODEL for the website while Convex never set it, so the two ran
 * different models without anything in the code saying so. One constant, imported by
 * both, means changing the model is a one-line change that can't half-apply.
 *
 * BOT_MODEL still overrides per-deployment, but it should now be set to this value (or
 * left unset) rather than used to quietly pin one surface to something else.
 */
export const BOT_MODEL_DEFAULT = "google/gemini-3.7-flash";

/**
 * The lane to try when the primary fails.
 *
 * Gemini reaches us through OpenRouter and intermittently drops a request mid-flight
 * ("The operation was aborted") — measured at roughly one turn in ten, on BOTH Gaffer
 * stages, which the chat surfaces as "Sorry, I'm having a moment". A retry on the same
 * lane usually succeeds, so this is transport flakiness rather than a bad model, but a
 * customer-facing bot cannot fail one turn in ten. Haiku is the cheapest model that also
 * does reliable structured output, so it costs nothing until Gemini actually stumbles.
 */
export const BOT_MODEL_FALLBACK = "anthropic/claude-haiku-4.5";

/** Model ids to try in order: the primary (BOT_MODEL override honoured), then the fallback. */
export function botLanes(primaryOverride?: string): string[] {
  const primary = primaryOverride || BOT_MODEL_DEFAULT;
  return primary === BOT_MODEL_FALLBACK ? [primary] : [primary, BOT_MODEL_FALLBACK];
}

/**
 * OpenRouter routing shared by both surfaces.
 *
 * `allow_fallbacks` lets a rate-limited provider hand off instead of taking Gaffer
 * offline. The SiliconFlow exclusion is inert for Google models (they don't serve them)
 * and is kept only so that pointing BOT_MODEL back at deepseek stays safe — SiliconFlow's
 * fp8 routing corrupts the JSON that generateObject depends on.
 *
 * `reasoning.effort: low` is load-bearing, not a tuning knob. Gemini 3.x is a reasoning
 * model and spends output budget thinking before it answers; at the default budget a
 * Gaffer turn ran 12–22s and one in six aborted mid-request ("The operation was aborted"
 * out of narrate), which the chat surfaces as "I'm having a moment". Neither stage needs
 * deliberation — the intent parse is a classification and the narrator only rewrites facts
 * the engine already decided — so the thinking budget was pure latency. Do NOT try to cap
 * this with a small maxOutputTokens instead: thinking tokens are drawn from the same
 * budget, so a low cap returns an EMPTY completion and looks like a dead model.
 */
export const BOT_PROVIDER_ROUTING = {
  provider: { ignore: ["SiliconFlow"], allow_fallbacks: true },
  reasoning: { effort: "low", exclude: true },
} as const;
