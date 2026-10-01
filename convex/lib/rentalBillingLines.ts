/** Fulfilment amendments never erase a captured charge from a receipt. */
export function rentalBillingLines(b: { lineItems: any[]; removedItems?: any[] }) {
  return [...b.lineItems, ...(b.removedItems ?? []).map(l => ({ ...l, title: `${l.title} (removed from kit; original agreed charge)` }))]
    .map(l => ({ title: l.title, start: l.start, end: l.end, qty: l.qty, lineTotal: l.lineTotal }));
}
