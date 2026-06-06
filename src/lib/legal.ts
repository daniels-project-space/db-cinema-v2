/**
 * Versioned legal agreements the renter must e-sign at checkout. The accepted
 * {kind, version} list + signer name + timestamp are stored on the booking as
 * the binding consent record (used for the deposit, liability and insurance).
 * Bump LEGAL_VERSION whenever any agreement text changes.
 */
export const LEGAL_VERSION = "2026-06-v1";

export const AGREEMENTS = [
  { kind: "rental-agreement", title: "Rental Agreement", version: LEGAL_VERSION },
  { kind: "deposit-agreement", title: "Refundable Deposit Agreement", version: LEGAL_VERSION },
  { kind: "insurance", title: "Equipment Protection & Liability Policy", version: LEGAL_VERSION },
  { kind: "data-processing", title: "Data Processing Terms", version: LEGAL_VERSION },
] as const;

export type AgreementDoc = { kind: string; version: string };
