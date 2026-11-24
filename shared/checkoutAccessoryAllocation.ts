import { allocateSaving } from "./membership";

export type CheckoutAccessoryAllocation = {
  gross: number;
  discount: number;
  membershipCredit: number;
  accountCredit: number;
  card: number;
};

/** Apply ordinary rental discounts only to non-offer gear. Wallet credits remain tender. */
export function checkoutAccessoryLineAllocation(
  rentalAmounts: number[],
  accessoryOfferIndexes: number[],
  deliveryAmounts: number[],
  discount: number,
  membershipCredit: number,
  accountCredit: number,
  otherAmounts: number[] = [],
): CheckoutAccessoryAllocation[] {
  const accessoryIndexes = new Set(accessoryOfferIndexes);
  if (accessoryIndexes.size !== accessoryOfferIndexes.length ||
      [...accessoryIndexes].some(index => !Number.isSafeInteger(index) || index < 0 || index >= rentalAmounts.length))
    throw new Error("Invalid checkout accessory line allocation.");
  const moneyValues=[...rentalAmounts,...deliveryAmounts,...otherAmounts,discount,membershipCredit,accountCredit];
  if(moneyValues.some(value=>!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))))
    throw new Error("Invalid checkout allocation amount.");

  const discountableIndexes = rentalAmounts.map((_, index) => index).filter(index => !accessoryIndexes.has(index));
  const discountableTotal=discountableIndexes.reduce((sum,index)=>sum+Math.round(rentalAmounts[index]*100),0);
  if(Math.round(discount*100)>discountableTotal)throw new Error("Rental discounts exceed the eligible gear total.");
  const discountedBase = allocateSaving(discountableIndexes.map(index => rentalAmounts[index]), discount);
  const afterDiscount = rentalAmounts.map((amount, index) => accessoryIndexes.has(index)
    ? amount
    : discountedBase[discountableIndexes.indexOf(index)] ?? amount);
  const afterDiscountTotal=afterDiscount.reduce((sum,amount)=>sum+Math.round(amount*100),0);
  if(Math.round(membershipCredit*100)>afterDiscountTotal)throw new Error("Subscription credit exceeds the discounted rental total.");
  const afterMembership = allocateSaving(afterDiscount, membershipCredit);
  const afterMembershipTotal=afterMembership.reduce((sum,amount)=>sum+Math.round(amount*100),0)+deliveryAmounts.reduce((sum,amount)=>sum+Math.round(amount*100),0)+otherAmounts.reduce((sum,amount)=>sum+Math.round(amount*100),0);
  if(Math.round(accountCredit*100)>afterMembershipTotal)throw new Error("Account credit exceeds the remaining checkout balance.");
  const afterAccount = allocateSaving([...afterMembership, ...deliveryAmounts, ...otherAmounts], accountCredit);
  return [...rentalAmounts, ...deliveryAmounts, ...otherAmounts].map((gross, index) => {
    const afterDiscountAmount = index < rentalAmounts.length ? afterDiscount[index] : gross;
    const afterMembershipAmount = afterMembership[index] ?? gross;
    const card = afterAccount[index] ?? gross;
    const pennyDifference = (left: number, right: number) => Math.round((left - right) * 100) / 100;
    return {
      gross,
      discount: pennyDifference(gross, afterDiscountAmount),
      membershipCredit: pennyDifference(afterDiscountAmount, afterMembershipAmount),
      accountCredit: pennyDifference(afterMembershipAmount, card),
      card,
    };
  });
}
