import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken } from "./adminAuth";
import { hasFreshSharedStock } from "./lib/shared_stock_sync";
import { quote } from "./lib/pricing";
import { rentalPricingDays } from "../shared/rentalDuration";
import { buildEffectiveComponentAllocation } from "../shared/componentReplacement";
import { assertPhysicalRentalInventory, rentalInventoryDemands, RentalInventoryUnavailableError } from "./lib/rentalInventory";
import { blockedSet, dayRange } from "./availability";
import { stockRequest } from "./lib/stockRequest";

const selectionArgs = { listingId: v.id("listings"), originalMasterItemId: v.string(), replacementMasterItemId: v.string(), start: v.number(), end: v.number(), quantity: v.number(), pickupTime: v.optional(v.string()), returnTime: v.optional(v.string()), otherItems: v.optional(v.array(stockRequest)) };

export async function resolveReplacementStock(ctx: any, args: any) {
    if (!Number.isSafeInteger(args.start) || !Number.isSafeInteger(args.end) || args.end < args.start || args.end - args.start > 365 * 86400000)
      throw Error("Invalid rental dates.");
    if (!await hasFreshSharedStock(ctx)) throw Error("Rental Manager stock needs a fresh check.");
    const listing = await ctx.db.get(args.listingId);
    const evidence = listing?.componentReplacementEvidence;
    if (!listing || !listing.active || listing.suppressed || !evidence || evidence.checkoutAvailable !== false)
      throw Error("Reviewed substitution evidence is unavailable.");
    const rules = evidence.reviewedSubstitutions.filter((rule: any) => rule.originalMasterItemId === args.originalMasterItemId && rule.replacementMasterItemId === args.replacementMasterItemId);
    if (rules.length !== 1) throw Error("Reviewed substitution evidence is unavailable.");
    const rule = rules[0];
    if (!rule.declaredMissingOriginal && (listing.marketingOnly || listing.stockMappingStatus !== "complete"))
      throw Error("The original kit mapping needs review.");
    const sourceUnits = await Promise.all(rule.weights.map(async (weight: any) => {
      const rows = await ctx.db.query("inventory_units").withIndex("by_rmv2ItemId", (q: any) => q.eq("rmv2ItemId", weight.masterItemId)).take(2);
      const unit = rows.length === 1 ? rows[0] : null;
      if (!unit || unit.active !== true || !Number.isSafeInteger(unit.quantityOwned) || unit.quantityOwned < 1 || !Number.isFinite(unit.replacementCost) || unit.replacementCost <= 0)
        throw Error("The physical inventory mapping needs a fresh check.");
      if (weight.masterItemId === rule.replacementMasterItemId && (unit.quantityOwned !== rule.replacementInventory.quantityOwned || unit.replacementCost !== rule.replacementInventory.replacementCost))
        throw Error("The reviewed substitution inventory has changed.");
      return { unit, weight };
    }));
    const masterByLocal = new Map(sourceUnits.map(({ unit, weight }: any) => [String(unit._id), weight.masterItemId]));
    const components = listing.components.map((component: any) => ({ unitId: masterByLocal.get(String(component.inventoryUnitId)) ?? "", quantity: component.qty }));
    const days = rentalPricingDays(args.start, args.end, args.pickupTime, args.returnTime);
    const price = quote(listing.pricing, days).total;
    if (!Number.isSafeInteger(args.quantity) || args.quantity < 1 || args.quantity > 100 || (args.otherItems?.length ?? 0) > 99) throw Error("Invalid rental quantity.");
    const basePricePence = Math.round(price * 100) * args.quantity;
    const catalogueRevision = JSON.stringify({ components, rule });
    const allocation = buildEffectiveComponentAllocation({ listingId: String(args.listingId), catalogueRevision, components, kitQuantity: args.quantity, basePricePence,
      facts: sourceUnits.map(({ unit, weight }: any) => ({ unitId: weight.masterItemId, weightGrams: weight.weightGrams, replacementValuePence: Math.round(unit.replacementCost * 100) })),
      replacement: { id: `${rule.originalMasterItemId}:${rule.replacementMasterItemId}`, listingId: String(args.listingId), catalogueRevision, originalUnitId: rule.originalMasterItemId, replacementUnitId: rule.replacementMasterItemId, quantityPerKit: rule.quantityPerKit, priceAdjustmentPence: rule.priceAdjustmentPence, ...(rule.extensionAdjustmentPence ? { extensionAdjustmentPence: rule.extensionAdjustmentPence } : {}), active: true, ...(rule.declaredMissingOriginal ? { declaredMissingOriginal: {descriptorId: rule.declaredMissingOriginal.descriptorId, quantityPerKit: rule.declaredMissingOriginal.quantityPerKit} } : {}) } });
    const byMaster = new Map(sourceUnits.map(({ unit, weight }: any) => [weight.masterItemId, unit._id]));
    const originalName = rule.declaredMissingOriginal?.label ?? sourceUnits.find(({ weight }: any) => weight.masterItemId === rule.originalMasterItemId)?.unit.name;
    const replacementName = sourceUnits.find(({ weight }: any) => weight.masterItemId === rule.replacementMasterItemId)?.unit.name;
    if (typeof originalName !== "string" || !originalName.trim() || typeof replacementName !== "string" || !replacementName.trim()) throw Error("The component names need review.");
    const blocked = blockedSet(listing.unavailableDates ?? []);
    let kitStockAvailable = !dayRange(args.start, args.end).some(day => blocked.has(day));
    let basketStockAvailable = kitStockAvailable;
    const demands = allocation.components.map(component => ({ inventoryUnitId: byMaster.get(component.unitId), start: args.start, end: args.end, ...(args.pickupTime ? { pickupTime: args.pickupTime } : {}), ...(args.returnTime ? { returnTime: args.returnTime } : {}), qty: component.quantity }));
    if (kitStockAvailable) {
      try {
        await assertPhysicalRentalInventory(ctx, demands);
      } catch (error) {
        if (error instanceof RentalInventoryUnavailableError) kitStockAvailable = false;
        else throw error;
      }
    }
    basketStockAvailable = kitStockAvailable;
    if (kitStockAvailable && args.otherItems) {
      try { await assertPhysicalRentalInventory(ctx, [...demands, ...await rentalInventoryDemands(ctx, args.otherItems.map((item: any) => ({ ...item, qty: item.qty ?? 1 })))]); }
      catch (error) {
        if (error instanceof RentalInventoryUnavailableError) basketStockAvailable = false;
        else throw error;
      }
    }
    const deliverySpec = Number.isSafeInteger(listing.sizeScore) && listing.sizeScore >= 1 && listing.sizeScore <= 5 &&
      Number.isSafeInteger(rule.replacementSizeScore) && rule.replacementSizeScore >= 1 && rule.replacementSizeScore <= 5
      ? { sizeScore: Math.max(listing.sizeScore, rule.replacementSizeScore), weightKg: allocation.weightGrams / 1000, itemType: listing.itemType ?? "accessory" }
      : null;
    return { checkoutAvailable: false as const, stockAvailabilityChecked: false as const, kitStockAvailable, ...(args.otherItems ? { providedBasketStockAvailable: basketStockAvailable } : {}), basePricePence, allocation, componentNames: { original: originalName, replacement: replacementName }, deliverySpec, physicalDemands: demands };
}

export const preview = query({
  args: { token: v.string(), ...selectionArgs },
  handler: async (ctx, args) => {
    if (!checkAdminToken(args.token)) throw Error("Unauthorized");
    return resolveReplacementStock(ctx, args);
  },
});

export const resolveForPricing = internalQuery({
  args: selectionArgs,
  handler: resolveReplacementStock,
});
