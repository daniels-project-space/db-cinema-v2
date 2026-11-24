/** Customer-safe explanations derived from Didit warning codes. Do not expose
 * raw provider text, identity data, or fraud signals to the renter. */
export const DIDIT_UNREADABLE_ID = "We could not read your photo ID clearly enough to verify it. Please use a valid photo ID and make sure the whole document, your photo and details are clear and well lit.";
export const DIDIT_FAILURE_SUPPORT = "We could not complete the verification. You can retry the unsuccessful steps or contact the team from your rental conversation.";
export const DIDIT_RETRY_UNAVAILABLE = "Didit cannot offer another attempt for this decision. Message our team in your rental conversation for help.";
export const DIDIT_DOCUMENT_EXPIRED = "Your photo ID has expired. Upload a current ID to continue verification.";

export function customerDiditRetryAvailable(status: unknown, note: unknown) {
  if (status !== "rejected") return true;
  return note === DIDIT_UNREADABLE_ID || note === DIDIT_FAILURE_SUPPORT;
}

export function customerDiditFailureNote(note: unknown): string | null {
  return note === DIDIT_UNREADABLE_ID || note === DIDIT_FAILURE_SUPPORT || note === DIDIT_RETRY_UNAVAILABLE || note === DIDIT_DOCUMENT_EXPIRED ? note : null;
}
export function diditFailureReason(decision: any): string {
  if (decision?.decision_trace?.decided_by !== "automatic") return DIDIT_RETRY_UNAVAILABLE;
  const rows = Array.isArray(decision?.id_verifications) ? decision.id_verifications : [];
  const risks = new Set<string>(rows.flatMap((row: any) => Array.isArray(row?.warnings)
    ? row.warnings.map((warning: any) => typeof warning?.risk === "string" ? warning.risk : "") : []));
  if (["PORTRAIT_IMAGE_NOT_DETECTED", "COULD_NOT_DETECT_DOCUMENT_TYPE", "NAME_NOT_DETECTED", "DATE_OF_BIRTH_NOT_DETECTED", "DOCUMENT_NUMBER_NOT_DETECTED"].some(risk => risks.has(risk)))
    return DIDIT_UNREADABLE_ID;
  return DIDIT_FAILURE_SUPPORT;
}
