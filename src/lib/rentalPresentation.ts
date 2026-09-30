export const RENTAL_STAGES = [
  "pending_payment",
  "confirmed",
  "active",
  "returned",
  "cancelled",
] as const;
export const RENTAL_STAGE_LABELS: Record<string, string> = {
  pending_payment: "Awaiting payment",
  confirmed: "Upcoming",
  active: "On hire",
  returned: "Returned",
  cancelled: "Cancelled",
};
export function rentalTitle(title: string): string {
  const first = title.split(/\s+\+\s+|\s*\|\s*|\s*\(/)[0].trim();
  const words = first.split(/\s+/);
  return words.length > 8 ? words.slice(0, 8).join(" ") + "…" : first;
}
export function rentalDate(start: number, end: number): string {
  const f = (d: number) =>
    new Date(d).toLocaleDateString("en-GB", {
      timeZone: "Europe/London",
      day: "numeric",
      month: "short",
    });
  return `${f(start)} – ${f(end)}`;
}
