/** Conservative guard: ordinary price/budget questions must not activate a deal. */
export function asksForBetterPrice(message: string): boolean {
  if (/\b(?:don['’]?t|do not|no|not|without)\b.{0,24}\b(?:discount|deal|cheaper|better price)\b/i.test(message)) return false;
  return /\b(?:better|best|lower|cheaper)\s+(?:price|deal|rate)\b|\b(?:any|a|the|some)\s+discount\b|\b(?:can|could|would)\b.{0,35}\b(?:discount|cheaper|reduce|knock|less|deal)\b|\b(?:discount|reduce)\s+(?:the|my|this|that)\s+(?:order|price|total|basket)\b/i.test(message);
}
