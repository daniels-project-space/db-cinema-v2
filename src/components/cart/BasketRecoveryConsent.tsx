"use client";

import Link from "next/link";
import { useAccount } from "@/components/account/AccountProvider";
import { useCart } from "./CartProvider";

export function BasketRecoveryConsent({ showError = true }: { showError?: boolean }) {
  const account = useAccount();
  const cart = useCart();

  if (!cart.items.length) return null;

  if (!account.me || !account.token) {
    return (
      <p className="mt-3 text-xs text-white/45" data-testid="basket-reminder-sign-in">
        <Link href="/account" className="text-accent-300 underline underline-offset-2">
          Sign in
        </Link>{" "}
        to choose optional basket reminders.
      </p>
    );
  }

  if (!cart.recoveryFollowupConsentReady) return null;

  return (
    <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-xs text-white/65">
      <input
        type="checkbox"
        data-testid="basket-reminder-consent"
        checked={cart.recoveryFollowupConsent}
        onChange={(event) => cart.setRecoveryFollowupConsent(event.currentTarget.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-amber-300"
      />
      <span>
        <span className="block font-medium text-white/80">Email two basket reminders</span>
        <span className="mt-0.5 block text-white/45">After 1 day and 1 week. No newsletter.</span>
        {showError && cart.recoveryError && <span role="alert" className="mt-1 block text-rose-300">{cart.recoveryError}</span>}
      </span>
    </label>
  );
}
