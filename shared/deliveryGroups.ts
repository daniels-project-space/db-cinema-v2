export type DeliveryDateGroup<TListingId extends string = string, TDate extends string | number = string | number> = {
  start: TDate;
  end: TDate;
  listingIds: TListingId[];
};

/** Items sharing the same rental window travel together for delivery pricing. */
export function groupDeliveryItems<TListingId extends string, TDate extends string | number>(
  items: readonly { listingId: TListingId; start: TDate; end: TDate }[],
): DeliveryDateGroup<TListingId, TDate>[] {
  const groups = new Map<string, DeliveryDateGroup<TListingId, TDate>>();
  for (const item of items) {
    const key = JSON.stringify([item.start, item.end]);
    const group = groups.get(key);
    if (group) group.listingIds.push(item.listingId);
    else groups.set(key, { start: item.start, end: item.end, listingIds: [item.listingId] });
  }
  const order = (date: string | number) => typeof date === "number" ? date : Date.parse(`${date}T00:00:00Z`);
  return [...groups.values()].sort((a, b) => order(a.start) - order(b.start) || order(a.end) - order(b.end));
}
