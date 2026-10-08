"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { IconCamera, IconTicket, IconCheck, IconArrowRight } from "@/components/icons";
import { useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { useCart } from "@/components/cart/CartProvider";
import { VerificationProgress } from "@/components/rentals/VerificationProgress";
import { tierByKey } from "@/lib/membership";
import { loadStripe } from "@stripe/stripe-js";
import { formatGbp } from "@/lib/pricing";

function SuccessInner() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const finalize = useAction(api.checkout.finalize);
  const syncAddition=useAction(api.rentalAdditions.sync);
  const [additionId,setAdditionId]=useState<string|null>(null);
  const syncHold = useAction(api.checkout.syncHold);
  const { clear } = useCart();

  const [state, setState] = useState<"working" | "paid" | "unpaid" | "cancelled" | "error">(
    "working",
  );
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [membership, setMembership] = useState<string | null>(null);
  const [cardSaved, setCardSaved] = useState(false);
  const [holdStatus, setHoldStatus] = useState<string | null>(null);
  const [holdSecret, setHoldSecret] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ran = useRef(-1);

  useEffect(() => {
    if (ran.current === attempt || !sessionId) return;
    ran.current = attempt;
    finalize({ sessionId })
      .then((r) => {
        if (r.paid) {
          if (r.closed) { setState("cancelled"); return; }
          setBookingId(r.bookingId);
          setCardSaved(!!r.cardSaved);
          setAdditionId(r.additionId??null);
          setMembership((r as any).membership ?? null);
          setHoldStatus(r.holdStatus ?? null);
          setHoldSecret(r.holdClientSecret ?? null);
          setState("paid");
          if (!(r as any).membership&&!r.additionId&&!r.cardSaved) clear();
        } else {
          setState("unpaid");
        }
      })
      .catch(() => setState("error"));
  }, [sessionId, attempt, finalize, clear]);

  useEffect(() => {
    if (!sessionId || !holdSecret || holdStatus !== "requires_action") return;
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) return;
    let alive = true;
    loadStripe(key).then(async (stripe) => {
      if (!stripe) return;
      const result = await stripe.confirmCardPayment(holdSecret);
      if (!alive) return;
      if (result.error) { setHoldStatus("failed"); return; }
      const updated = additionId?await syncAddition({sessionId}):await syncHold({ sessionId });
      if (alive) { setHoldStatus(updated.status); setHoldSecret(null); }
    }).catch(() => { if (alive) setHoldStatus("failed"); });
    return () => { alive = false; };
  }, [sessionId, holdSecret, holdStatus, syncHold,additionId,syncAddition]);

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
        <p className="mt-2 text-white/40">We’re confirming your payment. Please don’t submit another payment.</p>
      </div>
    );
  if (state === "unpaid")
    return (
      <Msg title="Payment not completed" body="Your card was not charged. Your kit is still saved here, ready when you are." cta />
    );
  if (state === "cancelled")
    return <Msg title="This booking is closed" body="This checkout belongs to a cancelled booking. Please contact us if your bank shows a charge so we can confirm its refund." cta />;
  if (state === "error")
    return <Msg title="We’re still confirming your payment" body="Your basket is still intact. Do not pay again — check the payment status once more in a moment. If it still cannot be confirmed, contact us with your payment reference." cta onRetry={() => { setState("working"); setAttempt((value) => value + 1); }} />;

  if(additionId){
    const ready=holdStatus==="held";
    return <Msg title={ready?"Items added to your rental":"Payment received · approval pending"} body={ready?"Your order and rental conversation now include the extra items.":holdStatus==="requires_action"?"Complete the bank approval to add these items. You can resume it in your rental conversation.":"The extra items are waiting for a valid security hold. Open your rental conversation to check the status or ask the team for help."} cta />;
  }

  if(cardSaved)return <Msg title="Card saved" body="Your rental security card has been updated. We will request the hold at your agreed pickup time, or now if pickup is already due. Open your account to check progress." cta />;

  // membership subscription confirmation
  if (membership && !bookingId) {
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
        Payment <span className="serif-accent gradient-text text-[1.06em]">received</span>
      </h1>
      <p className="mt-3 text-white/40">
        Your payment is received and your kit is reserved. Complete the required identity and address checks now. Your saved card will be authorised automatically at your agreed pickup time; handover requires successful security and document approval.
      </p>

      {bookingId && <div className="mt-8"><VerificationProgress bookingId={bookingId} checkoutSessionId={sessionId} autoStart /></div>}

      {booking && (
        <div className="ticket spot gradient-border mx-auto mt-8 max-w-md rounded-2xl p-5 text-left">
          <div className="hud-label !text-accent-400/90">Your receipt</div>
          <div className="mt-3">
            {booking.lineItems.map((li, i) => (
              <div key={i} className="flex justify-between py-1 text-sm text-white/60">
                <span className="mr-2 line-clamp-1">{li.title}</span>
                <span className="font-mono">{formatGbp(li.lineTotal)}</span>
              </div>
            ))}
          </div>
          <hr className="receipt-sep" />
          <div className="flex justify-between font-display font-bold text-white">
            <span>Paid</span>
            <span className="font-mono">{formatGbp(booking.total)}</span>
          </div>
          <div className="mt-1 text-right font-mono text-xs text-white/35">
            incl. {formatGbp(booking.depositAmount)} refundable security payment
          </div>
          {booking.depositHoldAmount > 0 && <div className="mt-1 text-right font-mono text-xs text-white/35">Separate {formatGbp(booking.depositHoldAmount)} card hold: {booking.depositHoldStatus ?? holdStatus ?? "processing"} (not charged)</div>}
        </div>
      )}

      {booking?.depositHoldAmount && booking.depositHoldStatus !== "held" && (
        <div className="mx-auto mt-5 max-w-md rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-200">
          {holdStatus === "scheduled" ? "Your card is saved. The hold is scheduled for your agreed pickup or delivery time and is not charged today. Document checks can be completed now. Equipment cannot be handed over until all required checks and the hold are complete." : holdStatus === "requires_action" ? "Your bank is confirming the refundable card hold. Complete any bank prompt to finish." : "The card hold is not active yet. Equipment cannot be handed over until it is authorised. Please contact us if this does not update."}
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
  onRetry,
}: {
  title: string;
  body: string;
  cta?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="font-display text-2xl font-bold text-white/90">{title}</h1>
      <p className="mt-2 text-white/40">{body}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-primary mt-6 px-6 py-3">
          Check payment again
        </button>
      )}
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
