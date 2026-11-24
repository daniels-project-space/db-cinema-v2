export function normalizeRentalLineTimes<T extends {pickupTime?: string; returnTime?: string}>(lines: T[], times: {pickupTime?: string; returnTime?: string}): T[] {
  return lines.map(line => ({ ...line, pickupTime: line.pickupTime ?? times.pickupTime, returnTime: line.returnTime ?? times.returnTime }));
}
