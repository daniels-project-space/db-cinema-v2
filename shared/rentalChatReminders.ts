import { bookingStockLines, londonRentalInstant } from "./rentalWindow";

export type RentalChatReminderKind = "pickup" | "halfway" | "return";
export type RentalChatReminder = { kind: RentalChatReminderKind; dueAt: number; eventAt: number; lines: string[]; key: string };

export function rentalChatReminderPlan(booking: any): RentalChatReminder[] {
  if (!Array.isArray(booking?.lineItems) || !booking.lineItems.length) return [];
  const groups = new Map<string, RentalChatReminder>();
  const windows: Array<{ pickup: number; returned: number; line: string }> = [];
  const add = (kind: RentalChatReminderKind, dueAt: number, eventAt: number, line: string) => {
    const groupKey = `${kind}:${dueAt}:${eventAt}`;
    const group = groups.get(groupKey) ?? {kind, dueAt, eventAt, lines: [], key: ""};
    group.lines.push(line);
    groups.set(groupKey, group);
  };
  for (const item of bookingStockLines<any>(booking)) {
    if (!item.pickupTime || !item.returnTime || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end)) continue;
    let pickup: number, returned: number;
    try { pickup = londonRentalInstant(item.start,item.pickupTime); returned = londonRentalInstant(item.end,item.returnTime); }
    catch { continue; }
    if (returned <= pickup) continue;
    const line = JSON.stringify([String(item.listingId ?? ""),String(item.title ?? ""),item.qty ?? 1,pickup,returned]);
    windows.push({pickup,returned,line});
    add("pickup",pickup-3600000,pickup,line);
    add("return",returned-3600000,returned,line);
  }
  if (windows.length === booking.lineItems.length) {
    const start=Math.min(...windows.map(window=>window.pickup)),end=Math.max(...windows.map(window=>window.returned));
    const halfway=start+Math.floor((end-start)/2);
    for(const window of windows)add("halfway",halfway,halfway,window.line);
  }
  return [...groups.values()].map(group => ({...group,lines:group.lines.sort(),key:JSON.stringify([group.kind,group.dueAt,group.eventAt,group.lines.sort()])})).sort((left,right)=>left.dueAt-right.dueAt);
}
