/** Customer-safe explanations derived from Didit warning codes. Do not expose
 * raw provider text, identity data, or fraud signals to the renter. */
export const DIDIT_UNREADABLE_ID = "We could not read your photo ID clearly enough to verify it. Please use a valid photo ID and make sure the whole document, your photo and details are clear and well lit.";
export const DIDIT_FAILURE_SUPPORT = "We could not complete the verification. Please contact the team from your rental conversation so we can help.";
export const DIDIT_EXPIRED_ID = "Your photo ID has expired. Please use a valid photo ID.";
export const DIDIT_ADDRESS_DETAILS = "We could not read the address on your proof of address. Please use a document that clearly shows your address.";
export const DIDIT_ADDRESS_EXPIRED = "Your proof of address is too old or has expired. Please use a recent, valid document.";
export const DIDIT_ADDRESS_UNSUPPORTED = "We could not recognise your proof of address. Please upload a clear, undamaged document such as a recent bank statement or utility bill.";
export const DIDIT_ADDRESS_DATE_UNREADABLE = "We could not check the date on your proof of address. Please upload a recent document with a clearly readable issue date.";
export const DIDIT_ID_NOT_VERIFIED = "We could not verify your photo ID. Please check that it is valid and the entire document is clear and well lit.";
export const DIDIT_ID_PHOTO_MISSING = "We could not find a photo on your ID. Please use a valid photo ID and make sure the whole document and photo are visible and well lit.";
export function customerDiditFailureNote(note: unknown): string | null {
  return [DIDIT_UNREADABLE_ID,DIDIT_FAILURE_SUPPORT,DIDIT_EXPIRED_ID,DIDIT_ADDRESS_DETAILS,DIDIT_ADDRESS_EXPIRED,DIDIT_ADDRESS_UNSUPPORTED,DIDIT_ADDRESS_DATE_UNREADABLE,DIDIT_ID_NOT_VERIFIED,DIDIT_ID_PHOTO_MISSING].includes(note as string) ? note as string : null;
}
export function diditFailureReason(decision: any): string {
  const rows = Array.isArray(decision?.id_verifications) ? decision.id_verifications : [];
  const poaRows = Array.isArray(decision?.poa_verifications) ? decision.poa_verifications : [];
  const warnings = (items:any[]) => items.flatMap((row:any) => Array.isArray(row?.warnings) ? row.warnings : []);
  const otherRows = [decision,...["liveness_checks","face_matches"].flatMap(field => Array.isArray(decision?.[field]) ? decision[field] : [])];
  if (warnings([...rows,...poaRows,...otherRows]).some(warning => typeof warning?.risk === "string" && /BLOCKLIST|MANIPULAT|FRAUD/i.test(warning.risk))) return DIDIT_FAILURE_SUPPORT;
  const relevant = (items:any[]) => new Set<string>(warnings(items.filter(row => row?.status !== "Approved"))
    .filter(warning => String(warning?.log_type ?? "").toLowerCase() !== "information")
    .map(warning => typeof warning?.risk === "string" ? warning.risk : ""));
  const risks = relevant(rows), poa = relevant(poaRows);
  if (risks.has("DOCUMENT_EXPIRED")) return DIDIT_EXPIRED_ID;
  if (risks.has("PORTRAIT_IMAGE_NOT_DETECTED")) return DIDIT_ID_PHOTO_MISSING;
  if (["NAME_NOT_DETECTED", "DATE_OF_BIRTH_NOT_DETECTED", "DOCUMENT_NUMBER_NOT_DETECTED"].some(risk => risks.has(risk)))
    return DIDIT_UNREADABLE_ID;
  if (["COULD_NOT_RECOGNIZE_DOCUMENT", "COULD_NOT_DETECT_DOCUMENT_TYPE", "DOCUMENT_NOT_SUPPORTED_FOR_APPLICATION"].some(risk => risks.has(risk))) return DIDIT_ID_NOT_VERIFIED;
  if (poa.has("POA_DOCUMENT_EXPIRED")) return DIDIT_ADDRESS_EXPIRED;
  if (poa.has("MISSING_ADDRESS_INFORMATION")) return DIDIT_ADDRESS_DETAILS;
  if (poa.has("INVALID_DOCUMENT_TYPE")) return DIDIT_ADDRESS_UNSUPPORTED;
  if (poa.has("UNABLE_TO_VALIDATE_DOCUMENT_AGE")) return DIDIT_ADDRESS_DATE_UNREADABLE;
  return DIDIT_FAILURE_SUPPORT;
}

/** Permit self-service only for explicit, remediable document errors. A fraud,
 * identity restriction, unknown error or missing reason needs human review. */
export function diditCanRetryAutomatically(decision:any): boolean {
  const safe = new Set(["PORTRAIT_IMAGE_NOT_DETECTED","DOCUMENT_EXPIRED","DOCUMENT_NOT_SUPPORTED_FOR_APPLICATION","COULD_NOT_RECOGNIZE_DOCUMENT","COULD_NOT_DETECT_DOCUMENT_TYPE","NAME_NOT_DETECTED","DATE_OF_BIRTH_NOT_DETECTED","DOCUMENT_NUMBER_NOT_DETECTED","MISSING_ADDRESS_INFORMATION","POA_DOCUMENT_EXPIRED","INVALID_DOCUMENT_TYPE","UNABLE_TO_VALIDATE_DOCUMENT_AGE"]);
  const records = [decision,...["id_verifications","liveness_checks","face_matches","poa_verifications"].flatMap(field => Array.isArray(decision?.[field]) ? decision[field] : [])];
  const warnings = records.flatMap(row => Array.isArray(row?.warnings) ? row.warnings : []);
  if (warnings.some(w => typeof w?.risk !== "string" || /BLOCKLIST|MANIPULAT|FRAUD/i.test(w.risk))) return false;
  if (warnings.some(w => ["error","warning"].includes(String(w?.log_type ?? "").toLowerCase()) && !safe.has(w.risk))) return false;
  const errors = warnings.filter(w => String(w?.log_type ?? "").toLowerCase() === "error");
  return errors.length > 0 && errors.every(w => safe.has(w.risk));
}
