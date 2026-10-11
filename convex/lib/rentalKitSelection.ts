import type { Infer } from "convex/values";
import { kitRequestInput, kitRequestSnapshot } from "./rentalKitSelectionFields";
export { kitRequestInput } from "./rentalKitSelectionFields";
import type { Doc } from "../_generated/dataModel";
import { rentalRequestDetail } from "../../src/lib/rentalRequestDraft";

export function requestableListing(listing: Doc<"listings"> | null) {
  return !!listing && listing.active && !listing.suppressed && !listing.marketingOnly && listing.components.length > 0 && !["incomplete", "not_owned"].includes(listing.stockMappingStatus ?? "");
}
export function sameKitInput(saved: Infer<typeof kitRequestSnapshot> | undefined, input: Infer<typeof kitRequestInput> | undefined) {
  const sameSource = !saved?.source && !input?.source || !!saved?.source && !!input?.source && saved.source.listingId === input.source.listingId && saved.source.qty === input.source.qty && saved.source.start === input.source.start && saved.source.end === input.source.end;
  return !saved && !input || !!saved && !!input && saved.change === input.change && saved.listingId === input.listingId && saved.lineIndex === input.lineIndex && saved.quantity === input.quantity && saved.note === input.note.trim() && sameSource;
}
export async function resolveKitRequest(ctx: { db: { get: (id: any) => Promise<any> } }, booking: Doc<"bookings">, input: Infer<typeof kitRequestInput>) {
  if (input.change === "add" && (input.lineIndex !== undefined || input.source !== undefined) || input.change === "remove" && input.listingId !== undefined) throw Error("This equipment selection does not match the request.");
  const source = input.change !== "add" && Number.isSafeInteger(input.lineIndex) && input.lineIndex! >= 0 ? booking.lineItems[input.lineIndex!] : undefined;
  if (input.change !== "add" && !source) throw Error("Choose an item from your current kit.");
  if (source && (!input.source || input.source.listingId !== source.listingId || input.source.qty !== source.qty || input.source.start !== source.start || input.source.end !== source.end)) throw Error("Your current kit changed. Reopen the request and choose the item again.");
  const addition = input.change !== "remove" && input.listingId ? await ctx.db.get(input.listingId) as Doc<"listings"> | null : null;
  if (input.change !== "remove" && !requestableListing(addition)) throw Error("This equipment can no longer be requested. Choose another item or message the team.");
  if(input.change==="swap"&&input.listingId===source?.listingId)throw Error("Choose a different item for the equipment swap.");
  const detail = rentalRequestDetail({ kind: "items", note: input.note, change: input.change, qty: input.quantity, item: source?.title, currentQty: source?.qty, addition: addition?.title });
  const snapshot: Infer<typeof kitRequestSnapshot> = { ...input, note: input.note.trim(),
    ...(addition ? { additionTitle: addition.title } : {}),
    ...(source ? { sourceTitle: source.title, sourceListingId: source.listingId, sourceQty: source.qty, sourceStart: source.start, sourceEnd: source.end } : {}),
  };
  return { detail, snapshot };
}
