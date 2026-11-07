import { SINGLE_BENEFIT_VERSION } from "../../shared/rentalBenefits";
import { checkoutCreditSources, checkoutLineAllocation } from "../../shared/checkoutLineAllocation";

type Source = { creditId: any; amountPence: number; kind: "refund" | "earned"; membershipGrantId?: any; membershipInvoiceId?: string };
type Restore = Source | { amountPence: number; kind: "membership"; membershipGrantId: any; membershipInvoiceId: string };

function pence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)
    throw Error("The original item funding is not a valid money amount.");
  return Math.round(value * 100);
}

/** Derive a one-item quote only from checkout's exact funding snapshot. */
export async function quoteSwapFunding(ctx: any, booking: any, lineIndex: number, replacement: any) {
  const line = booking.lineItems?.[lineIndex], funding = booking.checkoutLineFunding?.[lineIndex];
  if (!Number.isSafeInteger(lineIndex) || lineIndex < 0 || !line || !funding || booking.checkoutLineFunding.length !== booking.lineItems.length)
    throw Error("The original item funding is unavailable; manual settlement review is required.");
  if (booking.pricingVersion !== SINGLE_BENEFIT_VERSION)
    throw Error("This booking's selected benefit cannot be safely repriced automatically; manual settlement review is required.");
  if (String(line.listingId) !== String(funding.listingId) || line.start !== funding.start || line.end !== funding.end || line.qty !== funding.qty || !Number.isSafeInteger(line.qty) || line.qty < 1 || pence(line.lineTotal) !== pence(funding.gross))
    throw Error("The original item no longer matches its funding snapshot; manual settlement review is required.");
  if (!replacement || !replacement.listingId || replacement.start !== line.start || replacement.end !== line.end || replacement.qty !== line.qty)
    throw Error("A replacement must retain the original item's dates and quantity.");
  const gross = pence(funding.gross), discount = pence(funding.discount), membership = pence(funding.membershipCredit), accountCredit = pence(funding.accountCredit), card = pence(funding.card), nextGross = pence(replacement.lineTotal);
  let nextDiscount = 0;
  if (booking.benefitKind === "loyalty" || booking.benefitKind === "earned_credit" && booking.lineItems.length > 1) {
    const earnedBenefit=booking.benefitKind === "earned_credit",rule = earnedBenefit ? {version:"encore-percent-v1",percent:0} : booking.swapBenefitRule;
    if (rule?.version !== "encore-percent-v1" || !(earnedBenefit?[0]:[2,4,10]).includes(rule.percent) || pence(booking.membershipSignupOfferSaving ?? 0) !== 0)
      throw Error("This booking's selected benefit cannot be safely repriced automatically; manual settlement review is required.");
    if (booking.lineItems.length > 1) {
      const memberCredit=pence(booking.membershipCreditApplied ?? 0),refundCredit=pence(booking.refundCreditApplied ?? 0),earnedCredit=pence(booking.earnedCreditApplied ?? 0),creditTotal=refundCredit+earnedCredit,delivery=pence(booking.deliveryFee ?? 0);
      if (!Number.isSafeInteger(creditTotal+memberCredit) || pence(booking.creditApplied ?? 0)!==creditTotal+memberCredit || !earnedBenefit&&(memberCredit!==0||earnedCredit!==0) || !Array.isArray(booking.creditAllocations) || !Array.isArray(booking.checkoutLineCreditSources))
        throw Error("This booking's selected benefit cannot be safely repriced automatically; manual settlement review is required.");
      const rows = booking.checkoutLineFunding.map((row:any,index:number)=>{
        const item=booking.lineItems[index],rowGross=pence(row.gross),rowDiscount=pence(row.discount),rowMember=pence(row.membershipCredit),rowCredit=pence(row.accountCredit),rowCard=pence(row.card);
        if(!item || String(item.listingId)!==String(row.listingId) || item.start!==row.start || item.end!==row.end || item.qty!==row.qty || !Number.isSafeInteger(item.qty) || item.qty<1 || pence(item.lineTotal)!==rowGross || rowDiscount+rowMember+rowCredit+rowCard!==rowGross)
          throw Error("The original item funding does not balance; manual settlement review is required.");
        return {row,gross:rowGross,discount:rowDiscount,member:rowMember,credit:rowCredit,card:rowCard};
      });
      const originalGross=rows.reduce((sum:number,row:any)=>sum+row.gross,0),originalDiscount=rows.reduce((sum:number,row:any)=>sum+row.discount,0);
      if(!Number.isSafeInteger(originalGross) || !Number.isSafeInteger(originalDiscount) || !Number.isSafeInteger(originalGross*rule.percent) || pence(booking.subtotal)!==originalGross || pence(booking.discount)!==originalDiscount || originalDiscount!==Math.round(originalGross*rule.percent/100))
        throw Error("The original basket discount does not balance; manual settlement review is required.");
      let originalRemaining=originalDiscount;
      for(const row of rows){const expected=Math.min(row.gross,originalRemaining);originalRemaining-=expected;if(row.discount!==expected)throw Error("The original basket discount allocation cannot be verified.");}
      const sourceRows:Source[]=[],sourceAmounts=new Map<string,{allocated:number;original:number}>();
      for(const allocation of booking.creditAllocations){
        const amount=pence(allocation.amount),credit=await ctx.db.get(allocation.creditId);
        if(!booking.accountId || !["refund","earned"].includes(allocation.kind) || !earnedBenefit&&allocation.kind!=="refund" || !credit || String(credit.accountId)!==String(booking.accountId) || (credit.kind??"earned")!==allocation.kind || (credit.currency??"GBP").toUpperCase()!=="GBP")throw Error("An original credit source cannot be verified.");
        const grant=credit.membershipGrantId?await ctx.db.get(credit.membershipGrantId):null;
        if(credit.membershipGrantId&&(!grant || String(grant.accountId)!==String(booking.accountId) || grant.invoiceId!==credit.membershipInvoiceId))throw Error("An original membership grant cannot be verified.");
        const key=String(allocation.creditId),previous=sourceAmounts.get(key),allocated=(previous?.allocated??0)+amount,original=pence(credit.amount);
        if(!Number.isSafeInteger(allocated)||allocated>original)throw Error("An original credit source allocation cannot be verified.");
        sourceAmounts.set(key,{allocated,original});
        sourceRows.push({creditId:allocation.creditId,amountPence:amount,kind:allocation.kind,...(grant?{membershipGrantId:grant._id,membershipInvoiceId:grant.invoiceId}:{})});
      }
      if(sourceRows.filter(row=>row.kind==="refund").reduce((sum,row)=>sum+row.amountPence,0)!==refundCredit || sourceRows.filter(row=>row.kind==="earned").reduce((sum,row)=>sum+row.amountPence,0)!==earnedCredit)throw Error("The original credit sources do not balance.");
      let memberGrant:any;
      if(memberCredit){memberGrant=booking.membershipCreditGrantId&&await ctx.db.get(booking.membershipCreditGrantId);if(!memberGrant || !booking.accountId || String(memberGrant.accountId)!==String(booking.accountId) || !memberGrant.invoiceId || (memberGrant.initialCreditAppliedPence??0)<memberCredit)throw Error("The original membership credit grant cannot be verified.");}
      const originalAllocation=checkoutLineAllocation(rows.map((entry:any)=>entry.gross/100),[delivery/100],originalDiscount/100,memberCredit/100,creditTotal/100);
      if(rows.some((entry:any,index:number)=>pence(originalAllocation[index].membershipCredit)!==entry.member || pence(originalAllocation[index].accountCredit)!==entry.credit || pence(originalAllocation[index].card)!==entry.card))throw Error("The original basket credit allocation cannot be verified.");
      const originalSources=checkoutCreditSources(originalAllocation,sourceRows.map(row=>({creditId:row.creditId,amount:row.amountPence/100,kind:row.kind}))).map(row=>({...row,lineIndex:row.lineIndex===rows.length?-1:row.lineIndex}));
      const totals=(parts:any[])=>{const result=new Map<string,number>();for(const part of parts){if(!Number.isSafeInteger(part.lineIndex) || part.lineIndex < -1 || part.lineIndex >= rows.length || !["refund","earned"].includes(part.kind))throw Error("Invalid original credit source.");const key=JSON.stringify([part.lineIndex,String(part.creditId),part.kind]);result.set(key,(result.get(key)??0)+pence(part.amount));}return JSON.stringify([...result.entries()].sort(([left],[right])=>left.localeCompare(right)));};
      if(totals(originalSources)!==totals(booking.checkoutLineCreditSources))throw Error("The original basket credit sources cannot be verified.");
      const nextSubtotal=originalGross-gross+nextGross;
      if(!Number.isSafeInteger(nextSubtotal) || !Number.isSafeInteger(nextSubtotal*rule.percent))throw Error("The replacement basket total is invalid.");
      const nextTotalDiscount=Math.round(nextSubtotal*rule.percent/100);
      const nextMember=Math.min(memberCredit,nextSubtotal-nextTotalDiscount),creditCapacity=nextSubtotal-nextTotalDiscount-nextMember+delivery;
      if(!Number.isSafeInteger(creditCapacity) || !Number.isSafeInteger(originalGross-originalDiscount+delivery))throw Error("The basket funding total is invalid.");
      const nextCredit=Math.min(creditTotal,creditCapacity),nextAllocation=checkoutLineAllocation(rows.map((entry:any,index:number)=>(index===lineIndex?nextGross:entry.gross)/100),[delivery/100],nextTotalDiscount/100,nextMember/100,nextCredit/100);
      let creditRemaining=nextCredit;
      const retained:Source[]=[],restore:Restore[]=[];
      for(const source of sourceRows){const kept=Math.min(source.amountPence,creditRemaining);creditRemaining-=kept;if(kept)retained.push({...source,amountPence:kept});if(source.amountPence>kept)restore.push({...source,amountPence:source.amountPence-kept});}
      if(memberCredit>nextMember)restore.push({kind:"membership",amountPence:memberCredit-nextMember,membershipGrantId:memberGrant._id,membershipInvoiceId:memberGrant.invoiceId});
      const nextAllCreditSources=checkoutCreditSources(nextAllocation,retained.map(row=>({creditId:row.creditId,amount:row.amountPence/100,kind:row.kind}))).map(row=>({...row,lineIndex:row.lineIndex===rows.length?-1:row.lineIndex}));
      const nextAllFunding=rows.map((entry:any,index:number)=>{
        const amount=index===lineIndex?nextGross:entry.gross,allocation=nextAllocation[index];
        return {listingId:index===lineIndex?replacement.listingId:entry.row.listingId,start:entry.row.start,end:entry.row.end,qty:entry.row.qty,gross:amount/100,discount:allocation.discount,membershipCredit:allocation.membershipCredit,accountCredit:allocation.accountCredit,card:allocation.card};
      });
      return {lineIndex,original:{listingId:line.listingId,start:line.start,end:line.end,qty:line.qty,grossPence:gross},replacement:{listingId:replacement.listingId,start:replacement.start,end:replacement.end,qty:replacement.qty,grossPence:nextGross},deltaPence:nextSubtotal-nextTotalDiscount-nextMember-nextCredit-(originalGross-originalDiscount-memberCredit-creditTotal),restore,nextFunding:nextAllFunding[lineIndex],nextAllFunding,nextCreditSources:nextAllCreditSources.filter(row=>row.lineIndex===lineIndex),nextAllCreditSources};
    }
    if (!Number.isSafeInteger(gross * rule.percent) || !Number.isSafeInteger(nextGross * rule.percent) || pence(booking.subtotal) !== gross || pence(booking.discount) !== discount || discount !== Math.round(gross * rule.percent / 100))
      throw Error("This booking's selected benefit cannot be safely repriced automatically; manual settlement review is required.");
    nextDiscount = Math.round(nextGross * rule.percent / 100);
  } else if (!["none", "delivery", "earned_credit"].includes(booking.benefitKind) || discount !== 0) {
    throw Error("This booking's selected benefit cannot be safely repriced automatically; manual settlement review is required.");
  }
  if (discount + membership + accountCredit + card !== gross) throw Error("The item funding does not balance.");
  if (accountCredit && (!Array.isArray(booking.checkoutLineCreditSources) || !Array.isArray(booking.creditAllocations))) throw Error("The original credit sources are unavailable; manual settlement review is required.");
  const allocationTotals = new Map<string, number>();
  for (const allocation of booking.creditAllocations ?? []) {
    const key = `${allocation.creditId}:${allocation.kind}`;
    allocationTotals.set(key, (allocationTotals.get(key) ?? 0) + pence(allocation.amount));
  }
  const recordedTotals = new Map<string, number>();
  for (const part of booking.checkoutLineCreditSources ?? []) {
    const key = `${part.creditId}:${part.kind}`;
    recordedTotals.set(key, (recordedTotals.get(key) ?? 0) + pence(part.amount));
  }
  for (const [key, amount] of recordedTotals) if (amount > (allocationTotals.get(key) ?? 0)) throw Error("The original credit source allocation cannot be verified.");
  const sources: Source[] = [];
  for (const part of (booking.checkoutLineCreditSources ?? []).filter((entry: any) => entry.lineIndex === lineIndex)) {
    if (!booking.accountId || !["refund", "earned"].includes(part.kind)) throw Error("Invalid original credit source.");
    const credit = await ctx.db.get(part.creditId);
    if (!credit || String(credit.accountId) !== String(booking.accountId) || (credit.kind ?? "earned") !== part.kind || (credit.currency ?? "GBP").toUpperCase() !== "GBP")
      throw Error("An original credit source cannot be verified.");
    if (credit.membershipGrantId) {
      const grant = await ctx.db.get(credit.membershipGrantId);
      if (!grant || String(grant.accountId) !== String(booking.accountId) || grant.invoiceId !== credit.membershipInvoiceId) throw Error("An original membership grant cannot be verified.");
    }
    sources.push({ creditId: part.creditId, amountPence: pence(part.amount), kind: part.kind, ...(credit.membershipGrantId ? { membershipGrantId: credit.membershipGrantId, membershipInvoiceId: credit.membershipInvoiceId } : {}) });
  }
  if (sources.reduce((sum, source) => sum + source.amountPence, 0) !== accountCredit) throw Error("The original credit sources do not balance.");
  let membershipGrant: any;
  if (membership) {
    membershipGrant = booking.membershipCreditGrantId && await ctx.db.get(booking.membershipCreditGrantId);
    if (!membershipGrant || !booking.accountId || String(membershipGrant.accountId) !== String(booking.accountId) || !membershipGrant.invoiceId || (membershipGrant.initialCreditAppliedPence ?? 0) < membership || pence(booking.membershipCreditApplied) < membership)
      throw Error("The original membership credit grant cannot be verified.");
  }
  const keepMembership = Math.min(membership, nextGross - nextDiscount);
  let remaining = nextGross - nextDiscount - keepMembership;
  const keptSources: Source[] = [], restore: Restore[] = [];
  for (const source of sources) {
    const kept = Math.min(remaining, source.amountPence);
    remaining -= kept;
    if (kept) keptSources.push({ ...source, amountPence: kept });
    if (source.amountPence > kept) restore.push({ ...source, amountPence: source.amountPence - kept });
  }
  if (membership > keepMembership) restore.push({ kind: "membership", amountPence: membership - keepMembership, membershipGrantId: membershipGrant._id, membershipInvoiceId: membershipGrant.invoiceId });
  const nextAccount = keptSources.reduce((sum, source) => sum + source.amountPence, 0);
  const nextCard = remaining;
  return {
    lineIndex, original: { listingId: line.listingId, start: line.start, end: line.end, qty: line.qty, grossPence: gross },
    replacement: { listingId: replacement.listingId, start: replacement.start, end: replacement.end, qty: replacement.qty, grossPence: nextGross },
    deltaPence: nextCard - card, restore,
    nextFunding: { listingId: replacement.listingId, start: replacement.start, end: replacement.end, qty: replacement.qty, gross: nextGross / 100, discount: nextDiscount / 100, membershipCredit: keepMembership / 100, accountCredit: nextAccount / 100, card: nextCard / 100 },
    nextCreditSources: keptSources.map(source => ({ lineIndex, creditId: source.creditId, amount: source.amountPence / 100, kind: source.kind })),
  };
}

