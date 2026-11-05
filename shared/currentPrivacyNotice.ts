import { LEGAL_DOCS, type LegalDoc } from "./legalDocuments";

export const CURRENT_PRIVACY_NOTICE_VERSION = "2026-11-05";

export const CURRENT_PRIVACY_NOTICE: LegalDoc = {
  ...LEGAL_DOCS.privacy,
  updated: "November 2026",
  sections: LEGAL_DOCS.privacy.sections.map((section) => {
    if (section.h === "1. What we collect") return {
      ...section,
      p: "We collect contact, booking, billing and delivery details, acceptance records, payment and hold references, and verification results. Didit processes identity, selfie or liveness, and proof-of-address submissions. We keep private copies of identity and proof-of-address documents and verification images, including selfie and face-match images, in file storage for verification, rental security and potential claims. Stripe processes payments; we do not store your full card number.",
    };
    if (section.h === "5. Retention") return {
      ...section,
      p: "We keep verification documents while a related rental is active and for at least 90 days after the last related rental is returned or cancelled, regardless of the provider's document-expiry date. If a damage or insurance case is open, we keep the relevant documents until the case is closed and for at least 90 days afterwards. A documented legal or retention hold may keep them longer. If a closure date has not been recorded, the documents remain available until it is clarified. Other booking records are kept only as long as necessary for their legal, accounting and operational purposes.",
    };
    return { ...section };
  }),
};
