import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import type { z } from "zod";
import { BOT_MODEL_DEFAULT, BOT_PROVIDER_ROUTING, botLanes } from "../../convex/lib/botModel";

const _models = new Map<string, any>();
/** The OpenRouter model for a given id (default: the shared Gaffer model), memoised. */
export function botModel(id?: string) {
  const modelId = id || process.env.BOT_MODEL || BOT_MODEL_DEFAULT;
  const hit = _models.get(modelId);
  if (hit) return hit;
  // Gaffer needs structured output (response_format) on BOTH of its LLM stages — the
  // intent parse and the narrator. Model id and provider routing live in
  // convex/lib/botModel.ts so the Convex-side Gaffer shares them.
  const or = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
  const m = or(modelId, { extraBody: { ...BOT_PROVIDER_ROUTING } });
  _models.set(modelId, m);
  return m;
}

/**
 * generateObject across the model lanes, so one flaky provider call can't become a
 * customer-visible "I'm having a moment".
 *
 * Each lane gets two attempts: OpenRouter's aborts are transient and a same-lane retry
 * usually succeeds, so we exhaust the (cheaper, preferred) primary before paying for the
 * fallback. Only if EVERY lane fails does the error propagate to the route's catch — which
 * is the one case where the customer should see the apology, because by then it isn't a
 * blip. Throwing the FIRST error, not the last, keeps the primary's failure in the logs
 * rather than burying it under a fallback symptom.
 */
export async function generateBotObject<T extends z.ZodTypeAny>(args: {
  schema: T;
  prompt: string;
}): Promise<z.infer<T>> {
  let firstErr: unknown;
  for (const lane of botLanes(process.env.BOT_MODEL)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { object } = await generateObject({ model: botModel(lane), schema: args.schema, prompt: args.prompt });
        return object as z.infer<T>;
      } catch (e) {
        firstErr ??= e;
        console.warn(`[gaffer] lane ${lane} attempt ${attempt + 1} failed:`, (e as Error)?.message);
      }
    }
  }
  throw firstErr;
}
