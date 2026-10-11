"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";

export function CheckoutReminderNotice({ className = "" }: { className?: string }) {
  const account = useAccount();
  const preference = useQuery(
    api.checkoutRecovery.preference,
    account.token && account.me ? { token: account.token } : "skip",
  );
  const setPreference = useMutation(api.checkoutRecovery.setPreference);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!account.token || !account.me) return null;
  const disabled = preference?.disabled ?? false;
  async function update() {
    if (!account.token || preference === undefined) return;
    setSaving(true);
    setError("");
    try {
      await setPreference({ token: account.token, disabled: !disabled });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the reminder setting.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-label="Basket reminder email"
      className={"rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 " + className}
      data-testid="basket-reminder-preference"
    >
      <p className="text-xs leading-relaxed text-white/60">
        {disabled
          ? "Automatic basket reminder emails are off."
          : "We’ll email one reminder to your verified account address if this basket is still unchanged after 30 minutes."}
      </p>
      <button
        type="button"
        onClick={() => void update()}
        disabled={saving || preference === undefined}
        className="mt-2 text-xs font-medium text-accent-300 underline decoration-accent-300/40 underline-offset-4 transition-colors hover:text-accent-200 disabled:cursor-wait disabled:opacity-50"
      >
        {saving ? "Saving…" : disabled ? "Turn reminders on" : "Turn reminders off"}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </section>
  );
}
