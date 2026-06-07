"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useCart } from "./CartProvider";
import { useAccount } from "@/components/account/AccountProvider";

export function usePromo(eligibleSubtotal: number) {
  const { promo, setPromo } = useCart();
  const account = useAccount();
  const isMember = !!account.me?.membershipActive;
  const [draft, setDraft] = useState(promo ?? "");

  const res = useQuery(
    api.promo.validate,
    promo ? { code: promo, eligibleSubtotal, isMember } : "skip",
  );
  const discount = res && res.valid ? res.discount : 0;

  return {
    draft,
    setDraft,
    applied: promo,
    status: res,
    discount,
    apply: () => setPromo(draft.trim() || null),
    remove: () => {
      setPromo(null);
      setDraft("");
    },
  };
}
