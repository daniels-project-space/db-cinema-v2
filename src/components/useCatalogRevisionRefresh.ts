"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@cvx/_generated/api";

export function useCatalogRevisionRefresh(revision?: string | null) {
  const current = useQuery(api.catalog.publicRevision, revision !== undefined ? {} : "skip");
  const router = useRouter();
  const stale = revision !== undefined && current !== undefined && current !== revision;
  const refresh = useCallback(() => router.refresh(), [router]);
  const attempted = useRef("");
  const lastAttemptAt = useRef(0);
  useEffect(() => {
    if (!stale) { attempted.current = ""; return; }
    const key = JSON.stringify([revision, current]);
    if (attempted.current === key) return;
    const delay = Math.max(500, lastAttemptAt.current + 5000 - Date.now());
    const timer = window.setTimeout(() => { attempted.current = key; lastAttemptAt.current = Date.now(); refresh(); }, delay);
    return () => window.clearTimeout(timer);
  }, [current, revision, stale, refresh]);
  return { stale, refresh };
}
