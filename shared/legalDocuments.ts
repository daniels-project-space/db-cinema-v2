import assessment from "./legal-history/2026-10-v15";
import cancellationProtection from "./legal-history/2026-10-v16";
import currentAssessment from "./legal-history/2026-11-v17";
import currentCancellationProtection from "./legal-history/2026-11-v18";
import currentCardHold from "./legal-history/2026-11-v19";
import currentSetupIntent from "./legal-history/2026-11-v20";
import currentCancellationTerms from "./legal-history/2026-11-v21";
import currentImmediateClaimTerms from "./legal-history/2026-11-v22";
import currentSevenDayBoundaryTerms from "./legal-history/2026-11-v23";
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
// Implementation review gate, not an asserted policy condition. See the review
// matrix. An environment toggle or manual verification cannot certify review.
export const RENTAL_DRAFT_RELEASE_READY = false;
