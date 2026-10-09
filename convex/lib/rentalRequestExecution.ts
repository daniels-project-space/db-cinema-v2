import { belongsToRentalAccount } from "./rentalAccount";

export type RequestOperation = "reschedule" | "cancellation" | "kit_removal";

/** Only the existing guarded operation may attach or complete this receipt. */
export async function approvedRequest(ctx: any, booking: any, id: any, operation: RequestOperation, operationKey: string) {
  if (!id) return null;
  const request = await ctx.db.get(id);
  const account = request ? await ctx.db.get(request.accountId) : null;
  const kind = operation === "reschedule" ? "dates" : operation === "kit_removal" ? "items" : "cancel";
  if (!request || request.bookingId !== booking?._id || request.kind !== kind || request.status !== "approved" || !belongsToRentalAccount(booking, account))
    throw Error("Choose an approved request for this rental and operation.");
  if(operation==="kit_removal"&&(request.additionRequestId||request.kitSelection&&request.kitSelection.change!=="remove"))throw Error("Use the approved equipment removal request.");
  if (request.execution && (request.execution.operation !== operation || request.execution.operationKey !== operationKey))
    throw Error("The agreed operation has changed. Discuss and approve a new request.");
  return request;
}

export async function startRequest(ctx: any, booking: any, id: any, operation: RequestOperation, operationKey: string) {
  const request = await approvedRequest(ctx, booking, id, operation, operationKey);
  if (!request || request.execution) return request;
  await ctx.db.patch(request._id, { execution: { operation, operationKey, status: "processing", startedAt: Date.now() } });
  return request;
}

export async function finishRequest(ctx: any, booking: any, id: any, operation: RequestOperation, operationKey: string, detail: string) {
  const request = await approvedRequest(ctx, booking, id, operation, operationKey);
  if (!request || request.execution?.status === "applied") return;
  await ctx.db.patch(request._id, { execution: { operation, operationKey, status: "applied", startedAt: request.execution?.startedAt ?? Date.now(), appliedAt: Date.now(), detail } });
}

export function rescheduleRequestKey(start: number, end: number | undefined, keepAgreedPrice: boolean | undefined, reason: string) {
  return JSON.stringify(["reschedule", start, end ?? null, keepAgreedPrice === true, reason.trim()]);
}
export function cancellationRequestKey(bookingId: string, requestId: string) {
  return `cancellation:${bookingId}:${requestId}`;
}