/** Reduce original checkout credit balances when excess credit is restored. */
export function adjustedSwapCreditBalances(booking: any, restore: Restore[]) {
  if (!restore.length) return {};
  if (!Array.isArray(booking.creditAllocations)) throw Error("The original credit allocations are unavailable.");
  const membershipBefore = pence(booking.membershipCreditApplied);
  const refundBefore = pence(booking.refundCreditApplied);
  const earnedBefore = pence(booking.earnedCreditApplied);
  if (pence(booking.creditApplied) !== membershipBefore + refundBefore + earnedBefore) throw Error("The original credit balance does not reconcile.");
  const allocations = booking.creditAllocations.map((row: any) => ({ ...row, amountPence: pence(row.amount) }));
  if (allocations.some((row: any) => !["refund", "earned"].includes(row.kind)) ||
      allocations.filter((row: any) => row.kind === "refund").reduce((sum: number, row: any) => sum + row.amountPence, 0) !== refundBefore ||
      allocations.filter((row: any) => row.kind === "earned").reduce((sum: number, row: any) => sum + row.amountPence, 0) !== earnedBefore)
    throw Error("The original credit allocations do not reconcile.");
  let membershipRestored = 0, refundRestored = 0, earnedRestored = 0;
  for (const part of restore) {
    if (!Number.isSafeInteger(part.amountPence) || part.amountPence <= 0) throw Error("Invalid credit restoration.");
    if (part.kind === "membership") {
      if (String(part.membershipGrantId) !== String(booking.membershipCreditGrantId)) throw Error("Membership credit grant changed.");
      membershipRestored += part.amountPence;
      continue;
    }
    if (!["refund", "earned"].includes(part.kind)) throw Error("Invalid original credit kind.");
    let remaining = part.amountPence;
    for (const row of allocations) {
      if (String(row.creditId) !== String(part.creditId) || row.kind !== part.kind) continue;
      const amount = Math.min(row.amountPence, remaining);
      row.amountPence -= amount; remaining -= amount;
    }
    if (remaining) throw Error("Restored credit exceeds its original source.");
    if (part.kind === "refund") refundRestored += part.amountPence;
    else earnedRestored += part.amountPence;
  }
  if (membershipRestored > membershipBefore || refundRestored > refundBefore || earnedRestored > earnedBefore) throw Error("Restored credit exceeds its original balance.");
  return {
    creditApplied: (membershipBefore + refundBefore + earnedBefore - membershipRestored - refundRestored - earnedRestored) / 100,
    membershipCreditApplied: (membershipBefore - membershipRestored) / 100,
    refundCreditApplied: (refundBefore - refundRestored) / 100,
    earnedCreditApplied: (earnedBefore - earnedRestored) / 100,
    creditAllocations: allocations.filter((row: any) => row.amountPence > 0).map((row: any) => ({ creditId: row.creditId, kind: row.kind, amount: row.amountPence / 100 })),
  };
}

