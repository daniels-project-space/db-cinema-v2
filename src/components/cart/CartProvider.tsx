"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { getSessionId } from "@/lib/session";

export type CartItem = {
  key: string;
  listingId: string;
  slug: string;
  title: string;
  heroImage: string | null;
  start: string;
  end: string;
  days: number;
  perDay: number;
  total: number;
  deposit: number;
  offerType?: string; // tripod50 / gimbal30 — excluded from promo discount
};

type CartCtx = {
  items: CartItem[];
  add: (item: Omit<CartItem, "key">) => void;
  remove: (key: string) => void;
  clear: () => void;
  has: (listingId: string) => boolean;
  count: number;
  subtotal: number; // all rental lines
  eligibleSubtotal: number; // non-offer lines (promo applies here)
  depositTotal: number;
  promo: string | null;
  setPromo: (code: string | null) => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toast: string | null;
  clearToast: () => void;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "dbc_cart_v1";
const PKEY = "dbc_promo_v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [promo, setPromoState] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const track = useMutation(api.analytics.track);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
      setPromoState(localStorage.getItem(PKEY));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(KEY, JSON.stringify(items));
  }, [items, hydrated]);

  const setPromo = useCallback((code: string | null) => {
    setPromoState(code);
    if (code) localStorage.setItem(PKEY, code);
    else localStorage.removeItem(PKEY);
  }, []);

  const add = useCallback((item: Omit<CartItem, "key">) => {
    const key = `${item.listingId}|${item.start}|${item.days}|${item.offerType ?? ""}`;
    setItems((prev) => (prev.some((p) => p.key === key) ? prev : [...prev, { ...item, key }]));
    setToast(`${item.title.slice(0, 40)} added to your kit`);
    track({ type: "add_to_cart", path: item.slug, listingId: item.listingId, title: item.title, qty: 1, sessionId: getSessionId() }).catch(() => {});
  }, [track]);

  const remove = useCallback(
    (key: string) => setItems((prev) => prev.filter((p) => p.key !== key)),
    [],
  );
  const clear = useCallback(() => {
    setItems([]);
    setPromo(null);
  }, [setPromo]);
  const has = useCallback(
    (listingId: string) => items.some((i) => i.listingId === listingId),
    [items],
  );

  const subtotal = items.reduce((n, i) => n + i.total, 0);
  const eligibleSubtotal = items.filter((i) => !i.offerType).reduce((n, i) => n + i.total, 0);
  const depositTotal = items.reduce((n, i) => n + i.deposit, 0);

  return (
    <Ctx.Provider
      value={{
        items,
        add,
        remove,
        clear,
        has,
        count: items.length,
        subtotal,
        eligibleSubtotal,
        depositTotal,
        promo,
        setPromo,
        isOpen,
        open: () => setOpen(true),
        close: () => setOpen(false),
        toast,
        clearToast: () => setToast(null),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used within CartProvider");
  return c;
}
