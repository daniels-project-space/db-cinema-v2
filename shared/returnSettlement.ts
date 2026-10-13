/** Cash refunds and unused authorisations are distinct. All arithmetic uses pence. */
export function returnSecurityPlan(input: {
  deposit: number; capturedSecurity: number; damage: number;
  holdAvailable: number; holdUncaptured: number;
}) {
  if (!Object.values(input).every(n => Number.isFinite(n) && n >= 0)) throw Error("Invalid security settlement amounts");
  const [deposit, captured, damage, hold, uncaptured] = [input.deposit, input.capturedSecurity, input.damage, input.holdAvailable, input.holdUncaptured].map(n => Math.round(n * 100));
  if (![deposit, captured, damage, hold, uncaptured].every(Number.isSafeInteger)) throw Error("Invalid security settlement amounts");
  if (uncaptured > hold) throw Error("Invalid security settlement amounts");
  const cash = Math.min(deposit, captured);
  if (damage > cash + hold) throw Error("The active card hold and captured security cannot cover this deduction. Handle any further claim separately.");
  const fromHold = Math.min(damage, hold), fromDeposit = damage - fromHold;
  return { damageFromHold: fromHold / 100, damageFromDeposit: fromDeposit / 100,
    depositRefund: (cash - fromDeposit) / 100, holdRelease: Math.max(0, uncaptured - fromHold) / 100,
    availableSecurity: (cash + hold) / 100 };
}

/** Refund the unused cash deposit; later card collection must subtract kept cash. */
export function refundableDepositPlan(input: { deposit: number; capturedSecurity: number; assessedDamage: number; keptDeposit?: number }) {
  if (![input.deposit, input.capturedSecurity, input.assessedDamage].every(n => Number.isFinite(n) && n >= 0 && Number.isSafeInteger(Math.round(n * 100)) && Math.round(n * 100) / 100 === n))
    throw Error("Invalid refundable deposit settlement amounts.");
  if (input.capturedSecurity < input.deposit) throw Error("The refundable deposit payment is not fully accounted for. Review the payment before settlement.");
  const kept = input.keptDeposit ?? Math.min(input.deposit, input.assessedDamage);
  if (!Number.isFinite(kept) || kept < 0 || !Number.isSafeInteger(Math.round(kept * 100)) || Math.round(kept * 100) / 100 !== kept || kept > input.deposit || kept > input.assessedDamage)
    throw Error("Retained deposit must be within the paid deposit and evidenced damage amount.");
  const depositRefund = (Math.round(input.deposit * 100) - Math.round(kept * 100)) / 100;
  const damageAfterDeposit = (Math.round(input.assessedDamage * 100) - Math.round(kept * 100)) / 100;
  return { damageFromDeposit: kept, damageFromHold: 0, depositRefund, holdRelease: 0, availableSecurity: input.deposit, damageAfterDeposit };
}
