"use client";

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
    <div className="glass gradient-border rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => onMonthChange(new Date(y, m - 1, 1))}
          className="rounded-full px-2 py-1 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Previous month"
        >
          ‹
        </button>
        <div className="font-display text-sm font-semibold text-white/80">
          {MONTHS[m]} {y}
        </div>
        <button
          onClick={() => onMonthChange(new Date(y, m + 1, 1))}
          className="rounded-full px-2 py-1 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wider text-white/30">
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
          const isStart = dayIso === start;
          const isEnd = dayIso === end;
          const inRange =
            !!start && !!end && dayIso > start && dayIso < end;
          const rangeBlocked = (inRange || isStart || isEnd) && isBlocked;
          const disabled = isPast || isBlocked;

          let cls =
            "relative h-9 rounded-lg text-sm transition-colors flex items-center justify-center ";
          if (isStart || isEnd) cls += "bg-accent-500 text-white font-semibold ";
          else if (rangeBlocked) cls += "bg-red-500/25 text-red-200 ";
          else if (inRange) cls += "bg-accent-500/20 text-accent-200 ";
          else if (disabled) cls += "text-white/15 line-through cursor-not-allowed ";
          else cls += "text-white/70 hover:bg-white/10 cursor-pointer ";

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

      <div className="mt-3 text-center text-[11px] text-white/35">
        {!start
          ? "Tap your start date"
          : !end
            ? "Now tap your end date"
            : `${start} → ${end}`}
      </div>
    </div>
  );
}
