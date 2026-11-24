const londonDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function londonDateKey(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("Invalid rental date.");
  const parts = londonDateFormatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isSameLondonRentalDay(pickupAt: number, now: number): boolean {
  return londonDateKey(pickupAt) === londonDateKey(now);
}

export function sameDayRentalFeePence(
  lines: { pickupAt: number; discountedEquipmentAmount: number }[],
  now: number,
): number {
  const sameDayPence = lines.reduce((sum, line) => {
    if (!isSameLondonRentalDay(line.pickupAt, now)) return sum;
    const amountPence = Math.round(line.discountedEquipmentAmount * 100);
    if (!Number.isFinite(line.discountedEquipmentAmount) || line.discountedEquipmentAmount < 0 || !Number.isSafeInteger(amountPence))
      throw new Error("Invalid same-day rental amount.");
    return sum + amountPence;
  }, 0);
  if (!Number.isSafeInteger(sameDayPence)) throw new Error("Invalid same-day rental total.");
  return Math.floor(sameDayPence / 10) + (sameDayPence % 10 >= 5 ? 1 : 0);
}
