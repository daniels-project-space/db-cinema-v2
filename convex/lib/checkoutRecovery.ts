export function basketKey(lines: any[]) {
  const counts = new Map<string, number>();
  for (const l of lines) {
    const key = `${l.listingId}|${l.start}|${l.end}`;
    counts.set(key, (counts.get(key) ?? 0) + l.qty);
  }
  return JSON.stringify([...counts].sort(([a], [b]) => a.localeCompare(b)));
}
/** Creating a real checkout suppresses its reminder transactionally, even if the
 * browser closes before the success page. Failed/cancelled attempts stay suppressed. */
export async function stopMatchingRecovery(
  ctx: any,
  email: string,
  lines: any[],
  bookingId: any,
) {
  const a = await ctx.db
    .query("accounts")
    .withIndex("by_email", (q: any) =>
      q.eq("email", email.trim().toLowerCase()),
    )
    .first();
  if (!a) return;
  const rows = await ctx.db
    .query("checkout_recoveries")
    .withIndex("by_account", (q: any) => q.eq("accountId", a._id))
    .collect();
  for (const r of rows)
    if (r.state !== "stopped" && basketKey(r.lines) === basketKey(lines))
      await ctx.db.patch(r._id, {
        state: "stopped",
        bookingId,
        leaseUntil: undefined,
      });
}
