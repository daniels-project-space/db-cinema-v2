import type { MutationCtx, QueryCtx } from "../_generated/server";

const KEY = "public-catalogue-revision-v1";

export async function catalogRevision(ctx: QueryCtx | MutationCtx): Promise<number> {
  const row = await ctx.db.query("rmv2_sync_state").withIndex("by_key", q => q.eq("key", KEY)).first();
  const revision = Number(row?.cursor ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw Error("Invalid catalogue revision");
  return revision;
}

export async function bumpCatalogRevision(ctx: MutationCtx): Promise<void> {
  const row = await ctx.db.query("rmv2_sync_state").withIndex("by_key", q => q.eq("key", KEY)).first();
  const revision = Number(row?.cursor ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw Error("Invalid catalogue revision");
  const next = { key: KEY, lastSyncedAt: Date.now(), status: "ok", cursor: String(revision + 1) };
  if (row) await ctx.db.patch(row._id, next);
  else await ctx.db.insert("rmv2_sync_state", next);
}
