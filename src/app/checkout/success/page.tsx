"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { IconTicket, IconArrowRight } from "@/components/icons";
import { useSearchParams } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { useCart } from "@/components/cart/CartProvider";
import { VerificationProgress } from "@/components/rentals/VerificationProgress";
import { tierByKey } from "@/lib/membership";
import { rentalUpdateFeedback } from "../../../../shared/rentalUpdateFeedback";
import { loadStripe } from "@stripe/stripe-js";

function SuccessInner() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");
  const finalize = useAction(api.checkout.finalize);
  const syncAddition=useAction(api.rentalAdditions.sync);
  const [additionId,setAdditionId]=useState<string|null>(null);
  const [updateReceipt,setUpdateReceipt]=useState<{applied:boolean;kind?:string}>({applied:false});
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
          if (r.closed && !r.additionId) { setState("cancelled"); return; }
          setBookingId(r.bookingId);
          setCardSaved(!!r.cardSaved);
          setAdditionId(r.additionId??null);
          setUpdateReceipt({applied:r.updateApplied===true,kind:r.updateKind});
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
      if (additionId) {
        const updated = await syncAddition({ sessionId });
        if (alive) {
          setHoldStatus(updated.status); setHoldSecret(null);
          setUpdateReceipt({ applied: updated.updateApplied === true, kind: updated.updateKind });
        }
      } else {
        const updated = await syncHold({ sessionId });
        if (alive) { setHoldStatus(updated.status); setHoldSecret(null); }
      }
    }).catch(() => { if (alive) setHoldStatus("failed"); });
    return () => { alive = false; };
  }, [sessionId, holdSecret, holdStatus, syncHold,additionId,syncAddition]);

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
      <Msg title="Payment not completed" body="Payment has not been confirmed. Your basket is saved. If your bank shows a pending payment, check its status before paying again." cta />
    );
  if (state === "cancelled")
    return <Msg title="This booking is closed" body="This checkout belongs to a cancelled booking. Please contact us if your bank shows a charge so we can confirm its refund." cta />;
  if (state === "error")
    return <Msg title="We’re still confirming your payment" body="Your basket is still intact. Do not pay again — check the payment status once more in a moment. If it still cannot be confirmed, contact us with your payment reference." cta onRetry={() => { setState("working"); setAttempt((value) => value + 1); }} />;

  if(additionId){
    const message=rentalUpdateFeedback({...updateReceipt,status:holdStatus});
    return <Msg title={message.title} body={message.body} accountRental={bookingId} />;
  }

  if(cardSaved)return <Msg title="Card saved" body="Your rental security card has been updated. We will request the hold at your agreed pickup time, or now if pickup is already due. Open your account to check progress." accountRental={bookingId} />;

  // membership subscription confirmation
  if (membership && !bookingId) {
    const t = tierByKey(membership);
    return (
      <><SiteHeader /><div className="mx-auto max-w-2xl px-6 py-16 text-center">
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
      </div></>
    );
  }

  return bookingId ? <VerificationProgress bookingId={bookingId} checkoutSessionId={sessionId} presentation="page" /> : <Msg title="Loading your rental" body="Your payment was received. Open your account to view the booking." />;
}

function Msg({
  title,
  body,
  cta,
  onRetry,
  accountRental,
}: {
  title: string;
  body: string;
  cta?: boolean;
  onRetry?: () => void;
  accountRental?: string | null;
}) {
  return (
    <><SiteHeader /><main className="section-window mx-auto min-h-[70vh] max-w-xl px-6 py-24 text-center">
      <h1 className="font-display text-2xl font-bold text-white/90">{title}</h1>
      <p className="mt-2 text-white/40">{body}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-primary mt-6 px-6 py-3">
          Check payment again
        </button>
      )}
      {accountRental && <Link href={`/account?rental=${encodeURIComponent(accountRental)}#chat`} className="btn-primary mt-6 px-6 py-3">Open rental conversation</Link>}
      {cta && (
        <Link
          href="/cart"
          className="arrow-link mt-6 inline-block text-accent-400 hover:text-accent-300"
        >
          Back to kit <span className="arrow">→</span>
        </Link>
      )}
    </main></>
  );
}

export default function SuccessPage() {
  return <Suspense fallback={<Msg title="Loading…" body="" />}><SuccessInner /></Suspense>;
}
