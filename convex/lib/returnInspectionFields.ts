import { v } from "convex/values";
export const inspectionInput = v.object({ key: v.string(), condition: v.union(v.literal("good"), v.literal("issue")), details: v.string(), openCase: v.boolean() });
export const inspectionRecord = v.object({ key: v.string(), title: v.string(), sku: v.optional(v.string()), inventoryUnitId: v.optional(v.id("inventory_units")), condition: v.union(v.literal("good"), v.literal("issue")), details: v.string(), openCase: v.boolean() });
