/** Rental dates are civil labels, never arbitrary instants. Accept the UTC
 * midnight serialization used by older chat responses without shifting days. */
export function rentalDateLabel(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(value)) return;
  const label = value.slice(0, 10), at = Date.parse(label + "T00:00:00Z");
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === label ? label : undefined;
}
