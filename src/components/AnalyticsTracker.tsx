"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { getSessionId } from "@/lib/session";
import { isExcludedAnalyticsEvent } from "../../shared/analyticsTraffic";

/** Fire a first-party pageview on every route change. */
export function AnalyticsTracker() {
  const track = useMutation(api.analytics.track);
  const path = usePathname();
  useEffect(() => {
    const sessionId = getSessionId();
    if (isExcludedAnalyticsEvent({ path, sessionId })) return;
    track({ type: "view", path, sessionId }).catch(() => {});
  }, [path, track]);
  return null;
}
