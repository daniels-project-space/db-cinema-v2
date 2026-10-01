/** Applied additions belong to the rental; draft replacements become its original payment. */
export async function rentalPaymentSources(ctx: any, b: any) {
  const additions = await ctx.db
    .query("rental_additions")
    .withIndex("by_booking", (q: any) => q.eq("bookingId", b._id))
    .collect();
  const applied = additions.filter(
    (r: any) => r.status === "applied" && r.paymentIntentId,
  );
  const addedSecurity = applied.reduce(
    (sum: number, r: any) => sum + r.securityCharge,
    0,
  );
  const sources = [
    ...(b.stripePaymentIntentId
      ? [
          {
            paymentIntentId: b.stripePaymentIntentId,
            ...(b.rentalPaidPence !== undefined ? { maxPaidPence: b.rentalPaidPence } : {}),
            securityPence: Math.round(
              Math.max(0, b.depositAmount - addedSecurity) * 100,
            ),
          },
        ]
      : []),
    ...applied.map((r: any) => ({
      paymentIntentId: r.paymentIntentId,
      securityPence: Math.round(r.securityCharge * 100),
    })),
  ];
  const seen = new Set<string>();
  return sources.filter((p) => {
    if (seen.has(p.paymentIntentId))
      throw Error("Duplicate rental payment source");
    seen.add(p.paymentIntentId);
    return true;
  });
}
