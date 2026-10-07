export const VERIFICATION_FEATURES = ["identity", "selfie", "address"] as const;
export type VerificationCheck = "waiting" | "processing" | "approved" | "requires_input" | "review" | "rejected";
export type VerificationChecks = Record<(typeof VERIFICATION_FEATURES)[number], VerificationCheck>;
export function verificationChecks(decision: any): VerificationChecks {
  function check(fields: string[]): VerificationCheck {
    const rows = fields.flatMap(field => Array.isArray(decision?.[field]) ? decision[field] : []);
    if (!rows.length) return "waiting";
    const statuses = rows.map(row => row?.status);
    if (statuses.every(s => s === "Approved")) return "approved";
    if (statuses.every(s => s === "Not Started")) return "waiting";
    if (statuses.some(s => s === "Declined" || s === "Kyc Expired")) return "rejected";
    if (statuses.some(s => ["Awaiting User", "Resubmitted", "Expired", "Abandoned", "Not Finished"].includes(s))) return "requires_input";
    if (statuses.some(s => s === "In Review")) return "review";
    return "processing";
  }
  return { identity: check(["id_verifications"]), selfie: check(["liveness_checks", "face_matches"]), address: check(["poa_verifications"]) };
}
export function securityReady(booking: { status: string; depositHoldAmount?: number; depositHoldStatus?: string | null }) {
  return ["confirmed", "active"].includes(booking.status) && (!(booking.depositHoldAmount ?? 0) || booking.depositHoldStatus === "held");
}
