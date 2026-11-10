export type SwapAdjustmentDocumentType =
  | "supplementary_invoice"
  | "credit_note"
  | "account_adjustment";

export type SwapAdjustmentDocumentIdentity = {
  documentType: SwapAdjustmentDocumentType;
  documentNumber: string;
};

/** Stable identity for the one issued adjustment document per accepted swap. */
export function swapAdjustmentDocumentIdentity(
  swapId: string,
  cardChargePence: number,
  cardRefundPence: number,
): SwapAdjustmentDocumentIdentity {
  if (!swapId || !Number.isSafeInteger(cardChargePence) || cardChargePence < 0 ||
      !Number.isSafeInteger(cardRefundPence) || cardRefundPence < 0 ||
      (cardChargePence > 0 && cardRefundPence > 0)) {
    throw new Error("The equipment adjustment document identity is invalid.");
  }

  const documentType: SwapAdjustmentDocumentType = cardChargePence > 0
    ? "supplementary_invoice"
    : cardRefundPence > 0
      ? "credit_note"
      : "account_adjustment";
  const prefix = documentType === "supplementary_invoice"
    ? "DBC-SI"
    : documentType === "credit_note"
      ? "DBC-CN"
      : "DBC-ADJ";
  // Convex IDs are case-sensitive. Preserve every character so distinct IDs
  // cannot collapse to the same accounting document number.
  const stableId = swapId.trim();
  if (!/^[a-z0-9_-]+$/i.test(stableId)) throw new Error("The equipment adjustment document identity is invalid.");

  return { documentType, documentNumber: `${prefix}-${stableId}` };
}
