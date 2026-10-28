import { en, type ParsedComponents } from "chrono-node";

type Window = { start?: string; end?: string; pickupTime?: string; returnTime?: string; ambiguous?: boolean };
const pad = (n: number) => String(n).padStart(2, "0");
const day = (parts: ParsedComponents) => `${parts.get("year")}-${pad(parts.get("month")!)}-${pad(parts.get("day")!)}`;
const explicitDay = (parts: ParsedComponents) => parts.isCertain("day") || parts.isCertain("weekday");
const clock = (parts: ParsedComponents, text: string) => {
  if (!parts.isCertain("hour") || !(/\d[:.]\d{2}|\b(?:noon|midnight)\b|[ap]\.?m\.?\b/i.test(text) || parts.get("hour")! > 12)) return undefined;
  return `${pad(parts.get("hour")!)}:${pad(parts.get("minute") ?? 0)}`;
};
const addDays = (date: string, count: number) => new Date(Date.parse(`${date}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

/** Parse customer-authored dates, never a model's guessed or omitted window.
 * Read civil components in British English; checkout converts London clocks
 * to instants, including DST. Clock-only results cannot invent a rental date.
 */
export function rentalEnquiryWindow(messages: { role?: string; content?: unknown }[], today: string, subject = ""): Window {
  let window: Window = {};
  let duration: number | undefined;
  let rangeExplicit = false;
  const reference = new Date(`${today}T12:00:00Z`);
  const texts = [subject, ...messages.filter(x => x.role === "user").map(x => String(x.content ?? ""))].filter(Boolean);
  for (const text of texts) {
    const results = en.GB.parse(text, reference, { forwardDate: true }).filter(result => !/^(?:for\s+)?\d+\s+(?:days?|hours?|weeks?)$/i.test(result.text.trim()));
    const dates = [...new Set(results.flatMap(result => [result.start, result.end].filter((p): p is ParsedComponents => !!p && explicitDay(p)).map(day)))];
    if (dates.length > 2) { window = { ambiguous: true }; continue; }
    if (dates.length === 2) { window = { ...window, start: dates[0], end: dates[1], ambiguous: false }; rangeExplicit = true; duration = undefined; }
    if (dates.length === 1) {
      const result = results.find(x => explicitDay(x.start))!;
      const prefix = text.slice(Math.max(0, result.index - 35), result.index);
      if (/\b(?:return(?:ing)?|until|drop(?:ping)?\s*off|bring(?:ing)?\s*back)\b[^.!?]*$/i.test(prefix) && window.start) window = { ...window, end: dates[0], ambiguous: false };
      else {
        window = { ...window, start: dates[0], end: /\bweekend\b/i.test(result.text) ? addDays(dates[0], 1) : dates[0], ambiguous: /\bnext week\b/i.test(result.text) };
        rangeExplicit = /\bweekend\b/i.test(result.text);
      }
    }
    const clocks = results.flatMap(result => [result.start, result.end].flatMap((parts, index) => {
      if (!parts) return [];
      const value = clock(parts, result.text);
      if (!value) return [];
      const prefix = text.slice(Math.max(0, result.index - 55), result.index);
      const label = [...prefix.matchAll(/\b(?:return(?:ing)?|drop(?:ping)?\s*off|bring(?:ing)?\s*back|until|pick\s*up|pickup|collect(?:ion|ing)?)\b/gi)].at(-1)?.[0];
      const role = !label ? null : /return|drop|back|until/i.test(label) ? "returnTime" : "pickupTime";
      return [{ value, role, end: index === 1 }];
    }));
    if (clocks.length === 2) {
      window.pickupTime = (clocks.find(x => x.role === "pickupTime") ?? clocks[0]).value;
      window.returnTime = (clocks.find(x => x.role === "returnTime") ?? clocks[1]).value;
    }
    else if (clocks.length === 1) {
      const point = clocks[0];
      if (point.role) window[point.role as "pickupTime" | "returnTime"] = point.value;
      else if (point.end) window.returnTime = point.value;
      else if (dates.length === 1) window.pickupTime = point.value;
    } else if (clocks.length > 2) { window.pickupTime = undefined; window.returnTime = undefined; }
    const requestedDuration = text.match(/\bfor\s+(\d{1,2})\s+days?\b/i);
    if (requestedDuration && Number(requestedDuration[1]) > 0) duration = Number(requestedDuration[1]);
    if (duration && window.start && !rangeExplicit) {
      const overnight = window.pickupTime && window.returnTime && window.returnTime <= window.pickupTime ? 1 : 0;
      window.end = addDays(window.start, duration - 1 + overnight);
    }
  }
  return window.ambiguous ? { ambiguous: true } : window;
}
