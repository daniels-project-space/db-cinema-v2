"use client";
import Link from "next/link";
import type { EnrichedBooking } from "@/lib/bookingDisplay";

/** Cancellation is reviewed in the scoped conversation before any execution. */
export function CancelButton({ booking }: { booking: EnrichedBooking }) {
  if (!["confirmed", "pending_payment"].includes(booking.status)) return null;
  return <Link href={`/account?rental=${encodeURIComponent(booking._id)}#chat`} onClick={() => window.dispatchEvent(new CustomEvent("dbc:open-rental-chat", { detail: { bookingId: booking._id } }))} className="text-xs font-medium text-rose-300/70 hover:text-rose-300">Cancellation options</Link>;
}
