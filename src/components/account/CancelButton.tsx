"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { cancelKind, type EnrichedBooking } from "@/lib/bookingDisplay";

/** Self-service cancel. Hidden unless the server feature flag (customerActionsEnabled) is on
 *  and the booking is still cancellable. Label reflects the refund vs 90-day-credit window. */
export function CancelButton({ booking }: { booking: EnrichedBooking }) {
  const account = useAccount();
  const cancel = useAction(api.checkout.cancelByCustomer);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!(account.me as any)?.customerActionsEnabled) return null;
  if (!["confirmed", "pending_payment"].includes(booking.status)) return null;

  const start = booking.start ?? booking.lineItems?.[0]?.start ?? null;
  const kind = booking.status === "pending_payment" || start == null ? "full_refund" : cancelKind(start, Date.now());
  const label =
    booking.status === "pending_payment"
      ? "Cancel"
      : kind === "full_refund"
        ? "Cancel · full refund"
        : "Cancel · 90-day credit";

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      await cancel({ token: account.token!, bookingId: booking._id as any });
      // myBookings is reactive — the tile re-renders into History automatically.
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't cancel");
      setBusy(false);
      setConfirm(false);
    }
  }

  if (!confirm)
    return (
      <button onClick={() => setConfirm(true)} className="text-xs font-medium text-rose-300/70 hover:text-rose-300">
        {label}
      </button>
    );

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className="text-white/50">{kind === "store_credit" ? "Cancel for 90-day credit?" : "Cancel & refund?"}</span>
      <button onClick={go} disabled={busy} className="rounded-full bg-rose-500/80 px-3 py-1 font-medium text-white hover:bg-rose-500 disabled:opacity-50">
        {busy ? "…" : "Yes, cancel"}
      </button>
      <button onClick={() => setConfirm(false)} className="text-white/40 hover:text-white">
        keep it
      </button>
      {err && <span className="text-rose-300">{err}</span>}
    </span>
  );
}
