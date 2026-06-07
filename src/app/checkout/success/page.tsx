"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { useCart } from "@/components/cart/CartProvider";
import { IdVerify } from "@/components/IdVerify";
import { tierByKey } from "@/lib/membership";

function SuccessInner() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const finalize = useAction(api.checkout.finalize);
  const { clear } = useCart();

  const [state, setState] = useState<"working" | "paid" | "unpaid" | "error">(
    "working",
  );
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [membership, setMembership] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !sessionId) return;
    ran.current = true;
    finalize({ sessionId })
      .then((r) => {
        if (r.paid) {
          setBookingId(r.bookingId);
          setMembership((r as any).membership ?? null);
          setState("paid");
          if (!(r as any).membership) clear();
        } else {
          setState("unpaid");
        }
      })
      .catch(() => setState("error"));
  }, [sessionId, finalize, clear]);

  const booking = useQuery(
    api.bookings.get,
    bookingId ? { bookingId: bookingId as any } : "skip",
  );

  if (!sessionId)
    return <Msg title="No session" body="Missing checkout session." />;
  if (state === "working")
    return <Msg title="Confirming…" body="One moment." />;
  if (state === "unpaid")
    return (
      <Msg title="Payment not completed" body="Your card was not charged." cta />
    );
  if (state === "error")
    return <Msg title="Something went wrong" body="Please contact us." cta />;

  // membership subscription confirmation
  if (membership) {
    const t = tierByKey(membership);
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="text-5xl">🎟️</div>
        <h1 className="mt-4 font-display text-3xl font-bold text-white/90">
          Welcome to <span className="gradient-text">{t?.name ?? "membership"}</span>
        </h1>
        <p className="mt-2 text-white/40">
          {t ? `${t.pct}% off every rental` : "Your membership"} is now active
          {t?.freeDelivery ? " — plus free local delivery." : "."}
        </p>
        <Link
          href="/gear"
          className="mt-8 inline-block rounded-full bg-accent-500 px-7 py-3 font-medium text-white transition-colors hover:bg-accent-600"
        >
          Start saving
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <div className="text-5xl">🎬</div>
      <h1 className="mt-4 font-display text-3xl font-bold text-white/90">
        Booking <span className="gradient-text">confirmed</span>
      </h1>
      <p className="mt-2 text-white/40">
        A confirmation has been sent to {booking?.guestEmail ?? "your email"}.
      </p>

      {booking && (
        <div className="mx-auto mt-8 max-w-md rounded-2xl glass gradient-border p-5 text-left">
          {booking.lineItems.map((li, i) => (
            <div key={i} className="flex justify-between py-1 text-sm text-white/60">
              <span className="mr-2 line-clamp-1">{li.title}</span>
              <span>£{li.lineTotal}</span>
            </div>
          ))}
          <div className="mt-3 flex justify-between border-t border-white/5 pt-3 font-display font-bold text-white/90">
            <span>Paid</span>
            <span>£{booking.total}</span>
          </div>
          <div className="mt-1 text-right text-xs text-white/35">
            incl. £{booking.depositAmount} refundable deposit
          </div>
        </div>
      )}

      {booking && (
        <div className="mx-auto mt-6 max-w-md text-left">
          {booking.idVerifyStatus === "verified" ? (
            <IdVerify bookingId={booking._id} status="verified" />
          ) : (
            <>
              <p className="mb-2 text-sm text-white/50">
                One last step before handover — verify your identity:
              </p>
              <IdVerify bookingId={booking._id} status={booking.idVerifyStatus} />
            </>
          )}
        </div>
      )}

      <Link
        href="/gear"
        className="mt-8 inline-block rounded-full bg-accent-500 px-7 py-3 font-medium text-white transition-colors hover:bg-accent-600"
      >
        Rent more gear
      </Link>
    </div>
  );
}

function Msg({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: boolean;
}) {
  return (
    <div className="mx-auto max-w-xl px-6 py-20 text-center">
      <h1 className="font-display text-2xl font-bold text-white/90">{title}</h1>
      <p className="mt-2 text-white/40">{body}</p>
      {cta && (
        <Link
          href="/cart"
          className="mt-6 inline-block text-accent-400 hover:underline"
        >
          Back to kit
        </Link>
      )}
    </div>
  );
}

export default function SuccessPage() {
  return (
    <>
      <SiteHeader />
      <main className="section-window min-h-[70vh]">
        <Suspense fallback={<Msg title="Loading…" body="" />}>
          <SuccessInner />
        </Suspense>
      </main>
    </>
  );
}
