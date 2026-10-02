/** Deterministic late-time quote. Booking dates are UTC-midnight labels for
 * London civil dates; each commenced local rental day after the return slot
 * costs the daily rate captured at booking. Old rows without a rate are not
 * automatically charged. */
const london = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

type Line = { title: string; start: number; end: number; dailyRate?: number; returnTime?: string | null };

function actualParts(at: number) {
  const p = Object.fromEntries(london.formatToParts(new Date(at)).map((x) => [x.type, Number(x.value)]));
  return { day: Date.UTC(p.year, p.month - 1, p.day) / 86400000, minutes: p.hour * 60 + p.minute };
}

export function lateFeeQuote(lines: Line[], returnTime: string | null, actualReturnedAt: number) {
  const actual = actualParts(actualReturnedAt);
  const breakdown = lines.map((line) => {
    // A partial extension only changes the selected equipment's deadline.
    const slot = line.returnTime === undefined ? returnTime : line.returnTime;
    if (!slot) return { title: line.title, days: 0, dailyRate: 0, amount: 0 };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot)) throw new Error("Invalid agreed return time");
    const [h, m] = slot.split(":").map(Number);
    const dueMinutes = h * 60 + m;
    const dueDay = Date.UTC(new Date(line.end).getUTCFullYear(), new Date(line.end).getUTCMonth(), new Date(line.end).getUTCDate()) / 86400000;
    const minuteDifference = (actual.day - dueDay) * 1440 + actual.minutes - dueMinutes;
    const days = Math.max(0, Math.ceil(minuteDifference / 1440));
    const dailyRate = Number.isFinite(line.dailyRate) ? Math.max(0, Math.round(line.dailyRate! * 100) / 100) : 0;
    return { title: line.title, days, dailyRate, amount: Math.round(days * dailyRate * 100) / 100 };
  }).filter((line) => line.days > 0);
  return { amount: Math.round(breakdown.reduce((sum, line) => sum + line.amount, 0) * 100) / 100, breakdown };
}
