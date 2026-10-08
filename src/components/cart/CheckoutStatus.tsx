"use client";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
export const CHECKOUT_PAUSED_MESSAGE = "Checkout is temporarily paused while we improve the booking experience. Your basket is saved; please check back soon.";
export function useCheckoutStatus() {
  const config = useQuery(api.settings.get, {});
  return { enabled: config?.checkoutEnabled === true, loading: config === undefined };
}
export function CheckoutPauseNotice({ loading = false }: { loading?: boolean }) {
  return <p data-testid="checkout-paused-notice" role="status" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm leading-relaxed text-amber-100/85">{loading ? "Checking checkout availability…" : CHECKOUT_PAUSED_MESSAGE}</p>;
}
