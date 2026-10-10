"use client";
import { useEffect, useState } from "react";
import { rentalHasStarted, rentalStartsAt } from "@/lib/cancellationPolicy";
import Link from "next/link";
import type { EnrichedBooking } from "@/lib/bookingDisplay";

/** Cancellation is reviewed in the scoped conversation before any execution. */
export function CancelButton({ booking }: { booking: EnrichedBooking }) {
  const [now, setNow] = useState(Date.now);
  const start = rentalStartsAt(booking);
  useEffect(() => {
    if (start === null || start <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(start - Date.now() + 1, 2147483647));
    return () => clearTimeout(timer);
  }, [start, now]);
  if (rentalHasStarted(booking, now)) return null;
  if (!["confirmed", "pending_payment"].includes(booking.status)) return null;
  return <Link href={`/account?rental=${encodeURIComponent(booking._id)}#chat`} onClick={() => window.dispatchEvent(new CustomEvent("dbc:open-rental-chat", { detail: { bookingId: booking._id } }))} className="text-xs font-medium text-rose-300/70 hover:text-rose-300">Cancellation options</Link>;
}
