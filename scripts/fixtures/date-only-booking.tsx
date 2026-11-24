import React, { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { BookingPanel } from "@/components/booking/BookingPanel";
import { CartItemTimes } from "@/components/cart/CartItemTimes";
import { pickRentalDates } from "@/lib/dateSelection";

let version = 0;
let basket: any[] = [];
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const listing = {
  _id: "listing-date-only-fixture",
  slug: "date-only-fixture",
  title: "Sony FX3 Camera Kit",
  heroImage: null,
  pricing: { daily: 100, day3: 90 },
  depositAmount: 50,
  minimumRentalDays: 1,
};

export function useFixtureQuery(path: any, args: any) {
  useSyncExternalStore(subscribe, () => version, () => version);
  if (args === "skip") return undefined;
  const key = String(path);
  (window as any).fixture.queryLog.push({ key, args });
  if (key === "settings.get") return { setupIntentSecurityEnabled: false, cardHoldSecurityEnabled: false, assessmentSecurityEnabled: false, refundableDepositEnabled: false };
  if (key === "availability.forCart") {
    const isThreeDayExtension = args.items.some((item: any) => item.end - item.start >= 2 * 86400000);
    const available = !isThreeDayExtension || (window as any).fixture?.extensionAvailable !== false;
    return { [listing._id]: { available: available ? 3 : 0, ok: available } };
  }
  if (key === "availability.forTimeSlots") return {
    available: 3,
    pickupSlots: ["09:00", "10:00", "18:00", "21:00"],
    returnSlots: ["10:00", "11:00", "19:00", "22:00"],
    pickupBoundarySlots: ["09:00", "10:00", "18:00", "21:00"],
    returnBoundarySlots: ["10:00", "11:00", "19:00", "22:00"],
    validPairs: [{ pickupTime: "09:00", returnTime: "10:00" }, { pickupTime: "18:00", returnTime: "19:00" }],
  };
  throw Error(`Unexpected fixture query ${key}`);
}

export function useFixtureAction(path: any) {
  return async (args: any) => {
    if (String(path) === "checkout.priceQuote") return { items: args.items.map((item: any) => ({ total: item.total })) };
    if (String(path) === "sync.refreshCalendarStock") return { days: {} };
    throw Error(`Unexpected fixture action ${String(path)}`);
  };
}

export const useFixtureMutation = () => async () => null;
export const useFixtureConvex = () => ({ query: async () => ({}) });
export const useFixtureAccount = () => ({ me: null, token: null });

export function useFixtureCart() {
  useSyncExternalStore(subscribe, () => version, () => version);
  return {
    items: basket,
    membership: null,
    promo: null,
    add: (item: any) => { basket = [...basket, { ...item, key: item.key ?? `${item.listingId}|${item.start}|${item.days}` }]; notify(); },
    updateDates: () => {},
    updateAllTimes: () => {},
  };
}

(window as any).fixture = {
  queryLog: [] as Array<{ key: string; args: any }>,
  extensionAvailable: true,
  setExtensionAvailable(value: boolean) { this.extensionAvailable = value; notify(); },
  getBasket: () => basket,
  getCart: () => ({
    items: basket,
    membership: null,
    promo: null,
    add: (item: any) => { basket = [...basket, { ...item, key: item.key ?? `${item.listingId}|${item.start}|${item.days}` }]; notify(); },
    updateDates: () => {},
    updateAllTimes: () => {},
  }),
};

function App() {
  const [page, setPage] = useState<"browse" | "cart" | "checkout">("browse");
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [month, setMonth] = useState(() => { const today = new Date(); return new Date(today.getFullYear(), today.getMonth(), 1); });
  const pick = (date: string) => { const next = pickRentalDates(start, end, date); setStart(next.start); setEnd(next.end); };
  return <main>
    <nav aria-label="Fixture navigation">
      <button data-testid="open-cart" onClick={() => setPage("cart")}>Open kit</button>
      <button data-testid="open-checkout" onClick={() => setPage("checkout")}>Continue to checkout</button>
    </nav>
    {page === "browse" && <BookingPanel listing={listing as any} start={start} end={end} month={month} onPick={pick} onEndChange={setEnd} onMonthChange={setMonth} unavailable={new Set()} touchFriendlyCalendar />}
    {page === "cart" && <section aria-label="Kit review">{basket.map(item => <article key={item.key} data-testid="cart-line">{item.title} · {item.start} – {item.end}</article>)}</section>}
    {page === "checkout" && <section aria-label="Checkout times">{basket.map(item => <CartItemTimes key={item.key} item={item} />)}</section>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
