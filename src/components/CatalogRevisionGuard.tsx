"use client";

import { type ReactNode } from "react";
import { useCatalogRevisionRefresh } from "./useCatalogRevisionRefresh";

export function CatalogRevisionGuard({ revision, children }: { revision: string; children: ReactNode }) {
  const { stale, refresh } = useCatalogRevisionRefresh(revision);
  return <>{stale && <p role="status" style={{ position: "fixed", bottom: 16, right: 16, zIndex: 50 }} className="rounded-xl border border-white/15 bg-charcoal-900 p-3 text-sm text-white/80">The catalogue changed. Refreshing current equipment… <button type="button" onClick={refresh} className="underline">Retry</button></p>}<div aria-hidden={stale} inert={stale} style={{ visibility: stale ? "hidden" : undefined }}>{children}</div></>;
}
