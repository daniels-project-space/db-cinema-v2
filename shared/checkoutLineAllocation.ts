import { allocateSaving } from "./membership";

type Allocation = {
  gross: number;
  discount: number;
  membershipCredit: number;
  accountCredit: number;
  card: number;
};

export function checkoutLineAllocation(
  rentalAmounts: number[],
  deliveryAmounts: number[],
  discount: number,
  membershipCredit: number,
  accountCredit: number,
): Allocation[] {
  const afterDiscount = allocateSaving(rentalAmounts, discount);
  const afterMembership = allocateSaving(afterDiscount, membershipCredit);
  const afterAccount = allocateSaving([...afterMembership, ...deliveryAmounts], accountCredit);
  return [...rentalAmounts, ...deliveryAmounts].map((gross, index) => {
    const discounted = afterDiscount[index] ?? gross;
    const membershipNet = afterMembership[index] ?? gross;
    const card = afterAccount[index];
    const difference = (left: number, right: number) => Math.round((left - right) * 100) / 100;
    return {
      gross,
      discount: difference(gross, discounted),
      membershipCredit: difference(discounted, membershipNet),
      accountCredit: difference(membershipNet, card),
      card,
    };
  });
}

export function checkoutCreditSources<CreditId extends string>(
  lines: { accountCredit: number }[],
  sources: { creditId: CreditId; amount: number; kind: "refund" | "earned" }[],
) {
  const remaining = sources.map(source => ({ ...source, pence: Math.round(source.amount * 100) }));
  const result: { lineIndex: number; creditId: CreditId; amount: number; kind: "refund" | "earned" }[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    let needed = Math.round(line.accountCredit * 100);
    for (const source of remaining) {
      const used = Math.min(needed, source.pence);
      if (used > 0) result.push({ lineIndex, creditId: source.creditId, amount: used / 100, kind: source.kind });
      needed -= used;
      source.pence -= used;
    }
    if (needed) throw Error("The checkout credit sources do not match the funded items.");
  }
  if (remaining.some(source => source.pence !== 0)) throw Error("The checkout credit sources exceed the funded items.");
  return result;
}
