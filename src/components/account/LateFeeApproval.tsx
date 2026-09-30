"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { loadStripe } from "@stripe/stripe-js";
import { formatGbp } from "@/lib/pricing";

export function LateFeeApproval({ bookingId, token, status, amount }: {
  bookingId: string;
  token: string;
  status?: string | null;
  amount?: number;
}) {
  const resume = useAction(api.lateFees.resume);
  const sync = useAction(api.lateFees.sync);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (status !== "requires_action" && status !== "processing") return null;

  async function approve() {
    setWorking(true);
    setMessage(null);
    try {
      const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!key) throw new Error("Card authentication is temporarily unavailable. Please contact us.");
      const result = await resume({ token, bookingId: bookingId as any });
      if (result.status === "paid") {
        setMessage("Your late rental charge is paid. A receipt will follow by email.");
        return;
      }
      if (!result.clientSecret) {
        setMessage(result.status === "paused" ? "Online late-fee collection is paused. Please contact us about this charge." :
          result.status === "processing" ? "Your bank is processing this payment. We will update your rental when it finishes." :
          "This charge can no longer be approved here. Please contact us.");
        return;
      }
      const stripe = await loadStripe(key);
      if (!stripe) throw new Error("Bank authentication could not start.");
      const confirmation = await stripe.confirmCardPayment(result.clientSecret);
      if (confirmation.error) throw new Error(confirmation.error.message ?? "Your bank did not approve this charge.");
      const updated = await sync({ token, bookingId: bookingId as any });
      setMessage(updated.status === "paid" ? "Your late rental charge is paid. A receipt will follow by email." :
        updated.status === "processing" ? "Your bank is processing this payment. We will update your rental when it finishes." :
        "We could not confirm this payment. Please contact us before trying again.");
    } catch (error: any) {
      setMessage(error?.message ?? "Bank authentication could not be completed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-2.5 text-[11px] text-amber-100">
      <p className="font-semibold">{status === "requires_action" ? "Bank approval needed for your late rental charge" : "Your late rental payment is processing"}</p>
      <p className="mt-1 text-white/65">{amount != null ? `${formatGbp(amount)} was assessed separately for late rental time. ` : ""}{status === "requires_action" ? "Review the itemised notice we emailed you, then approve the remaining card payment with your bank. Any amount already paid from an unused security hold is deducted." : "We will update the balance and email a receipt when your bank confirms it."}</p>
      {status === "requires_action" && <button type="button" disabled={working} onClick={approve} className="mt-2 rounded-md bg-amber-300 px-2.5 py-1.5 font-semibold text-black disabled:opacity-50">{working ? "Waiting for your bank…" : "Approve remaining late charge"}</button>}
      {message && <p role="status" className="mt-1.5">{message}</p>}
    </div>
  );
}
