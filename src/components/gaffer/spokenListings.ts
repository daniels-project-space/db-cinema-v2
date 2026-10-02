type Listing = { _id: string; title: string; slug?: string };
export type Mention = { id: string; start: number; end: number };
const normal = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
function aliases(title: string) {
  const name = normal(title),
    out = new Set([name, normal(title.split(/[+|]/)[0])]);
  for (const m of name.matchAll(
    /\b(?:fx\s*\d+|fs\s*\d+|a7\s*s?\s*(?:iii|ii|iv|3|4)|x\s*t\s*\d+|rs\s*\d+(?:\s*mini)?|ronin\s*(?:s\s*\d+|\d+)|venice(?:\s*\d+k)?|nanlite\s*(?:forza\s*)?\d+[a-z]*|aputure\s*\d+[a-z]*|blackmagic\s*\d+k(?:\s*pro)?|insta\s*360\s*x\d+)\b/g,
  ))
    out.add(m[0]);
  return [...out].filter((a) => a.length >= 3);
}
/** Resolve all named listings in speech order, preferring the current shortlist. */
export function listingMentions(
  text: string,
  listings: Listing[],
  preferred: string[] = [],
): Mention[] {
  const found: (Mention & { score: number })[] = [];
  for (const l of listings)
    for (const alias of aliases(l.title)) {
      const pattern = alias
        .split(" ")
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[\\s-]*");
      for (const m of text.matchAll(new RegExp(`\\b${pattern}\\b`, "gi")))
        found.push({
          id: l._id,
          start: m.index!,
          end: m.index! + m[0].length,
          score:
            alias.replace(/\s/g, "").length * 100 +
            (preferred.includes(l._id) ? 10000 : 0) -
            l.title.length / 1000,
        });
    }
  found.sort((a, b) => a.start - b.start || b.score - a.score);
  const result: Mention[] = [];
  for (const m of found) {
    if (result.some((r) => m.start < r.end && m.end > r.start)) continue;
    result.push({ id: m.id, start: m.start, end: m.end });
  }
  return result;
}
export type Alignment = {
  chars: string[];
  char_start_times_ms: number[];
  char_durations_ms: number[];
};
/** Queue actual provider character timings; interruption invalidates every task. */
export function createSpokenListingTracker(
  onMention: (id: string) => void,
  clock: {
    now: () => number;
    set: (fn: () => void, ms: number) => any;
    clear: (id: any) => void;
  } = { now: Date.now, set: setTimeout, clear: clearTimeout },
) {
  let carry = "",
    nextAt = 0,
    generation = 0;
  const timers = new Set<any>();
  return {
    reset() {
      generation++;
      carry = "";
      nextAt = 0;
      for (const t of timers) clock.clear(t);
      timers.clear();
    },
    alignment(a: Alignment, listings: Listing[], preferred: string[] = []) {
      if (
        !a?.chars?.length ||
        a.chars.length !== a.char_start_times_ms?.length ||
        a.chars.length !== a.char_durations_ms?.length ||
        [...a.char_start_times_ms, ...a.char_durations_ms].some(
          (n) => !Number.isFinite(n) || n < 0,
        )
      )
        return;
      const text = carry + a.chars.join(""),
        now = clock.now(),
        base = Math.max(now, nextAt),
        mine = generation;
      const positions: number[] = [];
      a.chars.forEach((char, i) => {
        for (let n = 0; n < char.length; n++)
          positions.push(a.char_start_times_ms[i]);
      });
      for (const m of listingMentions(text, listings, preferred).filter(
        (m) => m.end > carry.length,
      )) {
        const delay =
          base - now + (positions[Math.max(0, m.start - carry.length)] ?? 0);
        const t = clock.set(() => {
          timers.delete(t);
          if (mine === generation) onMention(m.id);
        }, delay);
        timers.add(t);
      }
      nextAt =
        base +
        Math.max(
          ...a.char_start_times_ms.map(
            (start, i) => start + a.char_durations_ms[i],
          ),
        );
      carry = text.slice(-160);
    },
  };
}
