import { quote } from "./pricing";
import { weekendDays } from "../../shared/membership";
import { rentalPricingDays } from "../../shared/rentalDuration";
import { isMarketingOnly } from "./marketingInventory";
import { deriveItemType } from "./taxonomy";

export async function repriceRentalLines(ctx: any, items: { listingId: any; start: number; end: number; pickupTime?: string; returnTime?: string; offerType?: string }[]) {
  const listings = await Promise.all(items.map(item => ctx.db.get(item.listingId)));
  return items.map((item, index) => {
    const listing: any = listings[index];
    if (!listing || !listing.active) return null;
    const days = rentalPricingDays(item.start, item.end, item.pickupTime, item.returnTime);
    const priced = quote(listing.pricing, days);
    return { title: listing.title, total: priced.total, deposit: listing.depositAmount ?? 0, dailyRate: quote(listing.pricing, 1).perDay,
      weekendSaving: weekendDays(item.start, item.end) ? Math.max(0, priced.total - quote(listing.pricing, days - 1).total) : 0,
      itemType: listing.itemType ?? deriveItemType(listing.title), catalogItemType: listing.itemType ?? null, sizeScore: listing.sizeScore ?? 2, weightKg: listing.weightKg ?? 1, category: listing.category, specs: listing.specs ?? null,
      components: listing.components ?? [], inventoryFacts: listing.inventoryFacts ?? null, rentalContents: listing.rentalContents ?? null,
      verifiedComponentContents: listing.verifiedComponentContents ?? [], marketingOnly: isMarketingOnly(listing),
      displayOnly: !!listing.suppressed && !isMarketingOnly(listing), stockMappingStatus: listing.stockMappingStatus };
  });
}
