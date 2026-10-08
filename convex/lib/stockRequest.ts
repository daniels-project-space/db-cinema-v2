import { v } from "convex/values";
export const stockRequestFields={listingId:v.id("listings"),start:v.number(),end:v.number(),pickupTime:v.optional(v.union(v.string(),v.null())),returnTime:v.optional(v.union(v.string(),v.null())),qty:v.optional(v.number())};
export const stockRequest=v.object(stockRequestFields);
