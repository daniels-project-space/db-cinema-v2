import { peak } from "../availability";
import type { InspectionItem } from "../../shared/returnInspection";

/** Use the rental's own reserved inventory, not today's editable kit contents. */
export async function returnInspectionSchedule(ctx: any, booking: any): Promise<InspectionItem[]> {
  if (booking.returnDecision?.inspection) return booking.returnDecision.inspection.map(({ key, title, sku, inventoryUnitId }: any) => ({ key, title, ...(sku ? { sku } : {}), ...(inventoryUnitId ? { inventoryUnitId } : {}) }));
  const reservations = (await ctx.db.query("reservations").withIndex("by_booking", (q: any) => q.eq("bookingId", booking._id)).collect()).filter((r: any) => ["confirmed", "active", "returned"].includes(r.status));
  const groups = new Map<string, any[]>();
  for (const row of reservations) groups.set(String(row.inventoryUnitId), [...(groups.get(String(row.inventoryUnitId)) ?? []), row]);
  const items: { key: string; title: string; sku?: string; inventoryUnitId?: any }[] = [];
  for (const [id, rows] of groups) {
    const unit = await ctx.db.get(rows[0].inventoryUnitId);
    if (!unit) throw Error("A reserved equipment record is missing. Restore it before completing inspection.");
    const quantity = peak(rows);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || items.length + quantity > 500) throw Error("The rental equipment schedule needs manual reconciliation before inspection.");
    for (let index = 0; index < quantity; index++) items.push({ key: `${id}:${index}`, inventoryUnitId: unit._id, title: `${unit.name}${quantity > 1 ? ` · item ${index + 1} of ${quantity}` : ""}`, ...(unit.sku ? { sku: unit.sku } : {}) });
  }
  // Legacy rentals without a physical inventory ledger retain their booked
  // listing identity; they are explicitly labelled as booked-item inspections.
  if (!items.length) for (let line = 0; line < booking.lineItems.length; line++) {
    const item = booking.lineItems[line];
    if (!Number.isSafeInteger(item.qty) || item.qty < 1 || items.length + item.qty > 500) throw Error("The booked item quantities need reconciliation before inspection.");
    for (let index = 0; index < item.qty; index++) items.push({ key: `legacy:${line}:${index}`, title: `${item.title}${item.qty > 1 ? ` · item ${index + 1} of ${item.qty}` : ""}` });
  }
  return items.sort((a, b) => a.key.localeCompare(b.key));
}
