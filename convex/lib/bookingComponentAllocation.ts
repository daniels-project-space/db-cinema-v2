import { agreementRequestFingerprint } from "../../shared/rentalAgreement";

const transactionAllocations = new WeakMap<object, {ctx:any;index:number;lineFingerprint:string;allocation:any}>();

export function issueTransactionComponentAllocation(ctx: any, index: number, line: any, allocation: any) {
  const capability = Object.freeze({});
  transactionAllocations.set(capability, { ctx, index, lineFingerprint: agreementRequestFingerprint(line), allocation: structuredClone(allocation) });
  return capability;
}

export function transactionComponentAllocation(ctx: any, capability: object, index: number, line: any) {
  const record = transactionAllocations.get(capability);
  if (!record || record.ctx !== ctx) throw Error("Invalid transaction component allocation.");
  if (record.index !== index) return null;
  if (line.physicalAllocation || agreementRequestFingerprint(line) !== record.lineFingerprint) throw Error("The replacement booking line changed.");
  return record.allocation;
}

export async function storedBookingAllocation(ctx: any, line: any, bookingId: any) {
  const allocation = line.physicalAllocation;
  if (!allocation) return null;
  if (!bookingId || allocation.version !== "component-allocation-v1" || typeof allocation.id !== "string" || !allocation.id ||
      !Number.isSafeInteger(allocation.replacementValuePence) || allocation.replacementValuePence < 1 ||
      (allocation.extensionAdjustmentPence !== undefined && (!Array.isArray(allocation.extensionAdjustmentPence) || allocation.extensionAdjustmentPence.length !== 30 || allocation.extensionAdjustmentPence.some((amount: any) => !Number.isSafeInteger(amount) || Math.abs(amount) > 100000000))) ||
      !Array.isArray(allocation.components) || !allocation.components.length || allocation.components.length > 100)
    throw Error("Booking component allocation needs review.");
  const booking = await ctx.db.get(bookingId);
  const matches = booking?.lineItems?.filter((saved: any) => saved.physicalAllocation?.id === allocation.id) ?? [];
  if (matches.length !== 1 || String(matches[0].listingId) !== String(line.listingId) || matches[0].qty !== line.qty ||
      agreementRequestFingerprint(matches[0].physicalAllocation) !== agreementRequestFingerprint(allocation))
    throw Error("Booking component allocation needs review.");
  const seen = new Set<string>();
  for (const component of allocation.components) {
    const key = String(component.inventoryUnitId);
    if (!component.inventoryUnitId || seen.has(key) || !Number.isSafeInteger(component.qty) || component.qty < 1 || component.qty > 100)
      throw Error("Booking component allocation needs review.");
    seen.add(key);
  }
  return allocation as { version: "component-allocation-v1"; id: string; replacementValuePence: number; extensionAdjustmentPence?: number[]; components: { inventoryUnitId: any; qty: number }[] };
}

export async function storedBookingComponents(ctx: any, line: any, bookingId: any) {
  return (await storedBookingAllocation(ctx, line, bookingId))?.components ?? null;
}
