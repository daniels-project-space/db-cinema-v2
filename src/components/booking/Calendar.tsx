"use client";

import { IconChevronLeft, IconChevronRight } from "@/components/icons";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function addDaysIso(start: string, n: number): string {
  const [y, m, d] = start.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

export function daysInclusive(start: string, end: string): number {
  const a = Date.parse(start + "T00:00:00Z");
  const b = Date.parse(end + "T00:00:00Z");
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

type Props = {
  month: Date;
  onMonthChange: (d: Date) => void;
  start: string | null;
  end: string | null;
  unavailable: Set<string>;
  onPick: (isoDate: string) => void;
};

export function Calendar({ month, onMonthChange, start, end, unavailable, onPick }: Props) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const startWeekday = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const t = new Date();
  const todayIso = iso(t.getFullYear(), t.getMonth(), t.getDate());

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="spot gradient-border rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => onMonthChange(new Date(y, m - 1, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Previous month"
        >
          <IconChevronLeft className="h-4 w-4" />
        </button>
        <div className="font-display text-sm font-semibold text-white/85">
          {MONTHS[m]} <span className="font-mono text-white/40">{y}</span>
        </div>
        <button
          onClick={() => onMonthChange(new Date(y, m + 1, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Next month"
        >
          <IconChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] uppercase tracking-wider text-white/30">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const dayIso = iso(y, m, d);
          const isPast = dayIso < todayIso;
          const isBlocked = unavailable.has(dayIso);
          const isToday = dayIso === todayIso;
          const isStart = dayIso === start;
          const isEnd = dayIso === end;
          const inRange = !!start && !!end && dayIso > start && dayIso < end;
          const rangeBlocked = (inRange || isStart || isEnd) && isBlocked;
          const disabled = isPast || isBlocked;

          let cls =
            "relative h-9 rounded-lg text-sm transition-all duration-200 flex items-center justify-center tabular-nums ";
          if (isStart || isEnd)
            cls += "bg-accent-500 text-white font-semibold shadow-[0_2px_14px_-2px_rgba(14,165,233,0.7)] scale-[1.04] ";
          else if (rangeBlocked) cls += "bg-rec-500/25 text-red-200 ";
          else if (inRange) cls += "bg-accent-500/20 text-accent-200 ";
          else if (disabled) cls += "text-white/15 line-through cursor-not-allowed ";
          else cls += "text-white/70 hover:bg-white/10 hover:scale-[1.06] cursor-pointer ";
          if (isToday && !isStart && !isEnd) cls += "ring-1 ring-inset ring-accent-400/40 ";

          return (
            <button
              key={i}
              disabled={disabled}
              onClick={() => onPick(dayIso)}
              className={cls}
              title={isBlocked ? "Unavailable" : undefined}
            >
              {d}
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-center font-mono text-[11px] text-white/35">
        {!start
          ? "Tap your start date"
          : !end
            ? "Now tap your end date"
            : `${start} → ${end}`}
      </div>
    </div>
  );
}
