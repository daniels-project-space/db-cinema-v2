import current from "./legal-history/2026-10-v13";
import v12 from "./legal-history/2026-10-v12";
import v11 from "./legal-history/2026-10-v11";
import v10 from "./legal-history/2026-10-v10";
import previous from "./legal-history/2026-10-v9";
import earlier from "./legal-history/2026-10-v8";
export type LegalDoc = { title: string; updated: string; sections: { h: string; p: string }[] };
export const LEGAL_DOCS: Record<string, LegalDoc> = current;
export const LEGAL_ARCHIVE: Record<string, Record<string, LegalDoc>> = {
  "2026-10-v8": earlier, "2026-10-v9": previous, "2026-10-v10": v10, "2026-10-v11": v11, "2026-10-v12": v12, "2026-10-v13": current,
};
// Implementation review gate, not an asserted policy condition. See the review
// matrix. An environment toggle or manual verification cannot certify review.
export const RENTAL_DRAFT_RELEASE_READY = false;