/** Called only inside the atomic swap application after checking its durable idempotency marker. */
export async function restoreSwapCredit(ctx: any, booking: any, swapId: string, restore: Restore[], now: number) {
  if (!restore.length) return;
  if (!booking.accountId) throw Error("A credit restoration needs the original account.");
  let account = await ctx.db.get(booking.accountId);
  if (!account) throw Error("The original account is unavailable.");
  for (const part of restore) {
    if (!Number.isSafeInteger(part.amountPence) || part.amountPence <= 0) throw Error("Invalid credit restoration.");
    const grant = part.membershipGrantId ? await ctx.db.get(part.membershipGrantId) : null;
    if (part.membershipGrantId && (!grant || String(grant.accountId) !== String(account._id) || grant.invoiceId !== part.membershipInvoiceId)) throw Error("The original membership grant changed.");
    if (part.kind !== "membership") {
      const source = await ctx.db.get(part.creditId);
      if (!source || String(source.accountId) !== String(account._id) || (source.kind ?? "earned") !== part.kind || String(source.membershipGrantId ?? "") !== String(part.membershipGrantId ?? "")) throw Error("The original credit source changed.");
    }
    const offset = grant?.revokedPence ? Math.min(part.amountPence, account.membershipCreditDebtPence ?? 0) : 0;
    if (offset) {
      await ctx.db.patch(account._id, { membershipCreditDebtPence: (account.membershipCreditDebtPence ?? 0) - offset });
      account = await ctx.db.get(account._id);
    }
    const issued = part.amountPence - offset;
    if (!issued) continue;
    const expiresAt = now + 365 * 86400000;
    const creditId = await ctx.db.insert("credits", { accountId: account._id, amount: issued / 100, remaining: issued / 100, currency: "GBP", kind: part.kind === "membership" ? "earned" : part.kind, reason: `swap_restored_credit:${swapId}`, bookingId: booking._id, createdAt: now, expiresAt, status: "active", ...(grant ? { membershipGrantId: grant._id, membershipInvoiceId: grant.invoiceId } : {}) });
    await ctx.db.insert("credit_issues", { requestId: `rental-swap-${swapId}`, bookingId: booking._id, accountId: account._id, creditId, amountPence: issued, reason: "Item swap · previously used credit restored", createdAt: now, expiresAt });
  }
}
