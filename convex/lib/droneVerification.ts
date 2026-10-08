/** Classify the current kit, including drones nested inside a bundle. */
export async function requiresDroneLicence(ctx: any, booking: any): Promise<boolean> {
  for (const line of booking.lineItems ?? []) {
    const listing = await ctx.db.get(line.listingId);
    if (listing?.itemType === "drone" || /^drones?$/i.test(listing?.category ?? "")) return true;
    for (const component of listing?.components ?? []) {
      const unit = await ctx.db.get(component.inventoryUnitId);
      if (/\b(drone|mavic|inspire|avata|dji mini|dji air|fpv)\b/i.test(unit?.name ?? "")) return true;
    }
  }
  return false;
}

export async function assertDroneApproval(ctx: any, booking: any) {
  if (await requiresDroneLicence(ctx, booking) &&
      (!booking.droneLicenceStorageId || booking.droneLicenceStatus !== "approved"))
    throw Error("A drone operator licence must be uploaded and approved by the team before handover.");
}
