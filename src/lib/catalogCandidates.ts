import type { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";

const LEGACY_CATALOGUE_LIMIT = 500;

function isMissingConvexFunction(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /BadConvexFunctionIdentifier|Could not find (?:public )?function|No public function named/i.test(message);
}

export type TypeListingLoader = (types: string[]) => Promise<any[]>;

/**
 * Load bookable-catalogue candidates through the indexed backend query. Older
 * production deployments may not have that function yet; during rollout, use
 * the bounded public list endpoint and filter locally. Never return a partial
 * list when the legacy endpoint reaches its 500-row cap.
 */
export function createTypeListingLoader(c: ConvexHttpClient): TypeListingLoader {
  let legacyCatalogue: Promise<any[]> | undefined;
  const loadLegacyCatalogue = () => legacyCatalogue ??= (async () => {
    const rows: any[] = await c.query(api.catalog.listListings, { limit: LEGACY_CATALOGUE_LIMIT + 1 });
    if (!Array.isArray(rows) || rows.length > LEGACY_CATALOGUE_LIMIT) {
      throw new Error("The legacy catalogue exceeds the safe candidate limit; refusing an incomplete result.");
    }
    return rows;
  })();

  return async (types: string[]) => {
    const requestedTypes = [...new Set(types)].filter(type => /^[a-z-]{1,40}$/.test(type));
    if (!requestedTypes.length) return [];
    try {
      return await c.query(api.catalog.byItemType, { types: requestedTypes });
    } catch (error) {
      if (!isMissingConvexFunction(error)) throw error;
      const rows = await loadLegacyCatalogue();
      return rows.filter(row => requestedTypes.includes(String(row?.itemType ?? "")));
    }
  };
}
