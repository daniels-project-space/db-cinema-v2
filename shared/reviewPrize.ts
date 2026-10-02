export const REVIEW_PRIZE_GBP = 150;
export const REVIEW_PRIZE_TERMS = "review-stories-2026-10-v2";
export const REVIEW_SOCIAL = {
  platform: "Instagram",
  handle: "dbcinemarentalslondon",
  url: "https://www.instagram.com/dbcinemarentalslondon/",
};
export function reviewPrizeRound(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value),
    half = Number(parts.find((p) => p.type === "month")!.value) <= 6 ? 1 : 2;
  // UK June is BST; December is GMT. The entire closing minute is included.
  const deadline =
    half === 1
      ? Date.UTC(year, 5, 30, 22, 59, 59, 999)
      : Date.UTC(year, 11, 31, 23, 59, 59, 999);
  return {
    key: `${year}-H${half}`,
    deadline,
    announceBy: deadline + 14 * 86400000,
    payBy: deadline + 30 * 86400000,
  };
}
export const prizeDate = (time: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(time);
export function reviewPostUrl(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    !["instagram.com", "www.instagram.com"].includes(u.hostname) ||
    u.username ||
    u.password ||
    !/^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)
  )
    throw Error("Use the public Instagram post or reel link.");
  u.search = "";
  u.hash = "";
  return u.toString();
}
