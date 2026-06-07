"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { getSessionId } from "@/lib/session";

/** Fire a first-party pageview on every route change. */
export function AnalyticsTracker() {
  const track = useMutation(api.analytics.track);
  const path = usePathname();
  useEffect(() => {
    track({ type: "view", path, sessionId: getSessionId() }).catch(() => {});
  }, [path, track]);
  return null;
}
