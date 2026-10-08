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
