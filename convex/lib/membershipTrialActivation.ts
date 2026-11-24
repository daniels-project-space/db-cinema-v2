import { rentalsForAccount } from "./rentalAccount";

export function cleanRentalCompletionAt(booking: any, requireReturned = true): number | undefined {
  if (!booking || booking.cancellationDecision || (requireReturned && booking.status !== "returned")) return undefined;
  if (!Number.isSafeInteger(booking.pickedUpAt) || booking.pickedUpAt <= 0) return undefined;
  const decision = booking.returnDecision;
  const completedAt = booking.returnedAt ?? booking.actualReturnedAt ?? decision?.actualReturnedAt;
  if (!Number.isSafeInteger(completedAt) || completedAt <= 0 || !Array.isArray(decision?.inspection) || !decision.inspection.length) return undefined;
  if ((decision.damageKept ?? 0) > 0 || (decision.depositKept ?? 0) > 0 || decision.chargeLate || (booking.lateFeeAmount ?? 0) > 0) return undefined;
  if (decision.inspection.some((item: any) => item.condition !== "good" || item.openCase || item.details?.trim())) return undefined;
  return completedAt;
}

export async function firstCleanRentalCompletionAt(ctx: any, account: any): Promise<number | undefined> {
  const rentals = await rentalsForAccount(ctx, account, 100);
  let firstCompletedAt: number | undefined;
  for (const booking of rentals) {
    const completedAt = cleanRentalCompletionAt(booking);
    if (completedAt !== undefined && (firstCompletedAt === undefined || completedAt < firstCompletedAt)) firstCompletedAt = completedAt;
  }
  return firstCompletedAt;
}
