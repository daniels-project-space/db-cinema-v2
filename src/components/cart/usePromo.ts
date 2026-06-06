"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useCart } from "./CartProvider";

export function usePromo(eligibleSubtotal: number) {
  const { promo, setPromo } = useCart();
  const [draft, setDraft] = useState(promo ?? "");

  const res = useQuery(
    api.promo.validate,
    promo ? { code: promo, eligibleSubtotal } : "skip",
  );
  const discount = res && res.valid ? res.discount : 0;

  return {
    draft,
    setDraft,
    applied: promo,
    status: res, // {valid, discount} | {valid:false, reason} | undefined
    discount,
    apply: () => setPromo(draft.trim() || null),
    remove: () => {
      setPromo(null);
      setDraft("");
    },
  };
}
