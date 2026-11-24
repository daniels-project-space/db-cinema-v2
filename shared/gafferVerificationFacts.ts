const verificationCheckLabels = {
  identity: "Photo ID",
  selfie: "Selfie and face match",
  address: "Proof of address",
} as const;

const verificationCheckStateLabels: Record<string, string> = {
  approved: "passed",
  waiting: "waiting for documents",
  processing: "processing",
  requires_input: "needs new input",
  review: "under review",
  rejected: "not approved",
};

export function gafferVerificationCheckFacts(checks: unknown, source: unknown): { summary: string; incomplete: boolean } | null {
  if (source === "manual") return null;
  if (source !== "didit" && source !== "reused_didit") return null;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
    return { summary: "Required Didit document-check results are not available in this rental record.", incomplete: true };
  }
  const record = checks as Record<string, unknown>;
  const details = (Object.keys(verificationCheckLabels) as (keyof typeof verificationCheckLabels)[]).map((key) => {
    const value = typeof record[key] === "string" ? record[key].toLowerCase() : "";
    const state = verificationCheckStateLabels[value] ?? "status unclear";
    return { text: `${verificationCheckLabels[key]}: ${state}`, approved: value === "approved" };
  });
  return {
    summary: `Didit document checks: ${details.map((detail) => detail.text).join("; ")}.`,
    incomplete: details.some((detail) => !detail.approved),
  };
}
