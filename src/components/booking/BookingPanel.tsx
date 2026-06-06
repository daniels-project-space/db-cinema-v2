"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { quote as computeQuote, type Pricing } from "@/lib/pricing";
import { Calendar, addDaysIso, iso } from "@/components/booking/Calendar";
import { DiscountLadder } from "@/components/booking/DiscountLadder";

type Listing = {
  _id: string;
  pricing: Pricing;
  depositAmount: number;
  minimumRentalDays: number;
  unavailableDates: string[];
};

function expandUnavailable(raw: string[]): Set<string> {
  const set = new Set<string>();
  for (const e of raw) {
    if (/^\d{4}-\d{2}-\d{2}/.test(e)) {
      set.add(e.slice(0, 10));
      continue;
    }
    try {
      const o = JSON.parse(e);
      const from = o.from ?? o.start ?? o.date;
      const to = o.to ?? o.end ?? from;
      if (from) {
        let cur = String(from).slice(0, 10);
        const last = String(to).slice(0, 10);
        for (let i = 0; i < 400 && cur <= last; i++) {
          set.add(cur);
          cur = addDaysIso(cur, 1);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return set;
}

const MAX_DAYS = 90;

export function BookingPanel({ listing }: { listing: Listing }) {
  const minDays = Math.max(1, listing.minimumRentalDays || 1);
  const [days, setDays] = useState(minDays);
  const [start, setStart] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });

  const unavailable = useMemo(
    () => expandUnavailable(listing.unavailableDates ?? []),
    [listing.unavailableDates],
  );

  const q = useMemo(
    () => computeQuote(listing.pricing, days),
    [listing.pricing, days],
  );

  const startMs = start ? Date.parse(start + "T00:00:00Z") : 0;
  const endIso = start ? addDaysIso(start, days - 1) : null;
  const endMs = endIso ? Date.parse(endIso + "T00:00:00Z") : 0;

  const avail = useQuery(
    api.availability.check,
    start && startMs && endMs
      ? { listingId: listing._id as any, start: startMs, end: endMs }
      : "skip",
  );

  const presets = [
    { d: 3, l: "3 days" },
    { d: 7, l: "1 week" },
    { d: 14, l: "2 weeks" },
    { d: 30, l: "1 month" },
  ].filter((p) => p.d >= minDays);

  return (
    <div className="flex flex-col gap-5">
      <Calendar
        month={month}
        onMonthChange={setMonth}
        selectedStart={start}
        rangeDays={days}
        unavailable={unavailable}
        onSelectStart={setStart}
      />

      {/* duration ticker */}
      <div className="glass gradient-border rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/60">Duration</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDays((d) => Math.max(minDays, d - 1))}
              disabled={days <= minDays}
              className="h-8 w-8 rounded-full glass text-lg leading-none text-white/80 transition-colors hover:bg-white/10 disabled:opacity-25"
              aria-label="Fewer days"
            >
              −
            </button>
            <span className="w-20 text-center font-display text-xl font-bold text-white/90">
              {days} <span className="text-sm font-normal text-white/40">day{days > 1 ? "s" : ""}</span>
            </span>
            <button
              onClick={() => setDays((d) => Math.min(MAX_DAYS, d + 1))}
              disabled={days >= MAX_DAYS}
              className="h-8 w-8 rounded-full bg-accent-500 text-lg leading-none text-white transition-colors hover:bg-accent-600 disabled:opacity-25"
              aria-label="More days"
            >
              +
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.d}
              onClick={() => setDays(p.d)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                days === p.d
                  ? "bg-accent-500 text-white"
                  : "glass text-white/50 hover:text-white"
              }`}
            >
              {p.l}
            </button>
          ))}
        </div>
      </div>

      {/* discount ladder + green nudge */}
      <DiscountLadder quote={q} />

      {/* price summary */}
      <div className="glass gradient-border rounded-2xl p-5">
        <div className="flex items-baseline justify-between">
          <div className="text-sm text-white/50">
            £{q.perDay}/day × {days} day{days > 1 ? "s" : ""}
            <span className="ml-2 rounded bg-accent-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-300">
              {q.tier.label}
            </span>
          </div>
          <div className="font-display text-2xl font-bold text-white/90">
            £{q.total}
          </div>
        </div>
        {q.saved > 0 && (
          <div className="mt-1 text-right text-xs text-emerald-300">
            saved £{q.saved} ({q.savedPct}%)
          </div>
        )}
        <div className="mt-2 flex justify-between text-xs text-white/35">
          <span>+ refundable deposit</span>
          <span>£{listing.depositAmount}</span>
        </div>

        {/* availability state */}
        {!start ? (
          <div className="mt-4 rounded-lg bg-white/[0.03] px-3 py-2 text-center text-xs text-white/40">
            Pick a start date above
          </div>
        ) : avail === undefined ? (
          <div className="mt-4 text-center text-xs text-white/30">Checking…</div>
        ) : avail.available ? (
          <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-center text-sm text-emerald-300">
            ✓ Available {start} → {endIso}
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-center text-sm text-red-300">
            ✕ Not available{avail.reason ? ` — ${avail.reason}` : " for these dates"}
          </div>
        )}

        <button
          disabled={!start || !avail?.available}
          className="mt-5 w-full rounded-full bg-accent-500 py-3 font-medium text-white transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Add to kit
        </button>
        <p className="mt-2 text-center text-[11px] text-white/25">
          Cart &amp; secure checkout land next (P2).
        </p>
      </div>
    </div>
  );
}
