import { v } from "convex/values";
export const dateSourceLine=v.object({listingId:v.id("listings"),qty:v.number(),start:v.number(),end:v.number(),pickupTime:v.union(v.string(),v.null()),returnTime:v.union(v.string(),v.null())});
export const dateRequestSelection=v.object({start:v.number(),end:v.number(),pickupTime:v.string(),returnTime:v.string(),note:v.string(),source:v.array(dateSourceLine)});
