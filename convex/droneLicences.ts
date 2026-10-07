import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { accountForToken, ownedBooking } from "./lib/rentalChat";
import { requiresDroneLicence } from "./lib/droneVerification";
import { securityReady } from "../shared/verificationProgress";

const access = { bookingId: v.id("bookings"), token: v.optional(v.string()), checkoutSessionId: v.optional(v.string()) };
async function renterBooking(ctx: any, args: any) {
  const booking = await ctx.db.get(args.bookingId);
  if (!booking) throw Error("Rental not found.");
  const account = args.token ? await accountForToken(ctx, args.token) : null;
  if (account) await ownedBooking(ctx, account, booking._id);
  else if (!args.checkoutSessionId || args.checkoutSessionId !== booking.stripeCheckoutSessionId || booking.status !== "confirmed") throw Error("Sign in to the account linked to this rental.");
  if (booking.status !== "confirmed" || !securityReady(booking)) throw Error("Upload documents after payment and security, before collection.");
  if (!await requiresDroneLicence(ctx, booking)) throw Error("This rental does not require a drone licence.");
  return booking;
}
export const uploadUrl = mutation({ args: access, handler: async (ctx, args) => {
  await renterBooking(ctx, args);
  return ctx.storage.generateUploadUrl();
} });
export const submit = mutation({ args: { ...access, storageId: v.id("_storage") }, handler: async (ctx, args) => {
  const booking = await renterBooking(ctx, args);
  const metadata = await ctx.db.system.get(args.storageId);
  if (!metadata || metadata.size > 10 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(metadata.contentType ?? "")) throw Error("Upload a PDF, JPG, PNG or WebP up to 10 MB.");
  if (booking.droneLicenceStatus === "approved") throw Error("The licence is already approved. Ask the team to reopen review.");
  await ctx.db.patch(booking._id, { droneLicenceStorageId: args.storageId, droneLicenceStatus: "review", droneLicenceUploadedAt: Date.now(), droneLicenceReviewedAt: undefined, droneLicenceNote: undefined });
} });
export const adminDetails = query({ args: { token: v.string(), bookingId: v.id("bookings") }, handler: async (ctx, args) => {
  if (!checkAdminToken(args.token)) throw Error("unauthorized");
  const booking = await ctx.db.get(args.bookingId);
  if (!booking || !await requiresDroneLicence(ctx, booking)) return null;
  return { status: booking.droneLicenceStatus ?? "required", note: booking.droneLicenceNote, url: booking.droneLicenceStorageId ? await ctx.storage.getUrl(booking.droneLicenceStorageId) : null };
} });
export const review = mutation({ args: { token: v.string(), bookingId: v.id("bookings"), decision: v.union(v.literal("approved"), v.literal("requires_input")), note: v.string() }, handler: async (ctx, args) => {
  await assertAdmin(ctx, args.token, "droneLicences.review");
  const booking = await ctx.db.get(args.bookingId);
  if (!booking || booking.status !== "confirmed" || !await requiresDroneLicence(ctx, booking)) throw Error("This rental cannot be reviewed.");
  if (!booking.droneLicenceStorageId) throw Error("The renter must upload their licence first.");
  if (args.note.trim().length < 10) throw Error("Record what was checked or why a replacement is required.");
  await ctx.db.patch(booking._id, { droneLicenceStatus: args.decision, droneLicenceNote: args.note.trim().slice(0, 2000), droneLicenceReviewedAt: Date.now() });
} });
