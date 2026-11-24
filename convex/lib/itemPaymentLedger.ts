type Source = { paymentIntentId: string; amountPence: number };
type LedgerLine = { listingId: any; qty: number; sources: Source[] };

export function upgradedItemPaymentLedger(booking: any, lines: any[], funding: any[], changes: any[], paidPence: number, paymentIntentId: string | undefined, refundCount: number): LedgerLine[] | undefined {
  const oldLines = booking.lineItems, oldFunding = booking.checkoutLineFunding, ledger: LedgerLine[] | undefined = booking.itemPaymentLedger;
  if (booking.itemPaymentLedgerVersion !== 1 || refundCount !== 0 || !Array.isArray(oldLines) || !Array.isArray(oldFunding) || !Array.isArray(ledger) || oldFunding.length !== oldLines.length || ledger.length !== oldLines.length || funding.length !== lines.length || !Number.isSafeInteger(paidPence) || paidPence < 0 || (paidPence > 0 && !paymentIntentId)) return;
  const indexed = new Map<number, any>();
  for (const change of changes) {
    if (!Number.isSafeInteger(change.lineIndex) || change.lineIndex < 0 || change.lineIndex >= oldLines.length || indexed.has(change.lineIndex)) return;
    indexed.set(change.lineIndex, change);
  }
  let addition = 0;
  const next: LedgerLine[] = [];
  for (let index = 0; index < oldLines.length; index++) {
    const line = oldLines[index], old = ledger[index], previous = oldFunding[index], change = indexed.get(index);
    if (!old || !previous || String(old.listingId) !== String(line.listingId) || old.qty !== line.qty || String(previous.listingId) !== String(line.listingId) || previous.qty !== line.qty || !Array.isArray(old.sources) || old.sources.some(source => !source.paymentIntentId || !Number.isSafeInteger(source.amountPence) || source.amountPence <= 0) || new Set(old.sources.map(source => source.paymentIntentId)).size !== old.sources.length) return;
    const before = old.sources.reduce((sum, source) => sum + source.amountPence, 0);
    if (!Number.isSafeInteger(before) || !Number.isFinite(previous.card) || before !== Math.round(previous.card * 100) || (paymentIntentId && old.sources.some(source => source.paymentIntentId === paymentIntentId))) return;
    if (change?.action === "remove") { if (before !== 0) return; continue; }
    const target = lines[next.length], allocation = funding[next.length], expected = change?.newLine ?? line;
    if (!target || !allocation || String(target.listingId) !== String(expected.listingId) || target.qty !== expected.qty || String(allocation.listingId) !== String(target.listingId) || allocation.qty !== target.qty || !Number.isFinite(allocation.card)) return;
    const after = Math.round(allocation.card * 100), extra = after - before;
    if (!Number.isSafeInteger(after) || extra < 0 || !Number.isSafeInteger(addition + extra)) return;
    addition += extra;
    next.push({ listingId: target.listingId, qty: target.qty, sources: [...old.sources, ...(extra && paymentIntentId ? [{ paymentIntentId, amountPence: extra }] : [])] });
  }
  if (next.length !== lines.length || addition !== paidPence) return;
  return next;
}

export function downgradedItemPaymentLedger(booking: any, lines: any[], funding: any[], changes: any[], refunds: any[], expectedRefundId: any, expectedPence: number): LedgerLine[] | undefined {
  const oldLine=booking.lineItems?.[0],oldFunding=booking.checkoutLineFunding?.[0],old=booking.itemPaymentLedger?.[0],refund=refunds[0],target=lines[0],allocation=funding[0];
  if(booking.itemPaymentLedgerVersion!==1||booking.lineItems?.length!==1||booking.checkoutLineFunding?.length!==1||booking.itemPaymentLedger?.length!==1||lines.length!==1||funding.length!==1||changes.length!==1||changes[0].lineIndex!==0||changes[0].action==="remove"||refunds.length!==1||String(refund?._id)!==String(expectedRefundId)||refund.status!=="succeeded"||refund.refundAmbiguity||!Number.isSafeInteger(expectedPence)||expectedPence<=0||refund.amountPence!==expectedPence||!Array.isArray(refund.parts)||!refund.parts.length||!Array.isArray(old?.sources))return;
  if(String(old.listingId)!==String(oldLine.listingId)||old.qty!==oldLine.qty||String(oldFunding.listingId)!==String(oldLine.listingId)||oldFunding.qty!==oldLine.qty||String(target.listingId)!==String(changes[0].newLine?.listingId)||target.qty!==changes[0].newLine?.qty||String(allocation.listingId)!==String(target.listingId)||allocation.qty!==target.qty)return;
  if(old.sources.some((source:Source)=>!source.paymentIntentId||!Number.isSafeInteger(source.amountPence)||source.amountPence<=0)||new Set(old.sources.map((source:Source)=>source.paymentIntentId)).size!==old.sources.length)return;
  const remaining=new Map<string,number>(old.sources.map((source:Source)=>[source.paymentIntentId,source.amountPence]));
  if([...remaining.values()].reduce((sum,value)=>sum+value,0)!==Math.round(oldFunding.card*100))return;
  let refunded=0;const seenRefunds=new Set<string>();
  for(const part of refund.parts){const value=remaining.get(part.paymentIntentId);if(part.status!=="succeeded"||!part.stripeRefundId||seenRefunds.has(part.stripeRefundId)||!Number.isSafeInteger(part.amountPence)||part.amountPence<=0||value===undefined||part.amountPence>value)return;seenRefunds.add(part.stripeRefundId);remaining.set(part.paymentIntentId,value-part.amountPence);refunded+=part.amountPence;}
  const sources=[...remaining].filter(([,amount])=>amount>0).map(([paymentIntentId,amountPence])=>({paymentIntentId,amountPence}));
  if(refunded!==expectedPence||sources.reduce((sum,source)=>sum+source.amountPence,0)!==Math.round(allocation.card*100))return;
  return [{listingId:target.listingId,qty:target.qty,sources}];
}
