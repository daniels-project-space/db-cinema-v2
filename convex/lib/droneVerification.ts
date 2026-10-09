import { documentCopyAvailable, archiveRetention } from "../verificationArchive";
/** A drone accessory alone is not an aircraft rental. A named aircraft with
 * batteries/filters included remains a drone rental. */
export function isDroneAccessoryName(name: string) {
  if (/\bfly\s*more\b|\bcombo\b/i.test(name)) return false;
  const head = name.split(/\s+(?:with|including|includes|incl\.?)\s+|\s*\+\s*/i)[0];
  return /\b(batter(?:y|ies)|chargers?|filters?|goggles|propellers?|controllers?|remotes?|monitors?|cases?|bags?|spares?|accessor(?:y|ies)|cables?|zenmuse)\b|\bfpv\s+camera\b|\bcamera\s+for\b/i.test(head);
}

export function isDroneAircraftName(name: string) {
  return !isDroneAccessoryName(name) && /\b(drone|quadcopter|hexacopter|uav|mavic|dji\s+inspire(?:\s*[123])?|inspire\s*[123]|avata|dji\s+mini\s*[2345]|dji\s+air\s*[23]s?|fpv|dji\s+phantom|dji\s+neo|dji\s+flip)\b/i.test(name);
}

/** Classify the current kit, including actual aircraft nested inside a bundle. */
export async function requiresDroneLicence(ctx: any, booking: any): Promise<boolean> {
  for (const line of booking.lineItems ?? []) {
    const listing = await ctx.db.get(line.listingId);
    // A typed camera/gimbal takes precedence over a stale category label.
    if ((listing?.itemType === "drone" || !listing?.itemType && /^drones?$/i.test(listing?.category ?? "")) &&
        !isDroneAccessoryName(listing?.title ?? "")) return true;
    for (const component of listing?.components ?? []) {
      const unit = await ctx.db.get(component.inventoryUnitId);
      if (isDroneAircraftName(unit?.name ?? "")) return true;
    }
  }
  return false;
}

export async function assertDroneApproval(ctx: any, booking: any) {
  if (!await requiresDroneLicence(ctx, booking)) return;
  if (!booking.droneLicenceStorageId || !booking.droneLicenceDocumentId || booking.droneLicenceStatus !== "approved")
    throw Error("A drone operator licence must be uploaded and approved by the team before handover.");
  const document = await ctx.db.get(booking.droneLicenceDocumentId);
  const archive = document ? await ctx.db.get(document.archiveId) : null;
  if (!document || !archive || archive.source !== "drone" || archive.bookingId !== booking._id ||
      archive.accountId !== booking.accountId || document.kind !== "drone-operator-licence" ||
      document.storageId !== booking.droneLicenceStorageId || !(await archiveRetention(ctx, archive)).viewable ||
      !(await documentCopyAvailable(ctx, archive, document)))
    throw Error("The approved drone licence copy is missing or invalid. Ask the renter to upload a new copy before handover.");
}

/** Expose current saved-file readiness without rewriting the human decision. */
export async function droneLicenceStatusForRental(ctx: any, booking: any) {
  if (booking.droneLicenceStatus === "approved") {
    try { await assertDroneApproval(ctx, booking); } catch { return "requires_input"; }
  }
  return booking.droneLicenceStatus ?? "required";
}
