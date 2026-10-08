"use client";
import { useState } from "react";
import { useAction } from "convex/react";
import { loadStripe } from "@stripe/stripe-js";
import { api } from "@cvx/_generated/api";
import { PICKUP_HOLD_POLICY } from "../../../shared/pickupSecurity";
export function PickupHold({
  bookingId,
  token,
  policy,
  status,
  dueAt,
}: {
  bookingId: string;
  token: string;
  policy?: string | null;
  status?: string | null;
  dueAt?: number | null;
}) {
  const resume = useAction(api.holdRenewal.resumePickup),
    sync = useAction(api.holdRenewal.syncPickup),
    update = useAction(api.holdRenewal.updatePickupCard);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  if (
    policy !== PICKUP_HOLD_POLICY ||
    !["scheduled", "processing", "requires_action", "failed"].includes(
      status ?? "",
    )
  )
    return null;
  async function recover(newCard: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      if (newCard) {
        const r = await update({ token, bookingId: bookingId as any });
        window.location.assign(r.url);
        return;
      }
      const r = await resume({ token, bookingId: bookingId as any });
      if (!r.clientSecret)
        throw Error(
          "This hold is no longer awaiting bank approval. Refresh your rental.",
        );
      const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!key) throw Error("Card authentication is temporarily unavailable.");
      const sb = await loadStripe(key);
      if (!sb) throw Error("Card authentication could not start.");
      const c = await sb.confirmCardPayment(r.clientSecret);
      if (c.error) throw Error(c.error.message);
      const result = await sync({ token, bookingId: bookingId as any });
      setMessage(
        result.status === "held"
          ? "Card hold authorised. No payment was charged."
          : "The hold still needs attention. Update your card or contact us.",
      );
    } catch (e: any) {
      setMessage(e.message ?? "Card security could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-3 text-xs text-amber-100">
      <p className="font-semibold">
        {status === "requires_action"
          ? "Your bank needs to approve the pickup hold"
          : status === "failed"
            ? "Pickup card hold needs attention"
            : status === "processing"
              ? "Checking your pickup card hold"
              : "Card hold scheduled for pickup"}
      </p>
      <p className="mt-1 text-white/65">
        {status === "scheduled"
          ? `Your saved card will be authorised automatically ${dueAt ? new Date(dueAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }) + " London time" : "at your agreed pickup time"}. This is a hold, not a charge.`
          : "Equipment cannot be collected until the hold and document checks are complete."}
      </p>
      {status === "requires_action" && (
        <button
          disabled={busy}
          onClick={() => recover(false)}
          className="btn-primary mt-2 px-3 py-2"
        >
          {busy ? "Waiting…" : "Authenticate with bank"}
        </button>
      )}
      {["requires_action", "failed"].includes(status ?? "") && (
        <button
          disabled={busy}
          onClick={() => recover(true)}
          className="ml-2 mt-2 text-amber-200 underline"
        >
          Update saved card
        </button>
      )}
      {message && (
        <p role="status" className="mt-2">
          {message}
        </p>
      )}
    </div>
  );
}
