"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";

export function BasketReminderUnsubscribe({ token }: { token: string }) {
  const unsubscribe = useAction(api.checkoutRecoveryMail.unsubscribe);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function turnOff() {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await unsubscribe({ token });
      if (result.ok) setDone(true);
      else setError("This link could not be verified. You can turn reminders off from your rental basket.");
    } catch {
      setError("We could not update the reminder setting. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <p className="mt-5 text-sm text-white/60">This reminder link is incomplete.</p>;
  if (done) return <p role="status" className="mt-5 text-sm text-emerald-300">Basket reminder emails are now turned off for this account.</p>;

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => void turnOff()}
        disabled={busy}
        className="btn-primary px-6 py-3 disabled:opacity-50"
      >
        {busy ? "Updating…" : "Turn off basket reminders"}
      </button>
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    </div>
  );
}
