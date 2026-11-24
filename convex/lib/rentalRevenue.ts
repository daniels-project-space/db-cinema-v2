type RefundPart = { paymentIntentId: string; stripeRefundId?: string; attemptKey?: string; status: string; amountPence: number };
type RefundAllocation = { paymentIntentId: string; amountPence: number };
type RefundReceipt = { paymentIntentId?: string; stripeRefundId?: string; attemptKey?: string; amountPence?: number; status: string };
type RentalRefundRecord = {
  amountPence: number;
  status: string;
  stripeRefundId?: string;
  allocations?: RefundAllocation[];
  parts?: RefundPart[];
  refundReceipts?: RefundReceipt[];
  refundAmbiguity?: unknown;
};

export function rentalAmountAfterRefundableSecurityPence(total: number, refundableSecurity: number, alreadyFundedCredit = 0): number | null {
  if (![total, refundableSecurity, alreadyFundedCredit].every(Number.isFinite) || total < 0 || refundableSecurity < 0 || alreadyFundedCredit < 0) return null;
  const totalPence = Math.round(total * 100), securityPence = Math.round(refundableSecurity * 100), creditPence = Math.round(alreadyFundedCredit * 100);
  if (![totalPence, securityPence, creditPence].every(Number.isSafeInteger) || securityPence + creditPence > totalPence) return null;
  return totalPence - securityPence - creditPence;
}

export function bookingRentalCollectedPence(booking: {
  total: number;
  depositAmount: number;
  creditApplied?: number;
  checkoutPaymentAmountPence?: number;
  checkoutPaymentCurrency?: string;
  checkoutPaymentStatus?: string;
  membershipCheckoutId?: unknown;
  rentalPaidPence?: number;
  stripePaymentIntentId?: string;
  checkoutExpectedAmountPence?: number;
}): number | null {
  if (booking.checkoutPaymentStatus === "no_payment_required") {
    if (booking.checkoutPaymentCurrency?.toUpperCase() !== "GBP" || booking.stripePaymentIntentId ||
        booking.checkoutExpectedAmountPence !== undefined && booking.checkoutExpectedAmountPence !== 0) return null;
    return 0;
  }
  if (booking.checkoutPaymentStatus !== "paid" || booking.checkoutPaymentCurrency?.toUpperCase() !== "GBP" || !Number.isSafeInteger(booking.checkoutPaymentAmountPence) || (booking.checkoutPaymentAmountPence as number) < 0) return null;
  if (booking.membershipCheckoutId) {
    if (!Number.isSafeInteger(booking.rentalPaidPence) || (booking.rentalPaidPence as number) < 0) return null;
    if ((booking.rentalPaidPence as number) > (booking.checkoutPaymentAmountPence as number)) return null;
    const securityPence = Math.round(booking.depositAmount * 100);
    if (!Number.isSafeInteger(securityPence) || securityPence < 0 || securityPence > (booking.rentalPaidPence as number)) return null;
    return (booking.rentalPaidPence as number) - securityPence;
  }
  const securityPence = Math.round(booking.depositAmount * 100);
  if (!Number.isSafeInteger(securityPence) || securityPence < 0 || securityPence > (booking.checkoutPaymentAmountPence as number)) return null;
  return (booking.checkoutPaymentAmountPence as number) - securityPence;
}

type RentalRevenueBreakdown = { complete: true; cashPence: number; creditPence: number } | { complete: false };
function safePence(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100)) && value >= 0
    ? Math.round(value * 100)
    : null;
}

