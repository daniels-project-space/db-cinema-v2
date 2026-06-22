"use client";

import Link from "next/link";
import { SmartImage } from "@/components/SmartImage";
import { IdVerify } from "@/components/IdVerify";
import { money } from "@/lib/pricing";
import { BookingReview } from "@/components/account/BookingReview";
import { StatusPill } from "@/components/account/StatusPill";
import { CancelButton } from "@/components/account/CancelButton";
import {
  type EnrichedBooking,
  groupOf,
  fmtRange,
  rentalDays,
  countdown,
} from "@/lib/bookingDisplay";

export function BookingTile({ booking, token }: { booking: EnrichedBooking; token: string }) {
  const now = Date.now();
  const group = groupOf(booking);
  const first = booking.lineItems[0];
  const extra = booking.lineItems.length - 1;
  const start = booking.start ?? first?.start ?? null;
  const end = booking.end ?? first?.end ?? null;
  const days = start != null && end != null ? rentalDays(start, end) : null;
  const showVerify = group === "pending" || group === "upcoming" || group === "active";

  function openChat() {
    document.getElementById("renter-chat")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="spot gradient-border rounded-2xl p-3 sm:p-4">
      <div className="flex gap-3 sm:gap-4">
        {/* thumbnail — small, fixed, contained (no stretch, no overlap) */}
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl sm:h-24 sm:w-24">
          <SmartImage src={first?.heroImage ?? null} alt={first?.title ?? "Rental"} className="h-full w-full" />
          {extra > 0 && (
            <span className="absolute bottom-1 left-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur">
              +{extra}
            </span>
          )}
        </div>

        {/* content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill status={booking.status} />
              {(group === "upcoming" || group === "active") && start != null && (
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/55">
                  {group === "active" ? "due back " : ""}
                  {group === "active" && end != null ? countdown(end, now) : countdown(start, now)}
                </span>
              )}
            </div>
            <div className="shrink-0 font-display text-base font-bold leading-none text-white/90">£{money(booking.total)}</div>
          </div>

          <h3 className="mt-1.5 truncate font-display text-sm font-semibold text-white/90">
            {first?.title ?? "Rental"}
            {extra > 0 && <span className="ml-1 font-normal text-white/40">+{extra} more</span>}
          </h3>

          {start != null && end != null && (
            <div className="text-xs text-white/55">
              {fmtRange(start, end)}
              {days != null && <span className="text-white/35"> · {days} day{days > 1 ? "s" : ""}</span>}
            </div>
          )}

          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/45">
            {(booking.pickupTime || booking.returnTime) && (
              <span>
                {booking.pickupTime ? `Pickup ${booking.pickupTime}` : ""}
                {booking.pickupTime && booking.returnTime ? " · " : ""}
                {booking.returnTime ? `Return ${booking.returnTime}` : ""}
              </span>
            )}
            <span>{booking.fulfilment === "delivery" ? `Delivery${booking.address ? ` · ${booking.address}` : ""}` : "Collection · Central London"}</span>
            {booking.depositAmount > 0 && (
              <span>Deposit £{money(booking.depositAmount)}{booking.depositRefunded ? " · refunded" : " · refundable"}</span>
            )}
          </div>
        </div>
      </div>

      {/* multi-item breakdown (chips) */}
      {extra > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] text-white/50">
          {booking.lineItems.map((li, i) => (
            <li key={i} className="rounded-full bg-white/[0.05] px-2 py-0.5">
              {li.qty > 1 ? `${li.qty}× ` : ""}{li.title}
            </li>
          ))}
        </ul>
      )}

      {showVerify && (
        <div className="mt-2.5">
          <IdVerify bookingId={booking._id} status={booking.idVerifyStatus} compact />
        </div>
      )}

      {/* actions */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-2.5">
        <CancelButton booking={booking} />
        {booking.firstSlug && (
          <Link href={`/gear/${booking.firstSlug}`} className="text-xs font-medium text-white/55 hover:text-white">
            Rent again
          </Link>
        )}
        <button onClick={openChat} className="text-xs font-medium text-white/55 hover:text-white">
          Chat about this
        </button>
        {["confirmed", "active", "returned"].includes(booking.status) && token && token !== "preview" && (
          <a
            href={`/api/invoice/${booking._id}?token=${encodeURIComponent(token)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-white/55 hover:text-white"
          >
            Invoice (PDF)
          </a>
        )}
        {group === "past" && booking.status === "returned" && (
          <BookingReview bookingId={booking._id} reviewed={booking.reviewed} token={token} />
        )}
      </div>
    </div>
  );
}
