export function verificationRetentionScopeKey(accountId: unknown) {
  return typeof accountId === "string" && accountId.length > 0
    ? `account:${accountId}`
    : "guest:all";
}

export async function verificationRetentionRevision(ctx: any, scopeKey: string) {
  const row = await ctx.db.query("verification_retention_revisions")
    .withIndex("by_scope", (q: any) => q.eq("scopeKey", scopeKey)).unique();
  return row?.revision ?? 0;
}

/** Invalidates any completed retention scan whenever authoritative rental or
 * case state for the account changes. Guest rentals share a conservative
 * revision so no unowned archive can miss a linked-state update. */
export async function bumpVerificationRetentionRevision(ctx: any, bookingOrId: any) {
  const booking = typeof bookingOrId === "string" ? await ctx.db.get(bookingOrId) : bookingOrId;
  const scopeKey = verificationRetentionScopeKey(booking?.accountId);
  const current = await ctx.db.query("verification_retention_revisions")
    .withIndex("by_scope", (q: any) => q.eq("scopeKey", scopeKey)).unique();
  const revision = (current?.revision ?? 0) + 1;
  const updatedAt = Date.now();
  if (current) await ctx.db.patch(current._id, { revision, updatedAt });
  else await ctx.db.insert("verification_retention_revisions", { scopeKey, revision, updatedAt });
  return { scopeKey, revision };
}
