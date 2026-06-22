"use client";

import { useMemo, useState } from "react";
import {
  type EnrichedBooking,
  groupOf,
  londonStartOfDay,
  fmtDate,
} from "@/lib/bookingDisplay";

const WD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const groupTint: Record<string, string> = {
  pending: "bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/30",
  active: "bg-sky-500/30 text-sky-50 ring-1 ring-sky-400/40",
  upcoming: "bg-emerald-500/25 text-emerald-50 ring-1 ring-emerald-400/30",
  past: "bg-white/[0.05] text-white/40",
};
const groupRank: Record<string, number> = { active: 3, upcoming: 2, pending: 1, past: 0 };

function Lg({ c, t }: { c: string; t: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${c}`} />
      {t}
    </span>
  );
}

export function RentalCalendar({ bookings }: { bookings: EnrichedBooking[] | null | undefined }) {
  const list = (bookings ?? []).filter((b) => b.start != null && b.end != null);
  const now = Date.now();

  const initial = useMemo(() => {
    const future = list.filter((b) => (b.end ?? 0) >= now).sort((a, b) => (a.start ?? 0) - (b.start ?? 0))[0];
    const base = future?.start ?? now;
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(new Date(base));
    return { y: +p.find((x) => x.type === "year")!.value, m: +p.find((x) => x.type === "month")!.value - 1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [ym, setYm] = useState(initial);
  const [sel, setSel] = useState<number | null>(null);

  const cover = useMemo(() => {
    const m = new Map<number, EnrichedBooking[]>();
    for (const b of list) {
      let d = londonStartOfDay(b.start!);
      const last = londonStartOfDay(b.end!);
      let guard = 0;
      while (d <= last && guard++ < 400) {
        if (!m.has(d)) m.set(d, []);
        m.get(d)!.push(b);
        d += 86400000;
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings]);

  const firstOfMonth = Date.UTC(ym.y, ym.m, 1);
  const daysInMonth = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const jsDow = new Date(firstOfMonth).getUTCDay(); // 0=Sun
  const lead = (jsDow + 6) % 7; // Mon-first
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const cellDate = (day: number) => Date.UTC(ym.y, ym.m, day);
  const prev = () => { setSel(null); setYm((p) => (p.m === 0 ? { y: p.y - 1, m: 11 } : { y: p.y, m: p.m - 1 })); };
  const next = () => { setSel(null); setYm((p) => (p.m === 11 ? { y: p.y + 1, m: 0 } : { y: p.y, m: p.m + 1 })); };

  const selBookings = sel != null ? (cover.get(cellDate(sel)) ?? []) : [];
  const todayCivil = londonStartOfDay(now);

  return (
    <section className="spot gradient-border rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-white/80">Rental calendar</h2>
        <div className="flex items-center gap-1">
          <button onClick={prev} aria-label="Previous month" className="rounded-lg px-2 py-1 text-white/50 hover:bg-white/5 hover:text-white">‹</button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium text-white/70">{MONTHS[ym.m]} {ym.y}</span>
          <button onClick={next} aria-label="Next month" className="rounded-lg px-2 py-1 text-white/50 hover:bg-white/5 hover:text-white">›</button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center">
        {WD.map((d) => (
          <div key={d} className="pb-1 text-[10px] font-medium uppercase tracking-wide text-white/30">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day == null) return <div key={i} />;
          const cd = cellDate(day);
          const bs = cover.get(cd) ?? [];
          const top = [...bs].sort((a, b) => groupRank[groupOf(b)] - groupRank[groupOf(a)])[0];
          const tint = top ? groupTint[groupOf(top)] : "";
          const isToday = cd === todayCivil;
          const selected = sel === day;
          return (
            <button
              key={i}
              onClick={() => setSel(selected ? null : day)}
              className={`relative flex aspect-square items-center justify-center rounded-lg text-xs transition ${tint || "text-white/45 hover:bg-white/5"} ${selected ? "outline outline-2 outline-accent-400" : ""}`}
            >
              <span className={isToday ? "font-bold text-white underline underline-offset-2" : ""}>{day}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/40">
        <Lg c="bg-emerald-400" t="Upcoming" />
        <Lg c="bg-sky-400" t="Out now" />
        <Lg c="bg-amber-400" t="Pending" />
        <Lg c="bg-white/40" t="Past" />
      </div>

      {sel != null && selBookings.length > 0 && (
        <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs">
          <div className="mb-1 font-medium text-white/70">{fmtDate(cellDate(sel))}</div>
          {selBookings.map((b) => (
            <div key={b._id} className="text-white/55">
              {b.lineItems[0]?.title}
              {b.lineItems.length > 1 ? ` +${b.lineItems.length - 1}` : ""}
              {b.pickupTime || b.returnTime
                ? ` · ${b.pickupTime ? `pickup ${b.pickupTime}` : ""}${b.returnTime ? ` return ${b.returnTime}` : ""}`
                : ""}
            </div>
          ))}
        </div>
      )}
      {sel != null && selBookings.length === 0 && (
        <div className="mt-3 text-xs text-white/30">No rentals on {fmtDate(cellDate(sel))}.</div>
      )}
    </section>
  );
}
