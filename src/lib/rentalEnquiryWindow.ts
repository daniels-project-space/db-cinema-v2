import { en, type ParsedComponents } from "chrono-node";

type ClockWindow = { from: string; to: string };
type Window = { start?: string; end?: string; pickupTime?: string; returnTime?: string; pickupTimeWindow?: ClockWindow; returnTimeWindow?: ClockWindow; ambiguous?: boolean };
const pad = (n: number) => String(n).padStart(2, "0");
const day = (parts: ParsedComponents) => `${parts.get("year")}-${pad(parts.get("month")!)}-${pad(parts.get("day")!)}`;
const explicitDay = (parts: ParsedComponents) => parts.isCertain("day") || parts.isCertain("weekday");
const clock = (parts: ParsedComponents, text: string) => {
  if (!parts.isCertain("hour") || !(/\d[:.]\d{2}|\b(?:noon|midnight)\b|[ap]\.?m\.?\b/i.test(text) || parts.get("hour")! > 12)) return undefined;
  return `${pad(parts.get("hour")!)}:${pad(parts.get("minute") ?? 0)}`;
};
const addDays = (date: string, count: number) => new Date(Date.parse(`${date}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
const AFFIRMATIVE_REPLY_RE = /^\s*(?:yes|yeah|yep|correct|confirmed|that's\s+(?:right|correct)|that\s+works|those\s+dates\s+work)\b/i;
// A hyphenated pair such as "10-12 noon" is a clock window, not a numeric
// date. Only treat hyphenated input as an explicit date when it includes a
// year; slash/dot dates remain unambiguous without one.
const EXPLICIT_MONTH_OR_NUMERIC_DATE_RE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b|\b\d{1,2}-\d{1,2}-\d{2,4}\b|\b\d{4}-\d{1,2}-\d{1,2}\b/i;
const DATE_REFERENCE_RE = /\b(?:sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday|s)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|today|tomorrow|yesterday|next\s+week|this\s+weekend)\b|\b\d{1,2}(?:st|nd|rd|th)\b/i;

function mentionsDayOfDate(text: string, value: string): boolean {
  const date = new Date(`${value}T12:00:00Z`);
  const dayOfMonth = Number(value.slice(8));
  const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getUTCDay()];
  const shortWeekday = weekday.slice(0, 3);
  const weekdayAndDay = new RegExp(`\\b${shortWeekday}[a-z]*\\.?\\s+0?${dayOfMonth}(?:st|nd|rd|th)?\\b|\\b0?${dayOfMonth}(?:st|nd|rd|th)?\\s+${shortWeekday}[a-z]*\\b`, "i");
  const ordinalDay = new RegExp(`\\b0?${dayOfMonth}(?:st|nd|rd|th)\\b`, "i");
  return weekdayAndDay.test(text) || ordinalDay.test(text);
}

function timeWindowsFor(text: string): Partial<Pick<Window, "pickupTimeWindow" | "returnTimeWindow" | "pickupTime" | "returnTime">> {
  const ranges = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|\bto\b|\buntil\b)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|noon|midday|midnight)?/gi;
  const labels = /\b(return(?:ing)?|drop(?:ping)?\s*off|bring(?:ing)?\s*back|until)\b|\b(pick\s*up|pickup|collection|collect(?:ing)?)\b/gi;
  const result: ReturnType<typeof timeWindowsFor> = {};
  const period = (value?: string) => {
    const normalized = value?.toLowerCase().replace(/\./g, "");
    if (normalized === "noon" || normalized === "midday") return "pm";
    if (normalized === "midnight") return "am";
    return normalized;
  };
  const clock = (hour: number, minute: number, meridiem?: string) => {
    if (hour < 0 || hour > 12 || minute < 0 || minute > 59 || !meridiem) return undefined;
    const adjusted = meridiem === "pm" ? (hour % 12) + 12 : hour % 12;
    return `${pad(adjusted)}:${pad(minute)}`;
  };
  for (const match of text.matchAll(ranges)) {
    const before = text.slice(0, match.index);
    const priorLabels = [...before.matchAll(labels)];
    const priorLabel = priorLabels.at(-1);
    const role = priorLabel?.[1] ? "return" : priorLabel?.[2] ? "pickup" : null;
    if (!role) continue;
    const explicitEndPeriod = period(match[6]);
    const explicitStartPeriod = period(match[3]);
    const nearbyPeriod = period(before.slice(-28).match(/\b(a\.?m\.?|p\.?m\.?)\b/i)?.[1]);
    const fromHour = Number(match[1]);
    const toHour = Number(match[4]);
    const startPeriod = explicitStartPeriod ?? nearbyPeriod ?? (explicitEndPeriod
      ? explicitEndPeriod === "pm" && fromHour !== 12 && (fromHour > toHour && toHour !== 12 || toHour === 12) ? "am"
        : explicitEndPeriod === "am" && fromHour > toHour ? "pm"
        : explicitEndPeriod === "pm" && (match[6]?.toLowerCase() === "noon" || match[6]?.toLowerCase() === "midday") ? "am"
            : explicitEndPeriod
      : undefined);
    const endPeriod = explicitEndPeriod ?? nearbyPeriod ?? (startPeriod && toHour === 12 && startPeriod === "am" ? "pm" : startPeriod);
    const from = clock(fromHour, Number(match[2] ?? 0), startPeriod);
    const to = clock(toHour, Number(match[5] ?? 0), endPeriod);
    if (!from || !to || to < from) continue;
    const key = role === "pickup" ? "pickupTimeWindow" : "returnTimeWindow";
    const timeKey = role === "pickup" ? "pickupTime" : "returnTime";
    result[key] = { from, to };
    // Availability and pricing must cover the full stated interval: use the
    // earliest pickup and latest return as the conservative rental envelope.
    result[timeKey] = role === "pickup" ? from : to;
  }
  return result;
}

/** Parse customer-authored dates, never a model's guessed or omitted window.
 * Read civil components in British English; checkout converts London clocks
 * to instants, including DST. Clock-only results cannot invent a rental date.
 */
export function rentalEnquiryWindow(messages: { role?: string; content?: unknown }[], today: string, subject = ""): Window {
  let window: Window = {};
  let duration: number | undefined;
  let rangeExplicit = false;
  const reference = new Date(`${today}T12:00:00Z`);
  const userMessages = messages.filter(x => x.role === "user");
  const latestUserText = String(userMessages.at(-1)?.content ?? "");
  const texts = [subject, ...userMessages.map(x => String(x.content ?? ""))].filter(Boolean);
  for (const text of texts) {
    // Chrono reads "the day" in "the day rate" as tomorrow. Mask billing
    // terminology without moving the offsets used to associate real clocks.
    const temporalText = text.replace(/\b(?:(?:the|a)\s+)?(?:(?:(?:multi|\d+)[-\s]*)?(?:day|week|month)|daily|weekly|monthly)[-\s]+(?:rates?|prices?|pricing|discounts?|thresholds?)\b/gi, phrase => " ".repeat(phrase.length));
    const parse = (value: string, offset = 0) => en.GB.parse(value, reference, { forwardDate: true })
      .filter(result => !/^(?:for\s+)?\d+\s+(?:days?|hours?|weeks?)$/i.test(result.text.trim()))
      .map(result => ({ ...result, index: result.index + offset }));
    let results = parse(temporalText);
    // Chrono can discard both clocks and the second written date when merging
    // "9 November at 10:00 until 10 November at 09:00". Independently parse
    // explicitly dated endpoints, retaining offsets for pickup/return labels.
    // Shared-month ranges and clock-only clauses keep the original parse.
    const separators = [...temporalText.matchAll(/\b(?:until|to|till|through)\b/gi)];
    if (separators.length) {
      const points = [0, ...separators.map(match => match.index! + match[0].length)];
      const pieces = points.map((offset, index) => parse(temporalText.slice(offset, separators[index]?.index ?? temporalText.length), offset));
      if (pieces.filter(piece => piece.some(result => explicitDay(result.start))).length >= 2) {
        const segmented = pieces.flat();
        const evidence = (items: typeof results) => items.flatMap(result => [result.start, result.end].filter((part): part is ParsedComponents => !!part))
          .reduce((total, part) => total + Number(explicitDay(part)) + Number(part.isCertain("hour")), 0);
        if (evidence(segmented) > evidence(results)) results = segmented;
      }
    }
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
    const timeWindows = timeWindowsFor(text);
    if (timeWindows.pickupTimeWindow) Object.assign(window, { pickupTimeWindow: timeWindows.pickupTimeWindow, pickupTime: timeWindows.pickupTimeWindow.from });
    else if (clocks.some(point => point.role === "pickupTime")) delete window.pickupTimeWindow;
    if (timeWindows.returnTimeWindow) Object.assign(window, { returnTimeWindow: timeWindows.returnTimeWindow, returnTime: timeWindows.returnTimeWindow.to });
    else if (clocks.some(point => point.role === "returnTime")) delete window.returnTimeWindow;
    const requestedDuration = text.match(/\bfor\s+(\d{1,2})\s+days?\b/i);
    if (requestedDuration && Number(requestedDuration[1]) > 0) duration = Number(requestedDuration[1]);
    if (duration && window.start && !rangeExplicit) {
      const overnight = window.pickupTime && window.returnTime && window.returnTime <= window.pickupTime ? 1 : 0;
      window.end = addDays(window.start, duration - 1 + overnight);
    }
  }

  // A renter may simply confirm the exact dates we proposed in the previous
  // reply, then repeat only weekdays and day-of-month ("Yes, Sat 14th ...
  // Weds 18th"). Resolve those incomplete dates from that single confirmed
  // proposal instead of letting Chrono roll the weekday to the next match.
  if (AFFIRMATIVE_REPLY_RE.test(latestUserText) && !EXPLICIT_MONTH_OR_NUMERIC_DATE_RE.test(latestUserText)) {
    const latestUserIndex = messages.length - 1 - [...messages].reverse().findIndex(message => message.role === "user");
    const precedingAssistant = messages.slice(0, Math.max(0, latestUserIndex)).reverse().find(message => message.role === "assistant");
    const proposalText = String(precedingAssistant?.content ?? "");
    const isOneProposedRange = !/\bor\b/i.test(proposalText) &&
      (/\b(?:from|until|through)\b[\s\S]{0,120}\bto\b/i.test(proposalText) ||
        /\b(?:pickup|pick\s*up|collection|collect)\b[\s\S]{0,120}\b(?:return|drop(?:ping)?\s*off|bring(?:ing)?\s*back)\b/i.test(proposalText));
    if (precedingAssistant && isOneProposedRange) {
      const proposed = rentalEnquiryWindow([{ role: "user", content: proposalText }], today);
      const hasDateReference = DATE_REFERENCE_RE.test(latestUserText);
      const confirmedDays = !hasDateReference || (!!proposed.start && !!proposed.end &&
        mentionsDayOfDate(latestUserText, proposed.start) && mentionsDayOfDate(latestUserText, proposed.end));
      if (proposed.start && proposed.end && !proposed.ambiguous && proposed.start !== proposed.end && confirmedDays) {
        window = { ...window, start: proposed.start, end: proposed.end, ambiguous: false };
      }
    }
  }
  return window.ambiguous ? { ambiguous: true } : window;
}
