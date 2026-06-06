"use client";

import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function HomeStats() {
  const stats = useQuery(api.reviews.stats);
  if (!stats || stats.count === 0) return null;
  return (
    <div className="mt-5 flex items-center justify-center gap-3 text-sm text-white/50">
      <span className="text-accent-400">★★★★★</span>
      <span className="font-semibold text-white/80">{stats.average.toFixed(2)}</span>
      <span className="text-white/30">·</span>
      <span>{stats.count} verified reviews</span>
    </div>
  );
}
