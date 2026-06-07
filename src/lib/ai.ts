import { createOpenRouter } from "@openrouter/ai-sdk-provider";

let _model: any;
export function botModel() {
  if (_model) return _model;
  const or = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
  _model = or(process.env.BOT_MODEL || "deepseek/deepseek-chat");
  return _model;
}
