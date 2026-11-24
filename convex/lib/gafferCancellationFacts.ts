import { bookingCancelKind, cancellationTimingBasis } from "../../src/lib/cancellationPolicy";
import { LEGAL_ARCHIVE } from "../../shared/legalDocuments";
import { readAgreementSnapshot } from "../../shared/rentalAgreement";

type CancellationDocument = {
  sections?: Array<{ h?: unknown; p?: unknown }>;
};

export type GafferCancellationFacts = {
  termsVersion: string | null;
  termsText: string | null;
  policy: "full_refund" | "store_credit" | "no_refund" | null;
  timingBasis: string | null;
  assessedAt: number;
  decisionPending: boolean;
};

function cancellationText(document: CancellationDocument | null | undefined): string | null {
  if (!Array.isArray(document?.sections)) return null;
  const text = document.sections
    .filter((section) => typeof section.h === "string" && /^(?:your cancellation|cancellation and refunds)$/i.test(section.h.trim()))
    .map((section) => typeof section.p === "string" ? section.p.trim() : "")
    .filter(Boolean)
    .join(" ");
  return text || null;
}

export function gafferCancellationFacts(booking: any, assessedAt = Date.now()): GafferCancellationFacts {
  const termsVersion = booking?.agreementDocs?.find((document: any) => document?.kind === "cancellation" && typeof document.version === "string")?.version ?? null;
  const snapshot = readAgreementSnapshot(typeof booking?.agreementSnapshot === "string" ? booking.agreementSnapshot : undefined);
  const snapshotTerms = snapshot?.documents.find((document) => document.kind === "cancellation" && document.version === termsVersion)?.text;
  const archivedTerms = termsVersion ? LEGAL_ARCHIVE[termsVersion]?.cancellation : undefined;
  const termsText = cancellationText(snapshotTerms) ?? cancellationText(archivedTerms);
  const hasSignedTerms = !!termsVersion && !!termsText && Array.isArray(booking?.lineItems) && booking.lineItems.length > 0;
  const policy = hasSignedTerms
    ? booking.cancellationDecision?.kind ?? bookingCancelKind(booking, assessedAt)
    : null;

  return {
    termsVersion,
    termsText,
    policy: policy === "full_refund" || policy === "store_credit" || policy === "no_refund" ? policy : null,
    timingBasis: policy ? cancellationTimingBasis(policy, termsVersion) ?? null : null,
    assessedAt,
    decisionPending: !!booking?.cancellationDecision,
  };
}
