/** Checkout bills individual units. Preserve quantities without the normal
 * single-listing add() de-duplication silently dropping the rest of a kit. */
export function expandKitCart(lines: any[]) {
  return lines.flatMap((line, index) =>
    Array.from({ length: line.qty }, (_, unit) => {
      const { qty, ...item } = line;
      return {
        ...item,
        key: `${item.listingId}|${item.start}|${item.days}|kit-${index}-${unit}`,
      };
    }),
  );
}
export function mergeKitLines(lines: { listingId: string; qty: number }[]) {
  const counts = new Map<string, number>();
  for (const l of lines)
    counts.set(l.listingId, (counts.get(l.listingId) ?? 0) + l.qty);
  return [...counts].map(([listingId, qty]) => ({ listingId, qty }));
}
