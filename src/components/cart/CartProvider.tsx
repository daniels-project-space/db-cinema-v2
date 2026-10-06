"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { dayMs, daysInclusive } from "@/lib/dates";
import {
  restoreMembershipSelection,
  type MembershipSelection,
} from "../../../shared/membershipSelection";
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
  offerType?: string; // legacy saved-basket marker; no pricing or promo effect
};

type CartCtx = {
  membership: MembershipSelection | null;
  setMembership: (selection: MembershipSelection | null) => void;
  items: CartItem[];
  add: (item: Omit<CartItem, "key">) => void;
  replace: (items: CartItem[]) => void;
  switchItem: (key: string, item: Omit<CartItem, "key">) => void;
  updateDates: (key: string, start: string, end: string, total: number) => void;
  reminderEnabled: boolean;
  setReminderEnabled: (enabled: boolean) => void;
  reminderError: string | null;
  remove: (key: string) => void;
  clear: () => void;
  has: (listingId: string) => boolean;
  count: number;
  subtotal: number; // all rental lines
  eligibleSubtotal: number; // ordinary rental lines eligible for promos
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
const MKEY = "dbc_membership_selection_v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [membership, setMembership] = useState<MembershipSelection | null>(
    null,
  );
  const [items, setItems] = useState<CartItem[]>([]);
  const latestItems = useRef(items);
  latestItems.current = items;
  const [promo, setPromoState] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const track = useMutation(api.analytics.track);
  const account = useAccount();
  const recovery = useQuery(
    api.checkoutRecovery.mine,
    account.token && account.me ? { token: account.token } : "skip",
  );
  const syncRecovery = useMutation(api.checkoutRecovery.sync);
  const [reminderChoice, setReminderChoice] = useState<{
    token: string;
    value: boolean;
  } | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const reminderEnabled =
    !!account.token &&
    (reminderChoice?.token === account.token
      ? reminderChoice.value
      : !!recovery);
  const setReminderEnabled = (value: boolean) => {
    if (account.token) setReminderChoice({ token: account.token, value });
  };
  const hadBasket = useRef({ token: "", value: false });
  const recoveryLines = JSON.stringify(
    items.map((i) => ({
      listingId: i.listingId,
      start: dayMs(i.start),
      end: dayMs(i.end),
      qty: 1,
    })),
  );
  useEffect(() => {
    if (!hydrated || !account.token || !account.me || recovery === undefined)
      return;
    if (hadBasket.current.token !== account.token)
      hadBasket.current = { token: account.token, value: false };
    const explicitlyOff =
      reminderChoice?.token === account.token && !reminderChoice.value;
    if (!items.length && !hadBasket.current.value && !explicitlyOff) return;
    if (items.length) hadBasket.current.value = true;
    const timer = setTimeout(() => {
      syncRecovery({
        token: account.token!,
        enabled: reminderEnabled,
        lines: JSON.parse(recoveryLines),
      })
        .then(() => setReminderError(null))
        .catch(() =>
          setReminderError(
            "Could not save your reminder preference. Please try again.",
          ),
        );
    }, 700);
    return () => clearTimeout(timer);
  }, [
    hydrated,
    account.token,
    account.me,
    recoveryLines,
    reminderEnabled,
    recovery === undefined,
    syncRecovery,
    reminderChoice,
  ]);
  const replace = useCallback((next: CartItem[]) => {
    setItems(next);
    setPromoState(null);
    localStorage.removeItem(PKEY);
    setToast("Your whole kit is ready to review");
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
      const referral=new URLSearchParams(window.location.search).get("ref");
      setPromoState(referral&&/^DBC-[A-Z0-9]{14}$/i.test(referral)?referral.toUpperCase():localStorage.getItem(PKEY));
      setMembership(
        restoreMembershipSelection(
          JSON.parse(localStorage.getItem(MKEY) ?? "null"),
        ),
      );
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(KEY, JSON.stringify(items));
  }, [items, hydrated]);

  useEffect(() => {
    if (hydrated && !items.length) setMembership(null);
  }, [hydrated, items.length]);
  useEffect(() => {
    if (!hydrated) return;
    if (membership)
      localStorage.setItem(
        MKEY,
        JSON.stringify({ tier: membership.tier, intro: membership.intro }),
      );
    else localStorage.removeItem(MKEY);
  }, [membership, hydrated]);
  useEffect(() => {
    if (account.me?.membershipActive) {
      setMembership(null);
      return;
    }
    if (account.me?.membershipIntroUsed)
      setMembership((v) =>
        v?.intro === "trial"
          ? { ...v, intro: "none", termsAccepted: false }
          : v,
      );
  }, [account.me?.membershipActive, account.me?.membershipIntroUsed]);
  useEffect(() => {
    setMembership((v) => (v ? { ...v, termsAccepted: false } : v));
  }, [account.token]);
  const setPromo = useCallback((code: string | null) => {
    setPromoState(code);
    if (code) localStorage.setItem(PKEY, code);
    else localStorage.removeItem(PKEY);
  }, []);

  const add = useCallback(
    (item: Omit<CartItem, "key">) => {
      const key = `${item.listingId}|${item.start}|${item.days}|${item.offerType ?? ""}`;
      setItems((prev) =>
        prev.some((p) => p.key === key) ? prev : [...prev, { ...item, key }],
      );
      setToast(`${item.title.slice(0, 40)} added to your kit`);
      track({
        type: "add_to_cart",
        path: item.slug,
        listingId: item.listingId,
        title: item.title,
        qty: 1,
        sessionId: getSessionId(),
      }).catch(() => {});
    },
    [track],
  );

  const switchItem = useCallback((key: string, replacement: Omit<CartItem, "key">) => {
    const original = latestItems.current.find(i => i.key === key);
    if (!original || original.start !== replacement.start || original.end !== replacement.end)
      throw Error("Your basket changed. Choose an alternative for the current dates.");
    if (latestItems.current.some(i => i.key !== key && i.listingId === replacement.listingId && i.start === replacement.start && i.end === replacement.end))
      throw Error("That alternative is already in your basket for these dates.");
    const nextKey = `${replacement.listingId}|${replacement.start}|${replacement.days}|`;
    setItems(prev => {
      const original = prev.find(i => i.key === key);
      if (!original || original.start !== replacement.start || original.end !== replacement.end || prev.some(i => i.key !== key && i.listingId === replacement.listingId && i.start === replacement.start && i.end === replacement.end)) return prev;
      return prev.map(i => i.key === key ? { ...replacement, key: nextKey } : i);
    });
    setMembership(v => v ? { ...v, termsAccepted: false } : v);
    setToast("Gear switched — your rental dates are unchanged");
  }, []);

  const remove = useCallback(
    (key: string) => setItems((prev) => prev.filter((p) => p.key !== key)),
    [],
  );
  const updateDates = useCallback((key: string, start: string, end: string, total: number) => {
    const item = items.find(i => i.key === key);
    if (!item) throw Error("This item is no longer in your kit.");
    if (!dayMs(start) || !dayMs(end) || end < start || !Number.isFinite(total) || total < 0) throw Error("Invalid rental dates or price.");
    if (items.some(i => i.key !== key && i.listingId === item.listingId && i.start === start && i.end === end && i.offerType === item.offerType)) throw Error("This item is already in your kit for those dates.");
    const days = daysInclusive(start, end);
    setItems(prev => prev.map(i => i.key === key ? { ...i, key: `${i.listingId}|${start}|${days}|${i.offerType ?? ""}`, start, end, days, total, perDay: Math.round(total / days * 100) / 100 } : i));
    setMembership(v => v ? { ...v, termsAccepted: false } : v);
    setToast("Rental dates and price updated");
  }, [items]);
  const clear = useCallback(() => {
    setItems([]);
    setMembership(null);
    setPromo(null);
  }, [setPromo]);
  const has = useCallback(
    (listingId: string) => items.some((i) => i.listingId === listingId),
    [items],
  );

  const subtotal = items.reduce((n, i) => n + i.total, 0);
  const eligibleSubtotal = subtotal;
  const depositTotal = items.reduce((n, i) => n + i.deposit, 0);

  return (
    <Ctx.Provider
      value={{
        membership,
        setMembership,
        items,
        add,
        replace,
        updateDates,
        switchItem,
        reminderEnabled,
        setReminderEnabled,
        reminderError,
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
