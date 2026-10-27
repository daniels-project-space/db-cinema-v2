"use client";

import { useState } from "react";
import { useAction, useConvex, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { dayMs } from "@/lib/dates";
import { useCart, type CartItem } from "@/components/cart/CartProvider";
import { SmartImage } from "@/components/SmartImage";

type Suggestion = { start: number; end: number; pickupTime: string; returnTime: string };
type Result = { lineIndex: number; currentlyAvailable: boolean; suggestion: Suggestion | null; searchedDays: number };
type RentalGroup = { key: string; lineIndices: number[]; item: CartItem };

function dateLabel(day: number) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(day));
}

function sameSuggestion(a: Suggestion | null | undefined, b: Suggestion | null | undefined) {
  if (!a || !b) return !a && !b;
  return a.start === b.start && a.end === b.end && a.pickupTime === b.pickupTime && a.returnTime === b.returnTime;
}

function rentalGroupKey(item: CartItem, defaultPickupTime: string, defaultReturnTime: string) {
  return JSON.stringify([
    item.listingId,
    item.start,
    item.end,
    item.pickupTime || defaultPickupTime,
    item.returnTime || defaultReturnTime,
    item.offerType ?? "",
  ]);
}

export function NextAvailableRentalOptions({ lineIndices, defaultPickupTime = "", defaultReturnTime = "" }: {
  lineIndices: number[];
  defaultPickupTime?: string;
  defaultReturnTime?: string;
}) {
  const cart = useCart();
  const convex = useConvex();
  const priceQuote = useAction(api.checkout.priceQuote);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const groupsByKey = new Map<string, RentalGroup>();
  for (const lineIndex of lineIndices) {
    const item = cart.items[lineIndex];
    if (!item) continue;
    const key = rentalGroupKey(item, defaultPickupTime, defaultReturnTime);
    const group = groupsByKey.get(key);
    if (group) group.lineIndices.push(lineIndex);
    else groupsByKey.set(key, { key, lineIndices: [lineIndex], item });
  }
  const groups = [...groupsByKey.values()];
  const stockItems = cart.items.map((item) => ({
    listingId: item.listingId as any,
    start: dayMs(item.start),
    end: dayMs(item.end),
    pickupTime: item.pickupTime || defaultPickupTime || undefined,
    returnTime: item.returnTime || defaultReturnTime || undefined,
  }));
  const args = lineIndices.length ? { items: stockItems, lineIndices } : "skip";
  const results = useQuery(api.availability.nextAvailableForCart, args) as Result[] | undefined;
  const byIndex = new Map((results ?? []).map((result) => [result.lineIndex, result]));

  async function shift(group: RentalGroup, expected: Suggestion) {
    if (busyKey) return;
    setBusyKey(group.key);
    setErrors((current) => ({ ...current, [group.key]: "" }));
    const expectedBasketKeys = cart.items.map((entry) => entry.key);
    const targetIndex = group.lineIndices[0];
    try {
      const currentItems = cart.items.map((entry) => ({
        listingId: entry.listingId as any,
        start: dayMs(entry.start),
        end: dayMs(entry.end),
        pickupTime: entry.pickupTime || defaultPickupTime || undefined,
        returnTime: entry.returnTime || defaultReturnTime || undefined,
      }));
      const fresh = await convex.query(api.availability.nextAvailableForCart, { items: currentItems, lineIndices: [targetIndex] }) as Result[];
      const freshByIndex = new Map(fresh.map((result) => [result.lineIndex, result]));
      const currentSuggestion = freshByIndex.get(targetIndex);
      if (!currentSuggestion || currentSuggestion.currentlyAvailable || !sameSuggestion(currentSuggestion.suggestion, expected))
        throw Error("Availability changed while you were reviewing this option. Check the refreshed time and try again.");

      const item = cart.items[targetIndex];
      if (!item) throw Error("Your basket changed. Refresh checkout and try again.");
      const quote = await priceQuote({
        items: [{
          listingId: item.listingId as any,
          title: item.title,
          start: expected.start,
          end: expected.end,
          qty: 1,
          total: item.total,
          deposit: item.deposit,
          offerType: item.offerType,
        }],
        customerEmail: "",
        fulfilment: "pickup",
        protection: "verify",
      });
      const total = quote.items?.[0]?.total;
      if (!Number.isFinite(total) || (total as number) < 0) throw Error("Could not update this rental’s price. Please try again.");
      cart.shiftItemDates(
        item.key,
        expectedBasketKeys,
        { start: item.start, end: item.end, pickupTime: item.pickupTime, returnTime: item.returnTime },
        new Date(expected.start).toISOString().slice(0, 10),
        new Date(expected.end).toISOString().slice(0, 10),
        total as number,
        expected.pickupTime,
        expected.returnTime,
        `Moved one ${group.item.title} rental to ${dateLabel(expected.start)} at ${expected.pickupTime}. The full basket will be checked again.`,
      );
    } catch (error) {
      setErrors((current) => ({ ...current, [group.key]: error instanceof Error ? error.message : "Could not move this rental. Please try again." }));
    } finally {
      setBusyKey(null);
    }
  }

  if (!lineIndices.length) return null;
  return <ul aria-label="Next available rental times" className="mt-3 space-y-3">
    {groups.map((group) => {
      const groupResults = group.lineIndices.map((lineIndex) => byIndex.get(lineIndex));
      const result = groupResults[0];
      const allLoaded = groupResults.every((entry) => !!entry);
      const sameOutcome = allLoaded && groupResults.every((entry) => entry!.currentlyAvailable === result!.currentlyAvailable && sameSuggestion(entry!.suggestion, result!.suggestion));
      const error = errors[group.key];
      return <li key={group.key} className="rounded-lg border border-white/10 bg-black/15 p-3" data-testid="next-availability-group">
        <div className="flex items-start gap-3">
          <div data-testid="next-availability-thumbnail" className="h-14 w-14 shrink-0">
            <SmartImage
              fit="contain"
              src={group.item.heroImage}
              fallbackSources={group.item.imageSources}
              alt={group.item.title}
              className="h-full w-full rounded-lg"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-white/85">{group.item.title}</p>
            {group.lineIndices.length > 1 && <p className="mt-0.5 text-[11px] text-white/50">{group.lineIndices.length} identical rentals in your basket; this time applies to one copy</p>}
            {!allLoaded ? <p className="mt-1 text-xs text-white/55" role="status">Checking the next available pickup and return times…</p> : !sameOutcome ?
              <p className="mt-1 text-xs text-white/55" role="status">The copies now have different availability. Review the updated basket before moving them.</p> : result!.currentlyAvailable ?
                <p className="mt-1 text-xs text-white/55">This rental fits its selected time; another item in the basket is causing the stock warning.</p> : result!.suggestion ? <>
                  <p className="mt-1 text-xs leading-5 text-white/65">
                    Next available pickup: <span className="font-medium text-white/85">{dateLabel(result!.suggestion!.start)} at {result!.suggestion!.pickupTime}</span>
                    <br />Return: {dateLabel(result!.suggestion!.end)} at {result!.suggestion!.returnTime}
                  </p>
                  <button
                    type="button"
                    onClick={() => void shift(group, result!.suggestion!)}
                    disabled={!!busyKey}
                    aria-label={`Shift one ${group.item.title} rental${group.lineIndices.length > 1 ? ` of ${group.lineIndices.length}` : ""} to ${dateLabel(result!.suggestion!.start)} at ${result!.suggestion!.pickupTime}`}
                    className="btn-ghost mt-2 min-h-9 w-full !px-3 !py-2 text-xs"
                  >
                    {busyKey === group.key ? "Updating rental…" : group.lineIndices.length > 1 ? `Shift one of ${group.lineIndices.length} rentals to this time` : "Shift this rental to this time"}
                  </button>
                </> : <p className="mt-1 text-xs leading-5 text-white/55" role="status">No matching pickup time was found in the next {result!.searchedDays} days. Your basket has not changed.</p>}
          </div>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      </li>;
    })}
  </ul>;
}
