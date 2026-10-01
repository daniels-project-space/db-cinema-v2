import { accountForToken } from "./rentalChat";
import { assertRentalInventory } from "./rentalInventory";
import { quote } from "./pricing";
import { listingImages } from "./catalogImages";
export const DAY = 86400000;
export function londonDay(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (name: string) => parts.find((p) => p.type === name)!.value;
  return Date.parse(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`);
}
export function dates(start: number, end: number) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start % DAY ||
    end % DAY ||
    start < londonDay() ||
    end < start ||
    end - start > 365 * DAY ||
    start > londonDay() + 730 * DAY
  )
    throw new Error("Choose valid upcoming dates (up to one year per rental).");
}
export function linesValid(lines: any[]) {
  if (
    !lines.length ||
    lines.length > 50 ||
    lines.some(
      (l) => !Number.isSafeInteger(l.qty) || l.qty < 1 || l.qty > 20,
    ) ||
    lines.reduce((n, l) => n + l.qty, 0) > 100
  )
    throw new Error("Choose 1–100 items with whole quantities.");
}
export async function requireAccount(ctx: any, token: string) {
  const account = await accountForToken(ctx, token);
  if (!account) throw new Error("Please sign in again.");
  return account;
}
export async function kitDetails(ctx: any, lines: any[]) {
  return Promise.all(
    lines.map(async (line) => {
      const l = await ctx.db.get(line.listingId);
      return {
        listingId: line.listingId,
        qty: line.qty,
        title: l?.title ?? "Unavailable item",
        slug: l?.slug ?? "",
        heroImage: l ? (listingImages(l)[0] ?? null) : null,
      };
    }),
  );
}
export async function previewKit(
  ctx: any,
  lines: any[],
  start: number,
  end: number,
) {
  dates(start, end);
  linesValid(lines);
  const days = (end - start) / DAY + 1;
  const priced = await Promise.all(
    lines.map(async (line) => {
      const l = await ctx.db.get(line.listingId);
      if (!l?.active || l.suppressed)
        throw new Error(`${l?.title ?? "An item"} is no longer available.`);
      if (days < (l.minimumRentalDays ?? 1))
        throw new Error(
          `${l.title} needs at least ${l.minimumRentalDays} days.`,
        );
      const q = quote(l.pricing, days);
      const total = l.quietDeal
        ? Math.round(q.total * (1 - l.quietDeal / 100))
        : q.total;
      return {
        ...line,
        title: l.title,
        slug: l.slug,
        heroImage: listingImages(l)[0] ?? null,
        start: new Date(start).toISOString().slice(0, 10),
        end: new Date(end).toISOString().slice(0, 10),
        days,
        perDay: total / days,
        total,
        deposit: l.depositAmount ?? 0,
      };
    }),
  );
  let available = true,
    issue = "";
  try {
    await assertRentalInventory(
      ctx,
      lines.map((l) => ({ ...l, start, end })),
    );
  } catch (e) {
    available = false;
    issue = (e as Error).message;
  }
  return {
    lines: priced,
    available,
    issue,
    subtotal: priced.reduce((n, l) => n + l.total * l.qty, 0),
  };
}
