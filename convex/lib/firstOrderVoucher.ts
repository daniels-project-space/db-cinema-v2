import { rentalsForAccount } from "./rentalAccount";
export const FIRST_ORDER_VOUCHER_CODE = "db10off";

/** Permanent account history, not browser storage or client-supplied email. */
export async function firstOrderVoucherReason(ctx: any, account: any) {
  if (!account || account.blockedAt != null) return "Sign in to use your first-order voucher.";
  if (account.firstRentalPaidAt != null) return "DB10OFF is only available on your first order.";
  const rows = await rentalsForAccount(ctx,account,101);
  if (rows.length > 100) return "Your order history needs review before using this voucher.";
  if (rows.some((b: any) => ["confirmed", "active", "returned"].includes(b.status) ||
    b.status === "cancelled" && (b.stripePaymentIntentId || b.rentalPaidPence !== undefined || b.accountCreatedAtCheckout)))
    return "DB10OFF is only available on your first order.";
  if (rows.some((b: any) => b.status === "pending_payment"))
    return "Finish or cancel your open checkout before using DB10OFF.";
  return null;
}

/** Serialized with insertion: another order cannot overtake a reserved first order. */
export async function assertFirstOrderReservation(ctx: any, account: any, code?: string) {
  const voucher = code?.trim().toLowerCase() === FIRST_ORDER_VOUCHER_CODE;
  if (voucher) {
    const reason = await firstOrderVoucherReason(ctx, account);
    if (reason) throw Error(reason);
  } else if (account && account.firstRentalPaidAt == null) {
    const pending = await rentalsForAccount(ctx,account,101);
    if (pending.some((b: any) => b.status === "pending_payment" && b.promoCode === FIRST_ORDER_VOUCHER_CODE))
      throw Error("Finish or cancel your reserved DB10OFF checkout before starting another order.");
  }
}
