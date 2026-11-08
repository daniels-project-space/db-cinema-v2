export function explicitlyRequestsHuman(message: string): boolean {
  const text = message.toLowerCase().replace(/[’]/g, "'");
  const target = '(?:human|person|representative|agent|staff|team|manager|operator|someone|customer service|customer support|daniel|dan)';
  const negated = new RegExp(`\\b(?:do not|don't|dont|no longer|not|never)\\s+(?:want|need|require|wish|ask for|speak to|talk to)(?:(?:\\s+to\\s+(?:speak|talk|chat|connect)\\s+(?:to|with))|(?:\\s+(?:help|assistance|support)\\s+from))?\\s+(?:(?:a|the|any|an|real)\\s+)*${target}\\b`);
  if (negated.test(text)) return false;
  const request = new RegExp(`\\b(?:speak|talk|chat|connect|transfer|put me|pass me|hand me|need|want|would like|i'd like|request|contact|ask|reach|get|have)\\b.{0,45}\\b${target}\\b`);
  const direct = new RegExp(`\\b${target}\\s*(?:please|now)\\b`);
  const standalone = new RegExp(`^\\s*(?:a\\s+|real\\s+)?${target}\\s*[.!?]*\\s*$`);
  return request.test(text) || direct.test(text) || standalone.test(text);
}

export function requiresUrgentHumanReview(message: string): boolean {
  return /\b(?:refund\w*|cancel\w*|disput\w*|chargeback\w*|damage\w*|fraud\w*|threat\w*|injur\w*|abus\w*|harm\w*|suicid\w*|unsafe|safety|safeguard\w*|emergenc\w*|police|ambulance|999|911)\b/i.test(message);
}
