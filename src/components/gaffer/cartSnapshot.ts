type VoiceCartLine = { listingId: string; start: string; end: string; pickupTime?: string; returnTime?: string; days?: number; perDay?: number; total?: number; deposit?: number };

export function voiceCartShareSignature(items: readonly VoiceCartLine[]): string {
  return JSON.stringify(items.map(item => [item.listingId, item.start, item.end, item.pickupTime ?? null, item.returnTime ?? null]));
}

export function voiceCartReviewSignature(cart: { items: readonly VoiceCartLine[]; promo?: string | null; membership?: unknown }, context?: unknown): string {
  return JSON.stringify({ items: cart.items.map(item => [item.listingId, item.start, item.end, item.pickupTime ?? null, item.returnTime ?? null, item.days ?? null, item.perDay ?? null, item.total ?? null, item.deposit ?? null]), promo: cart.promo ?? null, membership: cart.membership ?? null, context: context ?? null });
}