function safeMinor(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function addCardSource(sources: Map<string, number>, paymentIntentId: unknown, capturedPence: unknown, refundableSecurityPence = 0): boolean {
  const captured = safeMinor(capturedPence), security = safeMinor(refundableSecurityPence);
  if (typeof paymentIntentId !== "string" || !paymentIntentId || captured === null || security === null || security > captured || sources.has(paymentIntentId)) return false;
  sources.set(paymentIntentId, captured - security);
  return true;
}

async function boundedBookingRows(ctx: any, table: string, bookingId: unknown): Promise<any[] | null> {
  const rows = await ctx.db.query(table).withIndex("by_booking", (q: any) => q.eq("bookingId", bookingId)).take(101);
  return rows.length <= 100 ? rows : null;
}

/** Read only finalized indexed ledger rows. Missing capture/credit evidence makes the booking unavailable. */
export async function bookingRentalRevenueBreakdown(ctx: any, booking: any): Promise<RentalRevenueBreakdown> {
  const baseCash = bookingRentalCollectedPence(booking);
  const refundableSecurityPence = safePence(booking.depositAmount);
  if (baseCash === null || refundableSecurityPence === null) return { complete: false };
  const cashSources = new Map<string, number>();
  if (baseCash > 0 && !addCardSource(cashSources, booking.stripePaymentIntentId, baseCash + refundableSecurityPence, refundableSecurityPence)) return { complete: false };
  if (baseCash === 0 && booking.checkoutPaymentStatus === "paid" &&
      !addCardSource(cashSources, booking.stripePaymentIntentId, booking.checkoutPaymentAmountPence, refundableSecurityPence)) return { complete: false };

  const [additions, extensions, priceChanges, deliveryQuotes, swaps, creditRows, refunds] = await Promise.all([
    boundedBookingRows(ctx, "rental_additions", booking._id),
    boundedBookingRows(ctx, "booking_change_requests", booking._id),
    boundedBookingRows(ctx, "rental_price_adjustments", booking._id),
    boundedBookingRows(ctx, "rental_delivery_quotes", booking._id),
    boundedBookingRows(ctx, "rental_item_swaps", booking._id),
    boundedBookingRows(ctx, "rental_credit_reservations", booking._id),
    boundedBookingRows(ctx, "rental_refunds", booking._id),
  ]);
  if (!additions || !extensions || !priceChanges || !deliveryQuotes || !swaps || !creditRows || !refunds) return { complete: false };

  const operationCredits = new Map<string, number>();
  const priceAdjustmentRefunds: RentalRefundRecord[] = [];
  const creditOperation = (type: string, row: any, cardPaymentTable = false): boolean => {
    const paymentIntentId = row.paymentIntentId;
    const cardPaid = row.cardPaidPence;
    const cardDue = row.cardDuePence;
    const security = cardPaymentTable ? safePence(row.securityCharge) : 0;
    const creditApplied = safeMinor(row.creditAppliedPence ?? 0);
    if (creditApplied === null || security === null) return false;
    const key = `${type}:${String(row._id)}`;
    operationCredits.set(key, creditApplied);
    if (paymentIntentId) {
      if (cardDue !== undefined && safeMinor(cardDue) !== safeMinor(cardPaid)) return false;
      return addCardSource(cashSources, paymentIntentId, cardPaid, security);
    }
    if (cardPaid !== undefined && cardPaid !== 0 || cardDue !== undefined && cardDue !== 0) return false;
    return true;
  };

  for (const row of additions) {
    if (row.status !== "applied") continue;
    if (!creditOperation("addition", row, true)) return { complete: false };
    if (!row.paymentIntentId && row.cardDuePence === undefined && !row.complimentary && !(row.creditAppliedPence > 0)) return { complete: false };
  }
  for (const row of extensions) {
    if (row.type !== "extend" || row.status !== "applied") continue;
    if (!creditOperation("extension", row)) return { complete: false };
    if (!row.paymentIntentId && row.settlementKind === "stripe") return { complete: false };
    if (!row.paymentIntentId && row.settlementKind === undefined && (safePence(row.priceDelta) ?? 0) > 0 && !(row.creditAppliedPence > 0)) return { complete: false };
  }
  for (const row of priceChanges) {
    if (row.status === "applied") {
      const amountPence = safePence(row.delta);
      if (amountPence === null || amountPence === 0 || row.refundReceipt ||
          !addCardSource(cashSources, row.paymentIntentId, amountPence)) return { complete: false };
      continue;
    }
    if (["refunded", "refund_pending", "refund_review"].includes(row.status)) {
      const amountPence = safePence(row.delta);
      const receipt = row.refundReceipt;
      if (amountPence === null || amountPence === 0 || !receipt ||
          receipt.paymentIntentId !== row.paymentIntentId || safeMinor(receipt.amountPence) !== amountPence ||
          !addCardSource(cashSources, receipt.paymentIntentId, amountPence)) return { complete: false };
      priceAdjustmentRefunds.push({ amountPence, status: receipt.status, stripeRefundId: receipt.stripeRefundId });
      continue;
    }
    if (row.paymentIntentId || row.refundReceipt) return { complete: false };
  }
  for (const row of deliveryQuotes) {
    if (row.status !== "paid") continue;
    if (!creditOperation("delivery", row)) return { complete: false };
    if (!row.paymentIntentId && row.cardDuePence === undefined && (safeMinor(row.amountPence) ?? 0) > 0 && !(row.creditAppliedPence > 0)) return { complete: false };
  }
  for (const row of swaps) {
    if (row.status !== "applied" || !(row.quote?.deltaPence > 0)) continue;
    const amountPence = safeMinor(row.quote.deltaPence);
    if (amountPence === null || !addCardSource(cashSources, row.paymentIntentId, amountPence)) return { complete: false };
  }

  let operationCreditPence = 0;
  const seenOperationKeys = new Set<string>();
  for (const row of creditRows) {
    if (row.state === "released") continue;
    const amount = safeMinor(row.amountPence), restored = safeMinor(row.restoredPence ?? 0);
    if (amount === null || restored === null || restored > amount) return { complete: false };
    const key = `${row.operationType}:${row.operationId}`;
    const expected = operationCredits.get(key);
    if (expected === undefined || seenOperationKeys.has(key) || expected !== amount) return { complete: false };
    seenOperationKeys.add(key);
    if (row.state === "reserved") return { complete: false };
    if (row.state === "consumed") operationCreditPence += amount - restored;
    else if (row.state === "restored" && restored !== amount) return { complete: false };
  }
  for (const [key, amount] of operationCredits) {
    if (amount > 0 && !seenOperationKeys.has(key)) return { complete: false };
  }

  const appliedSwaps = swaps.filter(row => row.status === "applied");
  const swapReceipts = await Promise.all(appliedSwaps.map(async row => {
    const receipts = await ctx.db.query("rental_swap_adjustment_receipts").withIndex("by_swap", (q: any) => q.eq("swapId", row._id)).take(2);
    if (receipts.length > 1) return null;
    return receipts[0] ?? null;
  }));
  let swapCreditRestoredPence = 0;
  for (let index = 0; index < swapReceipts.length; index++) {
    const receipt = swapReceipts[index], swap = appliedSwaps[index];
    let quotedRestore = 0;
    if (Array.isArray(swap.quote?.restore)) {
      for (const row of swap.quote.restore) {
        const amount = safeMinor(row.amountPence);
        if (amount === null) return { complete: false };
        quotedRestore += amount;
      }
    }
    if (!receipt) return { complete: false };
    if (receipt) {
      const amount = safeMinor(receipt.accountCreditRestoredPence);
      const deltaPence = swap.quote?.deltaPence;
      if (typeof deltaPence !== "number" || !Number.isSafeInteger(deltaPence)) return { complete: false };
      const expectedCharge = Math.max(deltaPence, 0);
      const expectedRefund = Math.max(-deltaPence, 0);
      const charge = safeMinor(receipt.cardChargePence), refund = safeMinor(receipt.cardRefundPence);
      if (receipt.bookingId !== booking._id || receipt.currency !== "GBP" || amount === null || amount !== quotedRestore ||
          charge === null || refund === null || charge !== expectedCharge || refund !== expectedRefund) return { complete: false };
      swapCreditRestoredPence += amount;
    }
  }

  const refundAccounting = rentalRefundAccounting([...refunds, ...priceAdjustmentRefunds]);
  const capturedCashPence = [...cashSources.values()].reduce((sum, amount) => sum + amount, 0);
  if (!refundAccounting.complete || refundAccounting.refundedPence > capturedCashPence) return { complete: false };
  const cashPence = capturedCashPence - refundAccounting.refundedPence;
  const initialCreditPence = booking.checkoutCreditState === "spent" ? safePence(booking.creditApplied ?? 0) : 0;
  if (initialCreditPence === null) return { complete: false };
  const creditBeforeRestores = initialCreditPence + operationCreditPence;
  if (!Number.isSafeInteger(creditBeforeRestores) || swapCreditRestoredPence > creditBeforeRestores) return { complete: false };
  const creditPence = creditBeforeRestores - swapCreditRestoredPence;
  return Number.isSafeInteger(cashPence) && Number.isSafeInteger(creditPence)
    ? { complete: true, cashPence, creditPence }
    : { complete: false };
}

export function rentalRefundAccounting(refunds: RentalRefundRecord[]): { complete: boolean; refundedPence: number } {
  let refundedPence = 0;
  const providerRefundIds = new Set<string>();
  for (const refund of refunds) {
    if (!Number.isSafeInteger(refund.amountPence) || refund.amountPence < 0 || refund.refundAmbiguity) return { complete: false, refundedPence: 0 };
    if (refund.refundReceipts?.some(receipt => receipt.status === "unknown" || receipt.status === "pending" || receipt.status === "awaiting_approval" || receipt.status === "succeeded" && !receipt.stripeRefundId))
      return { complete: false, refundedPence: 0 };

    const parts = refund.parts;
    if (parts) {
      if (!refund.allocations?.length) return { complete: false, refundedPence: 0 };
      const successfulReceipts = refund.refundReceipts?.filter(receipt => receipt.status === "succeeded") ?? [];
      if (successfulReceipts.some(receipt => !parts.some(part =>
        part.paymentIntentId === receipt.paymentIntentId && part.stripeRefundId === receipt.stripeRefundId &&
        part.amountPence === receipt.amountPence && part.status === "succeeded" && (part.attemptKey ?? undefined) === (receipt.attemptKey ?? undefined))))
        return { complete: false, refundedPence: 0 };
      const allocations = new Map(refund.allocations.map(row => [row.paymentIntentId, row.amountPence]));
      if (allocations.size !== refund.allocations.length || refund.allocations.some(row => !Number.isSafeInteger(row.amountPence) || row.amountPence <= 0))
        return { complete: false, refundedPence: 0 };
      const seenPayments = new Set<string>();
      for (const part of parts) {
        const allocated = allocations.get(part.paymentIntentId);
        if (allocated === undefined || seenPayments.has(part.paymentIntentId) || allocated !== part.amountPence ||
            !part.stripeRefundId || !["succeeded", "failed", "pending"].includes(part.status) || providerRefundIds.has(part.stripeRefundId))
          return { complete: false, refundedPence: 0 };
        if (part.status === "pending") return { complete: false, refundedPence: 0 };
        seenPayments.add(part.paymentIntentId);
        providerRefundIds.add(part.stripeRefundId);
        if (part.status === "succeeded") refundedPence += part.amountPence;
      }
      if (!Number.isSafeInteger(refund.allocations.reduce((sum, row) => sum + row.amountPence, 0)) ||
          refund.allocations.reduce((sum, row) => sum + row.amountPence, 0) !== refund.amountPence)
        return { complete: false, refundedPence: 0 };
      if (parts.length !== refund.allocations.length)
        return { complete: false, refundedPence: 0 };
      if (refund.status === "succeeded" && parts.some(part => part.status !== "succeeded")) return { complete: false, refundedPence: 0 };
      if (refund.status === "pending" && !parts.some(part => part.status === "pending")) return { complete: false, refundedPence: 0 };
      if (!["prepared", "pending", "succeeded", "failed"].includes(refund.status)) return { complete: false, refundedPence: 0 };
      continue;
    }

    if (refund.refundReceipts?.length) return { complete: false, refundedPence: 0 };
    if (refund.status === "pending") return { complete: false, refundedPence: 0 };
    if (["succeeded", "failed"].includes(refund.status)) {
      if (!refund.stripeRefundId || providerRefundIds.has(refund.stripeRefundId)) return { complete: false, refundedPence: 0 };
      providerRefundIds.add(refund.stripeRefundId);
      if (refund.status === "succeeded") refundedPence += refund.amountPence;
    } else if (refund.status !== "prepared") return { complete: false, refundedPence: 0 };
  }
  return Number.isSafeInteger(refundedPence) ? { complete: true, refundedPence } : { complete: false, refundedPence: 0 };
}
