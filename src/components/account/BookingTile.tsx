"use client";

import Link from "next/link";
import { SmartImage } from "@/components/SmartImage";
import { IdVerify } from "@/components/IdVerify";
import { money } from "@/lib/pricing";
import { BookingReview } from "@/components/account/BookingReview";
import { StatusPill } from "@/components/account/StatusPill";
import {
  type EnrichedBooking,
  groupOf,
  fmtRange,
  rentalDays,
  countdown,
} from "@/lib/bookingDisplay";

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-white/35">{label}</span>
      <span className="text-white/70">{value}</span>
    </span>
  );
}

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
    <div className="spot gradient-border overflow-hidden rounded-2xl">
      <div className="flex flex-col sm:flex-row">
        {/* hero */}
        <div className="relative w-full shrink-0 sm:w-44">
          <SmartImage
            src={first?.heroImage ?? null}
            alt={first?.title ?? "Rental"}
            className="aspect-[16/9] sm:aspect-[4/5] sm:h-full"
          />
          {extra > 0 && (
            <span className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white/90 backdrop-blur">
              +{extra} more item{extra > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* body */}
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={booking.status} />
              {(group === "upcoming" || group === "active") && start != null && (
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/55">
                  {group === "active" ? "due back " : ""}
                  {group === "active" && end != null ? countdown(end, now) : countdown(start, now)}
                </span>
              )}
            </div>
            <div className="text-right">
              <div className="font-display text-lg font-bold leading-none text-white/90">£{money(booking.total)}</div>
              <div className="mt-0.5 text-[11px] text-white/35">{booking.currency}</div>
            </div>
          </div>

          <div>
            <h3 className="font-display text-[15px] font-semibold leading-snug text-white/90">
              {first?.title ?? "Rental"}
              {extra > 0 && <span className="ml-1.5 text-sm font-normal text-white/40">+{extra} more</span>}
            </h3>
            {start != null && end != null && (
              <div className="mt-1 text-sm text-white/60">
                {fmtRange(start, end)}
                {days != null && <span className="text-white/35"> · {days} day{days > 1 ? "s" : ""}</span>}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {(booking.pickupTime || booking.returnTime) && (
              <Meta
                label="Times"
                value={`${booking.pickupTime ? `pickup ${booking.pickupTime}` : ""}${booking.pickupTime && booking.returnTime ? " · " : ""}${booking.returnTime ? `return ${booking.returnTime}` : ""}`}
              />
            )}
            <Meta
              label=""
              value={booking.fulfilment === "delivery" ? `Delivery${booking.address ? ` · ${booking.address}` : ""}` : "Collection · Central London"}
            />
            {booking.depositAmount > 0 && (
              <Meta
                label="Deposit"
                value={`£${money(booking.depositAmount)}${booking.depositRefunded ? " · refunded" : " · refundable"}`}
              />
            )}
          </div>

          {/* multi-item breakdown */}
          {extra > 0 && (
            <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-white/10 pl-3 text-[11px] text-white/45">
              {booking.lineItems.map((li, i) => (
                <li key={i} className="truncate">
                  {li.qty > 1 ? `${li.qty}× ` : ""}{li.title}
                </li>
              ))}
            </ul>
          )}

          {showVerify && (
            <div className="flex flex-wrap items-center gap-3">
              <IdVerify bookingId={booking._id} status={booking.idVerifyStatus} compact />
            </div>
          )}

          {/* actions */}
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3">
            {booking.firstSlug && (
              <Link href={`/gear/${booking.firstSlug}`} className="text-xs font-medium text-white/55 hover:text-white">
                Rent again
              </Link>
            )}
            <button onClick={openChat} className="text-xs font-medium text-white/55 hover:text-white">
              Chat about this
            </button>
            {group === "past" && booking.status === "returned" && (
              <BookingReview bookingId={booking._id} reviewed={booking.reviewed} token={token} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
