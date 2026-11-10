import { LEGAL_DOCS, type LegalDoc } from "./legalDocuments";
import { CURRENT_PRIVACY_NOTICE_VERSION } from "./privacyNoticeVersion";

export { CURRENT_PRIVACY_NOTICE_VERSION };

export const CURRENT_PRIVACY_NOTICE: LegalDoc = {
  ...LEGAL_DOCS.privacy,
  updated: "November 2026",
  sections: LEGAL_DOCS.privacy.sections.map((section) => {
    if (section.h === "1. What we collect") return {
      ...section,
      p: "We collect contact, booking, billing and delivery details, acceptance records, payment and hold references, and verification results. Didit processes identity, selfie or liveness, and proof-of-address submissions. We keep private copies of identity and proof-of-address documents and verification images, including selfie and face-match images, in file storage for verification, rental security and potential claims. If you separately opt in, and have not added a profile photo, our team may privately view your approved verification selfie beside your account after 24 hours. This optional use is not needed to rent, is never published, and you can withdraw permission in Account Security. The selfie stays subject to the verification-document retention rules below. Stripe processes payments; we do not store your full card number.",
    };
    if (section.h === "5. Retention") return {
      ...section,
      p: "We keep verification documents while any linked rental is active. After the last linked rental is returned or cancelled, we normally delete the copies after 90 days. If a related damage or insurance case is open, we keep them until it closes, then delete them after 90 days. A documented legal hold, a separate retention hold, or dates that need checking can pause deletion. Other booking records are kept only as long as needed for legal, accounting and operational purposes.",
    };
    return { ...section };
  }),
};
