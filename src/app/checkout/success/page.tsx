"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { IconCamera, IconTicket, IconCheck, IconArrowRight } from "@/components/icons";
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
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center">
          <span className="h-10 w-10 animate-spin rounded-full border-2 border-accent-400/20 border-t-accent-400" />
        </div>
        <div className="hud-label mt-6">Confirming payment</div>
        <p className="mt-2 text-white/40">One moment.</p>
      </div>
    );
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
        <div className="page-in mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-400/15 text-amber-300 shadow-[0_0_44px_-8px_rgba(251,191,36,0.5)]">
          <IconTicket className="h-8 w-8" />
        </div>
        <h1 className="mt-5 font-display text-3xl font-bold text-white sm:text-4xl">
          Welcome to <span className="serif-accent gradient-text text-[1.06em]">{t?.name ?? "membership"}</span>
        </h1>
        <p className="mt-3 text-white/40">
          {t ? `${t.pct}% off every rental` : "Your membership"} is now active
          {t?.freeDelivery ? " — plus free local delivery." : "."}
        </p>
        <Link href="/gear" className="btn-primary mt-8 px-7 py-3">
          Start saving
          <IconArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <div className="page-in relative mx-auto h-16 w-16">
        <span className="ripple-ring" style={{ width: 96, height: 96, opacity: 0.5 }} aria-hidden />
        <span className="ripple-ring" style={{ width: 144, height: 144, opacity: 0.3, animationDelay: "0.3s" }} aria-hidden />
        <span className="ripple-ring" style={{ width: 196, height: 196, opacity: 0.15, animationDelay: "0.6s" }} aria-hidden />
        <div className="accent-glow-lg relative flex h-16 w-16 items-center justify-center rounded-full bg-accent-500/15 text-accent-400">
          <IconCamera className="h-8 w-8" />
        </div>
      </div>
      <div className="hud-label mt-5 flex items-center justify-center gap-2">
        <span className="rec-dot" /> Scene locked
      </div>
      <h1 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
        Booking <span className="serif-accent gradient-text text-[1.06em]">confirmed</span>
      </h1>
      <p className="mt-3 text-white/40">
        A confirmation has been sent to {booking?.guestEmail ?? "your email"}.
      </p>

      {booking && (
        <div className="ticket spot gradient-border mx-auto mt-8 max-w-md rounded-2xl p-5 text-left">
          <div className="hud-label !text-accent-400/90">Your receipt</div>
          <div className="mt-3">
            {booking.lineItems.map((li, i) => (
              <div key={i} className="flex justify-between py-1 text-sm text-white/60">
                <span className="mr-2 line-clamp-1">{li.title}</span>
                <span className="font-mono">£{li.lineTotal}</span>
              </div>
            ))}
          </div>
          <hr className="receipt-sep" />
          <div className="flex justify-between font-display font-bold text-white">
            <span>Paid</span>
            <span className="font-mono">£{booking.total}</span>
          </div>
          <div className="mt-1 text-right font-mono text-xs text-white/35">
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

      <Link href="/gear" className="btn-primary mt-8 px-7 py-3">
        Rent more gear
        <IconArrowRight className="h-4 w-4" />
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
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="font-display text-2xl font-bold text-white/90">{title}</h1>
      <p className="mt-2 text-white/40">{body}</p>
      {cta && (
        <Link
          href="/cart"
          className="arrow-link mt-6 inline-block text-accent-400 hover:text-accent-300"
        >
          Back to kit <span className="arrow">→</span>
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
