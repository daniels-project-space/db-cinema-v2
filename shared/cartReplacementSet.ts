/** One atomic change. Reject stale suggestions; never erase intervening edits. */
export function switchCartSet<T extends { key: string; start: string; end: string }>(current: T[], expected: string, keys: string[], replacements: T[]): T[] {
  if (JSON.stringify(current) !== expected) throw Error("Your basket changed. Check the alternatives again.");
  const originals = current.filter(i => keys.includes(i.key));
  if (!keys.length || originals.length !== keys.length || !replacements.length) throw Error("This replacement is no longer valid.");
  if (replacements.some(i => i.start !== originals[0].start || i.end !== originals[0].end) || originals.some(i => i.start !== originals[0].start || i.end !== originals[0].end)) throw Error("Replacement dates must match your selected period.");
  const next = [...current.filter(i => !keys.includes(i.key)), ...replacements];
  if (new Set(next.map(i => i.key)).size !== next.length) throw Error("Replacement keys must be unique.");
  return next;
}

/** Individual additions preserve the original unavailable request for review. */
export function addCartReplacement<T extends { key: string; start: string; end: string }>(current: T[], expected: string, sourceKey: string, replacement: T): T[] {
  if (JSON.stringify(current) !== expected) throw Error("Your basket changed. Check the alternatives again.");
  const source = current.find(i => i.key === sourceKey);
  if (!source || current.length >= 100 || current.some(i => i.key === replacement.key)) throw Error("This replacement is no longer valid.");
  if (replacement.start !== source.start || replacement.end !== source.end) throw Error("Replacement dates must match your selected period.");
  return [...current, replacement];
}
