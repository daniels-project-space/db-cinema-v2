"use client";
import { rentalHandoverLabel } from "../../../shared/rentalHandover";
import { TRAFALGAR_PICKUP_ADDRESS, TRAFALGAR_PICKUP_INSTRUCTIONS } from "../../../shared/pickupLocation";

type HandoverLine = {
  start: number;
  end: number;
  pickupTime?: string | null;
  returnTime?: string | null;
};

type HandoverBooking = {
  fulfilment: "pickup" | "delivery";
  deliveryLegs?: "one_way" | "round_trip";
  address?: string;
  lineItems: HandoverLine[];
  pickupTime?: string | null;
  returnTime?: string | null;
};

const UK_POSTCODE = /\b(?:[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|GIR\s?0AA)\b/i;

function postcodeFromAddress(address: string) {
  return address.match(UK_POSTCODE)?.[0]?.replace(/\s+/g, " ").toUpperCase() ?? null;
}

function addressLines(address: string) {
  return address.split(/[\n,]+/).map(line => line.trim()).filter(Boolean);
}

export function AdminHandoverSummary({ booking }: { booking: HandoverBooking }) {
  const isDelivery = booking.fulfilment === "delivery";
  const address = booking.address?.trim() ?? "";
  const postcode = isDelivery && address ? postcodeFromAddress(address) : null;
  const lines = isDelivery && address ? addressLines(address) : [];

  return (
    <section
      aria-label="Pickup and delivery details"
      data-testid="admin-handover-summary"
      className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[.055] to-transparent"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.07] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-sky-200/15 bg-sky-200/[.06] text-sky-100/80" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h12v10H3zM15 10h3l3 3v4h-6z" />
              <circle cx="7.5" cy="18" r="1.5" />
              <circle cx="18" cy="18" r="1.5" />
              <path d="M6 10h5M6 13h3" />
            </svg>
          </span>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-white/85">Handover plan</h3>
            <p className="mt-0.5 text-[10px] text-white/45">{isDelivery ? "Delivery" : "In-person collection"}</p>
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${isDelivery ? "border-sky-200/20 bg-sky-200/[.06] text-sky-100/80" : "border-amber-100/20 bg-amber-100/[.05] text-amber-100/75"}`}>
          {isDelivery
            ? booking.deliveryLegs === "one_way" ? "One-way delivery" : booking.deliveryLegs === "round_trip" ? "Delivery + return collection" : "Delivery plan not recorded"
            : "Trafalgar Square"}
        </span>
      </div>

      {isDelivery ? (
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-[.16em] text-white/40">Delivery address</p>
            {lines.length ? (
              <address className="mt-1 not-italic text-xs leading-5 text-white/80">
                {lines.map((line, index) => <span key={`${index}-${line}`} className="block break-words">{line}</span>)}
              </address>
            ) : (
              <p role="status" className="mt-1 text-xs text-amber-100/70">Address not recorded · check with the renter before dispatch.</p>
            )}
          </div>
          <div className="sm:min-w-32 sm:text-right">
            <p className="text-[9px] font-medium uppercase tracking-[.16em] text-white/40">Postcode</p>
            <p className="mt-1 font-mono text-xs font-medium tracking-wide text-white/80" data-testid="admin-delivery-postcode">
              {postcode ?? "Not recorded"}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-[.16em] text-white/40">Collection address</p>
            <address className="mt-1 not-italic text-xs leading-5 text-white/80" data-testid="admin-pickup-address">{TRAFALGAR_PICKUP_ADDRESS.split(", ").map((line, index) => <span key={`${index}-${line}`} className="block break-words">{line}</span>)}</address>
          </div>
          <p className="text-xs leading-5 text-white/65 sm:max-w-56 sm:text-right" data-testid="admin-pickup-instructions">{TRAFALGAR_PICKUP_INSTRUCTIONS}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border-t border-white/[.07] bg-white/[.06]">
        <div className="min-w-0 bg-[#141414]/80 px-4 py-3">
          <p className="text-[9px] font-medium uppercase tracking-[.16em] text-white/40">{isDelivery ? "Delivery time" : "Collection time"}</p>
          <p className="mt-1 break-words text-xs font-medium text-white/80" data-testid="admin-handover-pickup-time">
            {rentalHandoverLabel(booking, "pickup")}
          </p>
        </div>
        <div className="min-w-0 bg-[#141414]/80 px-4 py-3">
          <p className="text-[9px] font-medium uppercase tracking-[.16em] text-white/40">{isDelivery && booking.deliveryLegs === "round_trip" ? "Return collection" : "Return time"}</p>
          <p className="mt-1 break-words text-xs font-medium text-white/80" data-testid="admin-handover-return-time">
            {isDelivery && booking.deliveryLegs === "one_way" ? `Return to ${TRAFALGAR_PICKUP_ADDRESS} · ${rentalHandoverLabel(booking, "return")}` : rentalHandoverLabel(booking, "return")}
          </p>
        </div>
      </div>
    </section>
  );
}
