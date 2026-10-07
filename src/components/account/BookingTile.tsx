"use client";

import Link from "next/link";
import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalKit } from "@/components/rentals/RentalKit";
import { VerificationLink } from "@/components/rentals/VerificationProgress";
import { formatGbp } from "@/lib/pricing";
import { BookingReview } from "@/components/account/BookingReview";
import { StatusPill } from "@/components/account/StatusPill";
import { CancelButton } from "@/components/account/CancelButton";
import { BookingProgress } from "@/components/account/BookingProgress";
import { HoldRenewal } from "@/components/account/HoldRenewal";
import { RentalAdditionApproval } from "@/components/rentals/RentalAdditionApproval";
import { LateFeeApproval } from "@/components/account/LateFeeApproval";
import { type EnrichedBooking, groupOf, fmtRange, rentalDays, countdown } from "@/lib/bookingDisplay";

export function BookingTile({
  booking,
  token,
  onOpenChat,
}: {
  booking: EnrichedBooking;
  token: string;
  onOpenChat?: (bookingId?: string) => void;
}) {
  const now = Date.now();
  const group = groupOf(booking);
  const first = booking.lineItems[0];
  const isHistory = group === "past";
  const start = booking.start ?? first?.start ?? null;
  const end = booking.end ?? first?.end ?? null;
  const days = start != null && end != null ? rentalDays(start, end) : null;
  const showVerify = booking.status !== "pending_payment" && (group === "upcoming" || group === "active");
  const tip = booking.lineItems.find((li) => li.tip)?.tip ?? null;
  const isPending = booking.status === "pending_payment";

  const del = useAction(api.checkout.cancelUnpaidByCustomer);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function chat() {
    if (onOpenChat) onOpenChat(booking._id);
    else document.getElementById("renter-chat")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function abort() {
    setBusy(true);
    setErr(null);
    try {
      await del({ token, bookingId: booking._id as any });
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't remove");
      setBusy(false);
    }
  }

  const logistics =
    (booking.fulfilment === "delivery"
      ? `Delivery${booking.address ? ` · ${booking.address}` : ""}`
      : "Collection") +
    (booking.pickupTime || booking.returnTime
      ? ` · ${booking.pickupTime ? `pickup ${booking.pickupTime}` : ""}${booking.pickupTime && booking.returnTime ? " / " : ""}${booking.returnTime ? `return ${booking.returnTime}` : ""}`
      : "");

  return (
    <article className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[#131313] p-5 sm:p-6">

      {showVerify && <VerificationLink booking={booking} />}
      <RentalAdditionApproval token={token} bookingId={booking._id}/>

      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div>
          <StatusPill status={booking.status} />
          {start != null && end != null && <h3 className="mt-3 font-display text-sm font-semibold text-white/90">{fmtRange(start, end)}</h3>}
          <p className="mt-1 text-xs text-white/40">{isHistory && start != null ? new Date(start).getUTCFullYear() : days != null ? `${days} ${days === 1 ? "day" : "days"}` : "Dates to be confirmed"}
            {!isHistory && !isPending && start != null && <span className="ml-2 text-accent-300">{group === "active" && end != null ? `Return ${countdown(end, now)}` : countdown(start, now)}</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-semibold text-white/90">{formatGbp(booking.total)}</p>
          <p className="mt-1 text-[10px] text-white/35">{isPending ? "Awaiting payment" : "Rental total"}</p>
        </div>
      </header>
      <div className="mt-5"><RentalKit items={booking.lineItems} compact={isHistory} prices /></div>
      {err && <div className="mt-1 text-[11px] text-rose-300">{err}</div>}

      {token && token !== "preview" && <HoldRenewal bookingId={booking._id} token={token} status={booking.depositHoldRenewalStatus} expiresAt={booking.depositHoldExpiresAt} />}
      {token && token !== "preview" && <LateFeeApproval bookingId={booking._id} token={token} status={booking.lateFeeStatus} amount={booking.lateFeeAmount} />}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
        <button onClick={chat} className={`${isHistory ? "text-white/65 hover:text-white" : "rounded-full bg-accent-500 px-5 py-2.5 text-white hover:bg-accent-400"} text-xs font-medium`}>{isHistory ? "Conversation ↗" : "Open conversation"}</button>
        {isHistory && <Link href={`/plan?booking=${booking._id}`} className="rounded-full bg-white/[0.06] px-4 py-2 text-xs text-white/75 hover:bg-white/10">Rent this kit again ↗</Link>}
        {isPending && <button onClick={abort} disabled={busy} className="text-xs text-white/40 hover:text-rose-300 disabled:opacity-30">{busy ? "Removing…" : "Remove draft"}</button>}
      </div>
      <details className="mt-4 border-t border-white/[0.06] pt-3">
        <summary className="cursor-pointer text-xs font-medium text-white/55 hover:text-white">Rental details &amp; actions</summary>
        <div className="mt-4"><BookingProgress booking={booking}/></div>
      {/* price breakdown */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-white/40">
        {booking.subtotal != null && <span>Subtotal {formatGbp(booking.subtotal)}</span>}
        {(booking.discount ?? 0) > 0 && <span className="text-emerald-300/70">−{formatGbp(booking.discount!)}</span>}
        {(booking.creditApplied ?? 0) > 0 && <span className="text-amber-300/70">Credit −{formatGbp(booking.creditApplied!)}</span>}
        {(booking.deliveryFee ?? 0) > 0 && <span>Delivery {formatGbp(booking.deliveryFee!)}</span>}
        {booking.depositAmount > 0 && (
          <span>
            Refundable security payment {formatGbp(booking.depositAmount)}
            {booking.depositRefunded ? " ↩" : ""}
          </span>
        )}
        {(booking.depositHoldAmount ?? 0) > 0 && <span>Separate card hold {formatGbp(booking.depositHoldAmount!)} · {booking.depositHoldStatus ?? "pending"}</span>}
        {(booking.lateFeeAmount ?? 0) > 0 && <span className="text-amber-200">Separate late charge {formatGbp(booking.lateFeeAmount!)} · {booking.lateFeeStatus}</span>}
        <span className="font-semibold text-white/70">Total {formatGbp(booking.total)}</span>
      </div>

      {/* logistics */}
      {!isPending && <div className="mt-3 text-xs leading-5 text-white/45">{logistics}</div>}

      {/* useful tip for this listing */}
      {tip && (
        <div className="mt-2 flex gap-1.5 rounded-lg bg-accent-400/[0.06] px-2.5 py-1.5 text-[11px] leading-snug text-white/55">
          <span className="shrink-0 font-medium text-accent-300">Tip</span>
          <span className="min-w-0">{tip}</span>
        </div>
      )}

      {/* actions */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/[0.06] pt-2.5 text-xs">
        <CancelButton booking={booking} />
        <button onClick={chat} className="font-medium text-white/55 hover:text-white">Request a change</button>
        {booking.lineItems.length > 0 && (
          <Link href={`/plan?booking=${booking._id}`} className="font-medium text-white/55 hover:text-white">
            Rent this kit again
          </Link>
        )}
        <button onClick={chat} className="font-medium text-white/55 hover:text-white">
          Chat
        </button>
        {["confirmed", "active", "returned"].includes(booking.status) && token && token !== "preview" && (
          <a
            href={`/api/invoice/${booking._id}?token=${encodeURIComponent(token)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-white/55 hover:text-white"
          >
            Receipt
          </a>
        )}
        {booking.hasReturnStatement && token && token !== "preview" && (
          <a href={`/api/invoice/${booking._id}?phase=return&token=${encodeURIComponent(token)}`}
            target="_blank" rel="noopener noreferrer" className="font-medium text-white/55 hover:text-white">Return statement</a>
        )}
        {["confirmed", "active"].includes(booking.status) && token && token !== "preview" && (
          <a
            href={`/api/booking-ics/${booking._id}?token=${encodeURIComponent(token)}`}
            className="font-medium text-white/55 hover:text-white"
          >
            Add to calendar
          </a>
        )}
        {group === "past" && booking.status === "returned" && (
          <BookingReview bookingId={booking._id} reviewed={booking.reviewed} token={token} />
        )}
      </div>
      </details>
    </article>
  );
}
