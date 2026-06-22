"use client";

import { Fragment } from "react";
import { bookingSteps } from "@/lib/bookingDisplay";

/** Minimal 4-dot rental progress bar (Confirmed → ID → Picked up → Returned). */
export function BookingProgress({ booking }: { booking: { status: string; idVerifyStatus: string } }) {
  const { cancelled, steps } = bookingSteps(booking);
  if (cancelled) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-300/80">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> Cancelled
      </div>
    );
  }
  const current = steps.find((s) => s.state === "current");
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
