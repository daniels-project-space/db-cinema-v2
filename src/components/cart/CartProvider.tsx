"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";

export type CartItem = {
  key: string; // listingId|start|days
  listingId: string;
  slug: string;
  title: string;
  heroImage: string | null;
  start: string; // ISO date
  end: string;
  days: number;
  perDay: number;
  total: number;
  deposit: number;
};

type CartCtx = {
  items: CartItem[];
  add: (item: Omit<CartItem, "key">) => void;
  remove: (key: string) => void;
  clear: () => void;
  count: number;
  subtotal: number;
  depositTotal: number;
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const Ctx = createContext<CartCtx | null>(null);
const STORAGE_KEY = "dbc_cart_v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  const add = useCallback((item: Omit<CartItem, "key">) => {
    const key = `${item.listingId}|${item.start}|${item.days}`;
    setItems((prev) =>
      prev.some((p) => p.key === key) ? prev : [...prev, { ...item, key }],
    );
    setOpen(true);
  }, []);

  const remove = useCallback(
    (key: string) => setItems((prev) => prev.filter((p) => p.key !== key)),
    [],
  );
  const clear = useCallback(() => setItems([]), []);

  const subtotal = items.reduce((n, i) => n + i.total, 0);
  const depositTotal = items.reduce((n, i) => n + i.deposit, 0);

  return (
    <Ctx.Provider
      value={{
        items,
        add,
        remove,
        clear,
        count: items.length,
        subtotal,
        depositTotal,
        isOpen,
        open: () => setOpen(true),
        close: () => setOpen(false),
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
