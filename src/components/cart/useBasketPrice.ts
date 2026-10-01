"use client";
import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { dayMs } from "@/lib/dates";
import { useCart } from "./CartProvider";
import { useAccount } from "../account/AccountProvider";
export function useBasketPrice(enabled = true) {
  const cart = useCart(),
    account = useAccount(),
    priceQuote = useAction(api.checkout.priceQuote);
  const [result, setResult] = useState<{
      key: string;
      quote: Awaited<ReturnType<typeof priceQuote>>;
    } | null>(null),
    [error, setError] = useState<string | null>(null);
  const args = {
    items: cart.items.map((i) => ({
      listingId: i.listingId as any,
      title: i.title,
      start: dayMs(i.start),
      end: dayMs(i.end),
      qty: 1,
      total: i.total,
      deposit: i.deposit,
      offerType: i.offerType,
    })),
    customerEmail: account.me?.email ?? "",
    token: account.token && account.me ? account.token : undefined,
    selectedMembership: cart.membership
      ? { tier: cart.membership.tier, intro: cart.membership.intro }
      : undefined,
    fulfilment: "pickup" as const,
    promoCode: cart.promo ?? undefined,
    protection: "verify" as const,
  };
  const key = JSON.stringify(args);
  useEffect(() => {
    if (!enabled || !args.items.length) return;
    let cancelled = false;
    setError(null);
    const timer = setTimeout(() => {
      priceQuote(args)
        .then((quote) => {
          if (!cancelled) setResult({ key, quote });
        })
        .catch((e) => {
          if (!cancelled)
            setError(e.message ?? "Could not refresh basket pricing.");
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, enabled, priceQuote]);
  return {
    quote: result?.key === key ? result.quote : null,
    error,
    loading: enabled && !!cart.items.length && result?.key !== key && !error,
  };
}
