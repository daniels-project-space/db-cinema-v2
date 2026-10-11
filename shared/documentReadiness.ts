type Archive = { status: string; copiesReady: boolean; source?: string; retention: { expiresAt: number | null; viewable: boolean; status: string }; documents: { kind: string; available: boolean }[] };
/** Approval, provider document expiry and archive retention are separate facts. */
export function documentReadiness(archives: Archive[], verified: boolean, verificationExpiresAt: number | null, now: number) {
  const usable = archives.filter(a => a.status !== "deleted" && a.retention.viewable && (a.retention.expiresAt === null || a.retention.expiresAt > now));
  const saved = (kind: "identity" | "address") => usable.some(a => a.status === "complete" && a.copiesReady && a.documents.some(d => d.available && (kind === "address" ? d.kind.startsWith("address-") : d.kind.startsWith("identity-"))));
  const approved = verified && (verificationExpiresAt === null || verificationExpiresAt > now);
  const approval = !approved ? verified ? "Expired approval" : "Awaiting approval" : verificationExpiresAt !== null && verificationExpiresAt - now <= 7 * 86400000 ? "Approval expiring soon" : "Approved";
  const expiry = usable.map(a => a.retention.expiresAt).filter((at): at is number => at !== null).sort((a,b)=>a-b)[0] ?? null;
  return { approved, approval, identitySaved: saved("identity"), addressSaved: saved("address"),
    archiveExpiry: expiry, daysLeft: expiry === null ? null : Math.ceil((expiry - now) / 86400000),
    protectedArchive: usable.some(a => ["active-rental", "insurance-case", "manual-hold"].includes(a.retention.status)),
    ready: approved && saved("identity") && saved("address") };
}
