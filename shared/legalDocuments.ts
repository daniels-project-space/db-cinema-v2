import current from "./legal-history/2026-10-v9";
import previous from "./legal-history/2026-10-v8";
export type LegalDoc = { title: string; updated: string; sections: { h: string; p: string }[] };
export const LEGAL_DOCS: Record<string, LegalDoc> = current;
export const LEGAL_ARCHIVE: Record<string, Record<string, LegalDoc>> = {
  "2026-10-v8": previous, "2026-10-v9": current,
};
// Implementation review gate, not an asserted policy condition. See the review
// matrix. An environment toggle or manual verification cannot certify review.
export const RENTAL_DRAFT_RELEASE_READY = false;
