/** Applied additions belong to the rental; draft replacements become its original payment. */
export async function rentalPaymentSources(ctx: any, b: any) {
  const additions = await ctx.db
    .query("rental_additions")
    .withIndex("by_booking", (q: any) => q.eq("bookingId", b._id))
    .take(101);
  if(additions.length>100)throw Error("Rental addition history needs manual review.");
  const applied = additions.filter(
    (r: any) => r.status === "applied" && r.paymentIntentId,
  );
  const addedSecurity = applied.reduce(
    (sum: number, r: any) => sum + r.securityCharge,
    0,
  );
  const extensions = await ctx.db.query("booking_change_requests").withIndex("by_booking", (q: any) => q.eq("bookingId", b._id)).take(101);
  if(extensions.length>100)throw Error("Rental extension history needs manual review.");
  const priceChanges=await ctx.db.query("rental_price_adjustments").withIndex("by_booking",(q:any)=>q.eq("bookingId",b._id)).take(101);
  if(priceChanges.length>100)throw Error("Rental price history needs manual review.");
  const deliveryQuotes=await ctx.db.query("rental_delivery_quotes").withIndex("by_booking",(q:any)=>q.eq("bookingId",b._id)).take(101);
  if(deliveryQuotes.length>100)throw Error("Rental delivery history needs manual review.");
  const swaps=await ctx.db.query("rental_item_swaps").withIndex("by_booking",(q:any)=>q.eq("bookingId",b._id)).take(101);
  if(swaps.length>100)throw Error("Rental equipment change history needs manual review.");
  const paidSwaps=swaps.filter((row:any)=>row.status==="applied"&&row.quote?.deltaPence>0);
  const swapSources=paidSwaps.flatMap((row:any)=>{
    const delta=row.quote.deltaPence, credit=row.creditAppliedPence??0, card=row.cardDuePence??(credit===0?delta:undefined);
    if(!Number.isSafeInteger(delta)||!Number.isSafeInteger(credit)||credit<0||!Number.isSafeInteger(card)||card<0||card+credit!==delta||(card>0&&!row.paymentIntentId)||(card===0&&row.paymentIntentId))throw Error("An equipment change payment needs manual review.");
    return card>0?[{paymentIntentId:row.paymentIntentId,maxPaidPence:card,securityPence:0}]:[];
  });
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
    ...priceChanges.filter((r:any)=>r.status==="applied"&&r.paymentIntentId).map((r:any)=>({paymentIntentId:r.paymentIntentId,maxPaidPence:Math.round(r.delta*100),securityPence:0})),
    ...applied.map((r: any) => ({
      paymentIntentId: r.paymentIntentId,
      maxPaidPence: r.cardPaidPence ?? Math.max(0, Math.round((r.lineTotal + r.securityCharge + (r.membershipFee ?? 0)) * 100) - (r.creditAppliedPence ?? 0)),
      securityPence: Math.round(r.securityCharge * 100),
    })),
    ...extensions.filter((r: any) => r.type === "extend" && r.status === "applied" && r.paymentIntentId).map((r: any) => ({ paymentIntentId:r.paymentIntentId, maxPaidPence:r.cardPaidPence??r.cardDuePence??Math.max(0,Math.round((r.priceDelta-(r.creditAppliedPence??0)/100)*100)), securityPence:0 })),
    ...deliveryQuotes.filter((r:any)=>r.status==="paid"&&r.paymentIntentId).map((r:any)=>({paymentIntentId:r.paymentIntentId,maxPaidPence:r.cardPaidPence??r.cardDuePence??Math.max(0,r.amountPence-(r.creditAppliedPence??0)),securityPence:0})),
    ...swapSources,
  ];
  const seen = new Set<string>();
  return sources.filter((p) => {
    if (seen.has(p.paymentIntentId))
      throw Error("Duplicate rental payment source");
    seen.add(p.paymentIntentId);
    return true;
  });
}

export async function rentalCreditSources(ctx:any,b:any){
  const rows=await ctx.db.query("rental_credit_reservations").withIndex("by_booking",(q:any)=>q.eq("bookingId",b._id)).take(101);
  if(rows.length>100)throw Error("Rental account-credit history needs manual review.");
  return rows.filter((row:any)=>row.state==="consumed"&&(row.amountPence-(row.restoredPence??0))>0).map((row:any)=>({reservationId:row._id,operationType:row.operationType,operationId:row.operationId,amountPence:row.amountPence-(row.restoredPence??0),originalAmountPence:row.amountPence,restoredPence:row.restoredPence??0,allocations:row.allocations}));
}
