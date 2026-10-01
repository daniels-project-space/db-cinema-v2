"use client";

import Link from "next/link";
import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SmartImage } from "@/components/SmartImage";
import { IdVerify } from "@/components/IdVerify";
import { formatGbp } from "@/lib/pricing";
import { BookingReview } from "@/components/account/BookingReview";
import { rentalTitle } from "@/lib/rentalPresentation";
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
  const extra = booking.lineItems.length - 1;
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
      : "Collection · Central London") +
    (booking.pickupTime || booking.returnTime
      ? ` · ${booking.pickupTime ? `pickup ${booking.pickupTime}` : ""}${booking.pickupTime && booking.returnTime ? " / " : ""}${booking.returnTime ? `return ${booking.returnTime}` : ""}`
      : "");

  return (
    <div className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[#131313] p-5">

      <RentalAdditionApproval token={token} bookingId={booking._id}/>

      {/* header */}
      <div className="mt-3 flex items-start gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl sm:h-24 sm:w-24">
          <SmartImage src={first?.heroImage ?? null} fallbackSources={first?.imageSources} alt={first?.title ?? "Rental"} className="h-full w-full" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate font-display text-sm font-semibold text-white/90">
              {rentalTitle(first?.title ?? "Rental")}
              {extra > 0 && <span className="font-normal text-white/40"> +{extra}</span>}
            </h3>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-display text-sm font-bold text-white/90">{formatGbp(booking.total)}</span>
              {isPending && (
                <button
                  onClick={abort}
                  disabled={busy}
                  aria-label="Cancel unpaid booking"
                  title="Cancel checkout"
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.06] text-xs text-white/50 hover:bg-rose-500/20 hover:text-rose-300"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/45">
            <StatusPill status={booking.status} />
            {(group === "upcoming" || group === "active") && start != null && (
              <span className="text-white/50">
                {group === "active" && end != null ? `back ${countdown(end, now)}` : countdown(start, now)}
              </span>
            )}
            {start != null && end != null && (
              <span>
                {fmtRange(start, end)}
                {days != null ? ` · ${days}d` : ""}
              </span>
            )}
          </div>
        </div>
      </div>
      {err && <div className="mt-1 text-[11px] text-rose-300">{err}</div>}

      {showVerify && (
        <div className="mt-2">
          <IdVerify bookingId={booking._id} status={booking.idVerifyStatus} note={booking.verificationNote} compact />
        </div>
      )}
      {token && token !== "preview" && <HoldRenewal bookingId={booking._id} token={token} status={booking.depositHoldRenewalStatus} expiresAt={booking.depositHoldExpiresAt} />}
      {token && token !== "preview" && <LateFeeApproval bookingId={booking._id} token={token} status={booking.lateFeeStatus} amount={booking.lateFeeAmount} />}

      <div className="mt-5 flex items-center gap-3">
        <button onClick={chat} className="rounded-full bg-accent-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-400">Open conversation</button>
        <span className="text-xs text-white/35">Gaffer &amp; the team</span>
      </div>
      <details className="mt-4 border-t border-white/[0.06] pt-3">
        <summary className="cursor-pointer text-xs font-medium text-white/55 hover:text-white">Rental details &amp; actions</summary>
        <div className="mt-4"><BookingProgress booking={booking}/></div>
      {/* slim item list */}
      <ul className="mt-2.5 divide-y divide-white/[0.04] overflow-hidden rounded-lg bg-white/[0.02] text-xs">
        {booking.lineItems.map((li, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
            <span className="min-w-0 truncate text-white/65">
              {li.qty > 1 ? `${li.qty}× ` : ""}
              {li.title}
            </span>
            <span className="shrink-0 text-white/40">{formatGbp(li.lineTotal)}</span>
          </li>
        ))}
      </ul>

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
      <div className="mt-1 truncate text-[11px] text-white/35">{logistics}</div>

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
        {booking.firstSlug && (
          <Link href={`/gear/${booking.firstSlug}`} className="font-medium text-white/55 hover:text-white">
            Rent again
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
    </div>
  );
}
