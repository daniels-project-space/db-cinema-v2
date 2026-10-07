export type InspectionInput = { key: string; condition: "good" | "issue"; details: string; openCase: boolean };
export type InspectionItem = { key: string; title: string; sku?: string; inventoryUnitId?: string };
/** Freeze the server's equipment identity, never accept client-supplied titles. */
export function normalizeReturnInspection(schedule: InspectionItem[], input: InspectionInput[], damage: number) {
  if (!schedule.length || schedule.length !== input.length || new Set(input.map(i => i.key)).size !== input.length) throw Error("Inspect every individual item before confirming the return.");
  const byKey = new Map(input.map(i => [i.key, i]));
  const records = schedule.map(item => {
    const entry = byKey.get(item.key);
    if (!entry || !["good", "issue"].includes(entry.condition)) throw Error("Inspect every individual item before confirming the return.");
    const details = entry.details.trim();
    if (details.length > 2000 || (entry.condition === "issue" && details.length < 10)) throw Error("Describe the issue and evidence for each affected item (10–2000 characters).");
    if (entry.condition === "good" && (details || entry.openCase)) throw Error("An item in good condition cannot have an issue or damage case.");
    return { key: item.key, title: item.title, ...(item.sku ? { sku: item.sku } : {}), ...(item.inventoryUnitId ? { inventoryUnitId: item.inventoryUnitId } : {}), condition: entry.condition, details, openCase: entry.openCase };
  });
  if (damage > 0 && !records.some(i => i.condition === "issue")) throw Error("A damage deduction needs at least one inspected item with an issue.");
  return records;
}
