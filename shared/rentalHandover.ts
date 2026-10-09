import { bookingStockLines, dateLabel, type RentalWindowInput } from "./rentalWindow";

export function rentalClockLabel(time?: string | null) {
  return typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "Time to confirm";
}

/** Display the same inherited/explicit clocks used for stock. Never replace an
 * explicitly unknown line time with the booking-wide time or a default. */
export function rentalHandoverLabel(booking: {lineItems:RentalWindowInput[];pickupTime?:string|null;returnTime?:string|null}, kind:"pickup"|"return") {
  const groups = new Map<string, {day:number;time:string}>();
  for (const line of bookingStockLines(booking)) {
    const day = dateLabel(kind === "pickup" ? line.start : line.end);
    const time = rentalClockLabel(kind === "pickup" ? line.pickupTime : line.returnTime);
    groups.set(JSON.stringify([day,time]), {day,time});
  }
  if (!groups.size) return "Dates need review";
  const rows=[...groups.values()].sort((a,b)=>a.day-b.day||a.time.localeCompare(b.time));
  return rows.map(row=>rows.length===1?row.time:`${new Date(row.day).toLocaleDateString("en-GB",{timeZone:"UTC",day:"numeric",month:"short",year:"numeric"})} · ${row.time}`).join(" / ");
}
