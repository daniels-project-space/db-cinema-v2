"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { loadStripe } from "@stripe/stripe-js";

export function HoldRenewal({ bookingId, token, status, expiresAt, releasePending = false }: {
  bookingId: string;
  token: string;
  status?: string | null;
  expiresAt?: number | null;
  releasePending?: boolean;
}) {
  const resume = useAction(api.holdRenewal.resume);
  const sync = useAction(api.holdRenewal.sync);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!status || (status === "renewed" && !releasePending)) return null;
  const needsAction = status === "requires_action";
  const failed = status === "failed";
  if (!needsAction && !failed && status !== "starting" && !releasePending) return null;

  async function approve() {
    setWorking(true);
    setMessage(null);
    try {
      const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!key) throw new Error("Card authentication is temporarily unavailable. Please contact us.");
      const result = await resume({ token, bookingId: bookingId as any });
      if (!result.clientSecret) throw new Error("The replacement hold is no longer awaiting approval. Refresh this page.");
      const stripe = await loadStripe(key);
      if (!stripe) throw new Error("Card authentication could not start.");
      const confirmation = await stripe.confirmCardPayment(result.clientSecret);
      if (confirmation.error) throw new Error(confirmation.error.message ?? "Your bank did not approve this hold.");
      const updated = await sync({ token, bookingId: bookingId as any });
      setMessage(updated.status === "renewed" ? updated.releasePending ? "Replacement hold authorised. The earlier hold release is still pending." : "Replacement hold authorised. The earlier hold has been released." : "Please contact us to finish renewing this hold.");
    } catch (error: any) {
      setMessage(error?.message ?? "Card authentication could not be completed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-2.5 text-[11px] text-amber-100">
      <p className="font-semibold">{status === "renewed" && releasePending ? "Earlier card hold release pending" : needsAction ? "Bank approval needed for your replacement card hold" : failed ? "Card hold renewal needs attention" : "Renewing your card hold"}</p>
      <p className="mt-1 text-white/65">{status === "renewed" && releasePending ? "Your replacement hold is authorised. We are still resolving release of the earlier authorisation. Contact us if it remains on your card." : <>{expiresAt ? `Current hold expires ${new Date(expiresAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })} London time. ` : ""}{needsAction ? "Approve the replacement hold with your bank so the rental remains covered." : failed ? "Please contact us before the current hold expires. A new card or bank approval may be needed." : "We are requesting a replacement hold from your bank."}</>}</p>
      {needsAction && <button type="button" disabled={working} onClick={approve} className="mt-2 rounded-md bg-amber-300 px-2.5 py-1.5 font-semibold text-black disabled:opacity-50">{working ? "Waiting for your bank…" : "Approve replacement hold"}</button>}
      {message && <p role="status" className="mt-1.5">{message}</p>}
    </div>
  );
}
