import { v } from "convex/values";
import { stockRequest } from "./stockRequest";

export const replacementStockSelection = v.object({
  listingId: v.id("listings"), originalMasterItemId: v.string(), replacementMasterItemId: v.string(),
  start: v.number(), end: v.number(), quantity: v.number(), pickupTime: v.optional(v.string()),
  returnTime: v.optional(v.string()), otherItems: v.array(stockRequest),
});

export const replacementCatalogItems = v.array(v.object({ listingId: v.id("listings"), start: v.number(), end: v.number(), pickupTime: v.optional(v.string()), returnTime: v.optional(v.string()) }));

export const replacementCustomerOffer = v.object({
  version: v.literal(1), currency: v.literal("GBP"), customerEmail: v.string(), customerName: v.optional(v.string()), billingAddress: v.optional(v.string()),
  items: v.array(v.object({ listingId: v.id("listings"), title: v.string(), start: v.number(), end: v.number(), pickupTime: v.optional(v.string()), returnTime: v.optional(v.string()), quantity: v.number(), totalPence: v.number() })),
  replacementIndex: v.number(), originalComponentId: v.string(), replacementComponentId: v.string(), originalComponentName: v.string(), replacementComponentName: v.string(),
  subtotalPence: v.number(), discountPence: v.number(), deliveryPence: v.number(), sameDayFeePence: v.number(), membershipFeePence: v.number(), creditPence: v.number(), totalDuePence: v.number(), savedCardLimitPence: v.number(), securityPaymentPence: v.number(), securityHoldPence: v.number(), securityPolicyVersion: v.string(), securityWaiverReason: v.optional(v.string()), protection: v.union(v.literal("verify"),v.literal("deposit")), cancellationProtectionEnabled: v.boolean(),
  fulfilment: v.union(v.literal("pickup"), v.literal("delivery")),
  deliveryLegs: v.optional(v.union(v.literal("one_way"),v.literal("round_trip"))), deliveryAddress: v.optional(v.string()), deliveryPostcode: v.optional(v.string()), pickupTime: v.optional(v.string()), returnTime: v.optional(v.string()),
  documents: v.array(v.object({ kind: v.string(), version: v.string(), title: v.string() })),
});
