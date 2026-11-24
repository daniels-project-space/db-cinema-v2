import assessment from "./legal-history/2026-10-v15";
import cancellationProtection from "./legal-history/2026-10-v16";
import currentAssessment from "./legal-history/2026-11-v17";
import currentCancellationProtection from "./legal-history/2026-11-v18";
import currentCardHold from "./legal-history/2026-11-v19";
import currentSetupIntent from "./legal-history/2026-11-v20";
import currentCancellationTerms from "./legal-history/2026-11-v21";
import currentImmediateClaimTerms from "./legal-history/2026-11-v22";
import currentSevenDayBoundaryTerms from "./legal-history/2026-11-v23";
import currentCompanyCancellationTerms from "./legal-history/2026-11-v24";
import currentBookingConfirmationTerms from "./legal-history/2026-11-v25";
import currentFutureClaimTerms from "./legal-history/2026-11-v26";
import currentCancellationBoundaryTerms from "./legal-history/2026-11-v27";
import currentStrict48HourBoundaryTerms from "./legal-history/2026-11-v28";
import currentCancellationClockTerms from "./legal-history/2026-11-v29";
import currentInclusive48HourCancellationTerms from "./legal-history/2026-11-v30";
import currentVerificationTimingTerms from "./legal-history/2026-11-v31";
import currentVerificationCutoffTerms from "./legal-history/2026-11-v32";
import currentCancellationWindowTerms from "./legal-history/2026-11-v33";
import currentCancellationCutoffTerms from "./legal-history/2026-11-v34";
import privacyNoticeV2 from "./legal-history/privacy-2026-11-10-v2";
import refundable from './legal-history/2026-10-v14';
import current from "./legal-history/2026-10-v13";
import v12 from "./legal-history/2026-10-v12";
import v11 from "./legal-history/2026-10-v11";
import v10 from "./legal-history/2026-10-v10";
import previous from "./legal-history/2026-10-v9";
import earlier from "./legal-history/2026-10-v8";
export type LegalDoc = { title: string; updated: string; sections: { h: string; p: string }[] };
export const LEGAL_DOCS: Record<string, LegalDoc> = current;
export const LEGAL_ARCHIVE: Record<string, Record<string, LegalDoc>> = {
  "2026-11-credit-funding-v2": { "credit-funding": { title: "Account Credit Terms", updated: "November 2026", sections: [{ h: "Using account credit", p: "For this booking, eligible earned and refund account credit can pay the remaining rental or delivery balance after the applicable price benefit. Credit cannot pay membership fees or separately payable rental security. First-month membership credit is limited to the remaining rental charge. Existing credit expiry dates and statutory rights still apply. This term replaces any statement in the other agreements for this booking that earned or promotional account credit cannot be used with a rental discount; all other terms remain unchanged." }] } },
  "2026-11-referrals-v3": { referrals: { ...currentCancellationBoundaryTerms.referrals, sections: currentCancellationBoundaryTerms.referrals.sections.map(section => section.h === "No stacking and rental security" ? { ...section, p: "Only one price benefit applies: referral, promo, Encore, membership weekend or delivery saving. The once-only joining credit may also apply. Eligible account credit can pay the remaining rental or delivery balance after the price benefit; it cannot pay membership fees or separately payable rental security. Referral offers do not waive verification or change the security terms shown in the final rental quote." } : section) } },
  "2026-11-v28":currentStrict48HourBoundaryTerms,
  "2026-11-v29":currentCancellationClockTerms,
  "2026-11-v30":currentInclusive48HourCancellationTerms,
  "2026-11-v31":currentVerificationTimingTerms,
  "2026-11-v32":currentVerificationCutoffTerms,
  "2026-11-v33":currentCancellationWindowTerms,
  "2026-11-v34":currentCancellationCutoffTerms,
  "2026-11-v27":currentCancellationBoundaryTerms,
  "2026-11-v26":currentFutureClaimTerms,
  "2026-11-v25":currentBookingConfirmationTerms,
  "2026-11-10-v2": { privacy: privacyNoticeV2 },
  "2026-11-v24":currentCompanyCancellationTerms,
  "2026-11-v23":currentSevenDayBoundaryTerms,
  "2026-11-v22":currentImmediateClaimTerms,
  "2026-11-v21":currentCancellationTerms,
  "2026-11-v20":currentSetupIntent,
  "2026-11-v19":currentCardHold,
  "2026-11-v18":currentCancellationProtection,
  "2026-11-v17":currentAssessment,
  "2026-10-v16":cancellationProtection,
  "2026-10-v15":assessment, "2026-10-v14": refundable, "2026-10-v8": earlier, "2026-10-v9": previous, "2026-10-v10": v10, "2026-10-v11": v11, "2026-10-v12": v12, "2026-10-v13": current,
};
export { RENTAL_DRAFT_RELEASE_READY } from "./rentalAgreementRelease";
