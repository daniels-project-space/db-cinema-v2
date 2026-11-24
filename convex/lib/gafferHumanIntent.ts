export function explicitlyRequestsHuman(message: string): boolean {
  const text = message.toLowerCase().replace(/[’]/g, "'");
  return text.split(/[.!?;\n]+|\b(?:but|however)\b/).some(clause => requestsHumanInClause(clause));
}

function requestsHumanInClause(text: string): boolean {
  const target = '(?:human|person|representative|agent|staff|team|manager|operator|someone|customer service|customer support|support|daniel|dan)';
  const negated = new RegExp(`\\b(?:(?:do not|don't|dont|no longer|not|never)\\s+(?:want|need|require|wish|ask for|speak to|talk to|have|ask)|(?:can|could|would)\\s+you\\s+not\\s+(?:have|ask))(?:(?:\\s+to\\s+(?:speak|talk|chat|connect)\\s+(?:to|with))|(?:\\s+(?:help|assistance|support)\\s+from))?\\s+(?:(?:a|the|any|an|real)\\s+)*${target}\\b`);
  if (negated.test(text)) return false;
  const request = new RegExp(`\\b(?:(?:i|we)\\s+(?:really\\s+)?(?:need|want|would like|prefer|request)|please\\s+(?:connect|transfer|put|pass|hand|contact|reach)|(?:can|could|would|may)\\s+(?:i|you)\\s+(?:please\\s+)?(?:speak|talk|chat|connect|transfer|contact|reach|have)|(?:connect|transfer|put|pass|hand)\\s+me|(?:speak|talk|chat)\\s+(?:to|with))\\b.{0,55}\\b${target}\\b`);
  const direct = new RegExp(`\\b${target}\\s*(?:please|now)\\b`);
  const standalone = new RegExp(`^\\s*(?:a\\s+|real\\s+)?${target}\\s*[.!?]*\\s*$`);
  const callback = new RegExp(`\\b(?:(?:can|could|would)\\s+${target}|please\\s+(?:have|ask)\\s+(?:a\\s+|the\\s+)?${target})\\s+(?:please\\s+|to\\s+)?(?:call|phone|ring|email|contact|reply to)\\s+me\\b`);
  return request.test(text) || direct.test(text) || standalone.test(text) || callback.test(text);
}

export function requiresUrgentHumanReview(message: string): boolean {
  const text = message.trim();
  if (!text) return false;

  const immediateSafetyRisk = /\b(?:there is an? (?:urgent|immediate) (?:safety )?(?:emergency|threat|risk|injury)|i(?:'m| am) (?:in danger|unsafe|injured|hurt)|i feel (?:unsafe|in danger|threatened)|someone (?:is|has been) (?:threatening|attacking|hurting) me|i need (?:the )?(?:police|ambulance|emergency help)|please (?:call|send) (?:the )?(?:police|ambulance)|(?:999|911) (?:now|please))\b/i.test(text);
  const activeDamageReport = /\b(?:i (?:dropped|damaged|broke|cracked) (?:the |my )?(?:camera|lens|item|kit|equipment)|(?:the |my )?(?:camera|lens|item|kit|equipment) (?:is|was|arrived|came back) (?:damaged|broken|cracked|missing|stolen)|(?:there is|there's) (?:damage|a crack|a break) (?:to|on) (?:the |my )?(?:camera|lens|item|kit|equipment))\b/i.test(text);
  const activeDispute = /\b(?:i (?:have |already )?(?:filed|opened|raised|made) (?:a )?(?:chargeback|dispute)|my bank (?:has )?(?:filed|opened|raised) (?:a )?(?:chargeback|dispute)|i (?:will|am going to) (?:file|open|raise) (?:a )?(?:chargeback|dispute)|i want to dispute (?:this|the) (?:charge|payment|transaction))\b/i.test(text);
  const hypothetical = /\b(?:what if|what happens if|suppose|imagine)\b/i.test(text);
  if ((!hypothetical && (immediateSafetyRisk || activeDamageReport)) || activeDispute) return true;

  const askingForInformation = /\b(?:eligible|eligibility|policy|terms|what if|what happens if|am i|can i|could i|would i|do i|can you explain|could you explain|please explain|how (?:does|do|can)|tell me (?:about|whether|if))\b/i.test(text);
  if (askingForInformation) return false;

  return /\b(?:please|can you|could you|i need you to|i want you to|i need|i want|i'd like you to)\b.{0,60}\b(?:refund|cancel|dispute|chargeback)\b|\b(?:refund|cancel) (?:my|the|this) (?:booking|rental|reservation|payment)\b/i.test(text);
}
