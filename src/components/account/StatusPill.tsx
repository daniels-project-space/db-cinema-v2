"use client";

import { statusMeta } from "@/lib/bookingDisplay";
import { rentalStageLabel, type VerificationBooking } from "../../../shared/rentalReadiness";

export function StatusPill({ status, booking, className = "" }: { status: string; booking?: VerificationBooking; className?: string }) {
  const label = booking ? rentalStageLabel(booking) : statusMeta(status).label;
  const m = statusMeta(status === "confirmed" && label !== "Verification approved" ? "awaiting_verification" : status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${m.pill} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} ${status === "active" ? "pulse-live" : ""}`} aria-hidden />
      {label}
    </span>
  );
}
