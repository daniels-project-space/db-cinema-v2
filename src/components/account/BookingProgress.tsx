"use client";

import { Fragment } from "react";
import { bookingSteps } from "@/lib/bookingDisplay";

/** Rental progress bar, including a separate card hold for new bookings. */
export function BookingProgress({ booking, detailed = false }: { booking: { status: string; idVerifyStatus: string; depositHoldAmount?: number; depositHoldStatus?: string | null; requiresDroneLicence?: boolean; droneLicenceStatus?: string }; detailed?: boolean }) {
  const { cancelled, steps } = bookingSteps(booking);
  if (cancelled) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-300/80">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> Cancelled
      </div>
    );
  }
  const current = steps.find((s) => s.state === "current");
  if (detailed) return (
    <ol aria-label="Rental progress" className="grid gap-3 sm:flex sm:gap-0">
      {steps.map((step, index) => <li key={step.label} aria-current={step.state === "current" ? "step" : undefined} className="relative flex min-w-0 items-center gap-3 sm:block sm:flex-1 sm:pr-3">
        {index < steps.length - 1 && <div aria-hidden="true" className={`absolute left-7 right-0 top-3 hidden h-px sm:block ${steps[index + 1].state === "todo" ? "bg-white/15" : "bg-accent-400/60"}`} />}
        <span aria-hidden="true" className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] ${step.state === "done" ? "border-accent-400 bg-accent-500 text-white" : step.state === "current" ? "border-accent-400 bg-[#201a17] text-accent-300 ring-2 ring-accent-400/20" : "border-white/20 bg-[#171717] text-white/40"}`}>{step.state === "done" ? "✓" : index + 1}</span>
        <span className={`block text-xs leading-5 sm:mt-3 ${step.state === "current" ? "text-accent-300" : step.state === "done" ? "text-white/80" : "text-white/40"}`}>{step.label}<span className="sr-only"> · {step.state === "done" ? "Completed" : step.state === "current" ? "Current step" : "Upcoming"}</span></span>
      </li>)}
    </ol>
  );
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex flex-1 items-center">
        {steps.map((s, i) => (
          <Fragment key={i}>
            {i > 0 && <div className={`h-px flex-1 ${s.state === "todo" ? "bg-white/10" : "bg-accent-400/60"}`} />}
            <span
              title={s.label}
              className={`h-2 w-2 shrink-0 rounded-full ${
                s.state === "done"
                  ? "bg-accent-400"
                  : s.state === "current"
                    ? "bg-accent-400 ring-2 ring-accent-400/30"
                    : "bg-white/15"
              }`}
            />
          </Fragment>
        ))}
      </div>
      {current && <span className="shrink-0 text-[11px] font-medium text-accent-300/90">{current.label}</span>}
    </div>
  );
}
