/** New kit additions are date-only; exact handover times belong to checkout. */
export function dateOnlyCartEntry<T extends { pickupTime?: string; returnTime?: string }>(item: T): Omit<T, "pickupTime" | "returnTime"> {
  const entry = { ...item };
  delete entry.pickupTime;
  delete entry.returnTime;
  return entry;
}
