"use client";

import { statusMeta } from "@/lib/bookingDisplay";

export function StatusPill({ status, className = "" }: { status: string; className?: string }) {
  const m = statusMeta(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${m.pill} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} ${status === "active" ? "pulse-live" : ""}`} aria-hidden />
      {m.label}
    </span>
  );
}
