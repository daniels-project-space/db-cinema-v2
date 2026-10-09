import { isAllowedReturnTime } from "./site";

export type RentalRequestDraft = {
  kind: "dates" | "items" | "cancel";
  note: string;
  start?: string; end?: string; pickup?: string; dropoff?: string;
  change?: "add" | "swap" | "remove";
  item?: string; addition?: string; qty?: number; currentQty?: number;
};
function calendarDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) throw Error("Choose valid collection and return dates.");
  return value;
}
/** Requests remain human-readable in the actual account-bound approval thread. */
export function rentalRequestDetail(draft: RentalRequestDraft): string {
  const note = draft.note.trim();
  if (note.length < 5) throw Error("Add a note for the team in at least 5 characters.");
  let text = note;
  if (draft.kind === "dates") {
    const start = calendarDate(draft.start), end = calendarDate(draft.end);
    if (end < start) throw Error("Return cannot be before collection.");
    if (!isAllowedReturnTime(draft.pickup ?? "") || !isAllowedReturnTime(draft.dropoff ?? "")) throw Error("Choose collection and return times between 09:00 and 22:00.");
    if (end === start && draft.dropoff! <= draft.pickup!) throw Error("Return time must be after collection.");
    text = `Requested collection: ${start} at ${draft.pickup}. Requested return: ${end} at ${draft.dropoff}. All times London.\n${note}`;
  } else if (draft.kind === "items") {
    if (!draft.change || !Number.isSafeInteger(draft.qty) || draft.qty! < 1 || draft.qty! > 99) throw Error("Choose a quantity from 1 to 99.");
    if (draft.change !== "add" && (!draft.item || draft.qty! > (draft.currentQty ?? 0))) throw Error("Choose an item and quantity from your current kit.");
    if (draft.change !== "remove" && !draft.addition?.trim()) throw Error("Name the equipment you would like to request.");
    text = draft.change === "add" ? `Add ${draft.qty}× ${draft.addition!.trim()}.` : draft.change === "remove" ? `Remove ${draft.qty}× ${draft.item}.` : `Swap ${draft.qty}× ${draft.item} for ${draft.qty}× ${draft.addition!.trim()}.`;
    text += `\n${note}`;
  }
  if (text.length > 1000) throw Error("Shorten your request to 1000 characters including equipment and dates.");
  return text;
}
