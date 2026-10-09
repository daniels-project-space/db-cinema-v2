import { bookingStockLines, RENTAL_TIME_SLOTS, rentalWindow, type RentalWindowInput } from "./rentalWindow";

/** New clocks affect first collection and final return; intermediate handovers stay intact. */
export function rescheduledLines<T extends RentalWindowInput>(booking: { lineItems: T[]; pickupTime?: string | null; returnTime?: string | null }, start: number, end?: number, pickupTime?: string, returnTime?: string) {
  for (const clock of [pickupTime, returnTime]) if (clock !== undefined && !RENTAL_TIME_SLOTS.includes(clock)) throw Error("Choose a valid London collection or return time.");
  if (!booking.lineItems.length) throw Error("This rental has no equipment to reschedule.");
  const first=Math.min(...booking.lineItems.map(line=>line.start)),last=Math.max(...booking.lineItems.map(line=>line.end));
  const shift=start-first,endShift=end===undefined?0:end-(last+shift);
  const lines=bookingStockLines(booking).map(line=>({ ...line,start:line.start+shift,end:line.end+shift+endShift,
    ...(pickupTime!==undefined&&line.start===first?{pickupTime}:{}),
    ...(returnTime!==undefined&&line.end===last?{returnTime}:{}),
  }));
  for (const line of lines) rentalWindow(line);
  return {lines,endShift};
}
