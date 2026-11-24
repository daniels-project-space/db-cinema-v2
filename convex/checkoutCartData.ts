import { internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { bump } from "./rateLimit";
import { accountForToken, postRentalMessage } from "./lib/rentalChat";
import { assertRentalInventory } from "./lib/rentalInventory";
import { quote } from "./lib/pricing";
import { rentalPricingDays } from "../shared/rentalDuration";
import { listingImages } from "./lib/catalogImages";
import { assertAdmin } from "./adminAuth";
import { isPubliclyBookable } from "./lib/bookability";

export const cartLine = v.object({
  listingId: v.id("listings"),
  start: v.optional(v.number()),
  end: v.optional(v.number()),
  pickupTime: v.optional(v.string()),
  returnTime: v.optional(v.string()),
});

function validEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateLines(lines: Array<{ listingId: any; start?: number; end?: number; pickupTime?: string; returnTime?: string }>) {
  if (!lines.length || lines.length > 100) throw Error("Add between 1 and 100 items to the cart.");
  const seen = new Set<string>();
  for (const line of lines) {
    const id = String(line.listingId);
    if (seen.has(id)) throw Error("Each listing can appear only once in a shared cart.");
    seen.add(id);
    const hasStart = line.start !== undefined;
    const hasEnd = line.end !== undefined;
    if (hasStart !== hasEnd) throw Error("Add both rental dates, or leave both blank.");
    if (!hasStart && (line.pickupTime || line.returnTime)) throw Error("Add rental dates before collection times.");
    if (hasStart && (!Number.isSafeInteger(line.start) || !Number.isSafeInteger(line.end) || line.end! < line.start! || line.end! - line.start! > 365 * 86400000)) {
      throw Error("Check your cart items and dates.");
    }
    if (!!line.pickupTime !== !!line.returnTime) throw Error("Add both collection times, or leave both blank.");
    if (line.pickupTime && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(line.pickupTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(line.returnTime!))) {
      throw Error("Use a valid 24-hour collection and return time.");
    }
    if (line.start === line.end && line.pickupTime && line.returnTime! <= line.pickupTime) {
      throw Error("Return time must be later than collection time on the same day.");
    }
  }
}

function sameLines(
  left: Array<{ listingId: any; start?: number; end?: number; pickupTime?: string; returnTime?: string }>,
  right: Array<{ listingId: any; start?: number; end?: number; pickupTime?: string; returnTime?: string }>,
) {
  return left.length === right.length && left.every((line, index) => {
    const other = right[index];
    return String(line.listingId) === String(other.listingId)
      && line.start === other.start
      && line.end === other.end
      && line.pickupTime === other.pickupTime
      && line.returnTime === other.returnTime;
  });
}

export const create = internalMutation({
  args: { email: v.string(), token: v.optional(v.string()), shareKey: v.string(), lines: v.array(cartLine) },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!validEmail(email)) throw Error("Enter a valid email address.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(args.shareKey)) throw Error("Could not create a secure cart link.");
    validateLines(args.lines);
    const account = args.token ? await accountForToken(ctx, args.token) : null;
    if (args.token && (!account || account.email !== email)) throw Error("Send the cart to your own account email or sign out first.");
    const verifiedAccountId = account && account.emailVerificationRequired !== true &&
      typeof account.emailVerifiedAt === "number" && Number.isFinite(account.emailVerifiedAt) && account.emailVerifiedAt > 0
      ? account._id
      : undefined;
    const listings = await Promise.all(args.lines.map(line => ctx.db.get(line.listingId)));
    if (listings.some(listing => !isPubliclyBookable(listing))) throw Error("One of those listings is no longer available to rent.");
    const existing = await ctx.db.query("checkout_carts").withIndex("by_share", q => q.eq("shareKey", args.shareKey)).unique();
    if (existing) {
      if (existing.email !== email || !sameLines(existing.lines, args.lines)) throw Error("This cart link is already in use.");
      return { accountId: verifiedAccountId };
    }
    if (!(await bump(ctx, `checkout-cart:${email}`, 5, 3600000)).allowed || !(await bump(ctx, "checkout-cart:global", 120, 3600000)).allowed) {
      throw Error("Too many cart links. Please try again later.");
    }
    await ctx.db.insert("checkout_carts", {
      email,
      accountId: account?._id,
      shareKey: args.shareKey,
      lines: args.lines,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 86400000,
    });
    return { accountId: verifiedAccountId };
  },
});

export const createAdmin = internalMutation({
  args: {
    token: v.string(),
    accountId: v.id("accounts"),
    bookingId: v.optional(v.id("bookings")),
    email: v.string(),
    shareKey: v.string(),
    lines: v.array(cartLine),
    sendChat: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ chatSent: boolean; expiresAt: number; chatMessageId?: Id<"messages"> }> => {
    await assertAdmin(ctx, args.token, "checkoutCarts.adminShare");
    const email = args.email.trim().toLowerCase();
    if (!validEmail(email) || !/^[A-Za-z0-9_-]{43}$/.test(args.shareKey)) throw Error("Check the recipient and try again.");
    validateLines(args.lines);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.email?.trim().toLowerCase() !== email) throw Error("The selected customer email changed. Refresh the account and try again.");
    const existing = await ctx.db.query("checkout_carts").withIndex("by_share", q => q.eq("shareKey", args.shareKey)).unique();
    if (existing && (existing.email !== email || existing.accountId !== args.accountId || !sameLines(existing.lines, args.lines))) {
      throw Error("This cart link is already in use.");
    }
    const listings = await Promise.all(args.lines.map(line => ctx.db.get(line.listingId)));
    if (listings.some(listing => !isPubliclyBookable(listing))) throw Error("One of those listings is no longer available to rent.");
    let cartId = existing?._id;
    let cart = existing;
    let chatMessageId = cart?.adminChatMessageId;
    if (!cart) {
      if (!(await bump(ctx, `checkout-cart:${email}`, 5, 3600000)).allowed || !(await bump(ctx, "checkout-cart:global", 120, 3600000)).allowed) {
        throw Error("Too many cart links. Please try again later.");
      }
      cartId = await ctx.db.insert("checkout_carts", {
        email,
        accountId: account._id,
        shareKey: args.shareKey,
        lines: args.lines,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 86400000,
      });
      cart = await ctx.db.get(cartId);
    }
    let chatSent = !!cart?.adminChatMessageId;
    if (args.sendChat && !chatSent) {
      const path = `/cart/quote/${args.shareKey}`;
      const items = await Promise.all(args.lines.map(async line => {
        const listing = await ctx.db.get(line.listingId);
        if (!listing) throw Error("One of those listings was removed. Refresh the basket and try again.");
        return {
          title: listing.title,
          slug: listing.slug,
          heroImage: listingImages(listing)[0] ?? null,
          imageSources: listingImages(listing),
        };
      }));
      let total: number | undefined;
      if (args.lines.every(line => line.start !== undefined && line.end !== undefined)) {
        total = 0;
        for (const line of args.lines) {
          const listing = await ctx.db.get(line.listingId);
          if (!listing) throw Error("One of those listings was removed. Refresh the basket and try again.");
          const days = rentalPricingDays(line.start!, line.end!, line.pickupTime, line.returnTime);
          const amount = quote(listing.pricing, days).total;
          total += amount;
        }
        total = Math.round(total * 100) / 100;
      }
      const messageId = await postRentalMessage(ctx, {
        accountId: account._id,
        bookingId: args.bookingId,
        sender: "owner",
        text: "I’ve put together your rental kit. Review the items and finish checkout below.",
        meta: { kind: "checkout_cart", path, expiresAt: cart?.expiresAt ?? Date.now() + 7 * 86400000, items, total },
      });
      if (cartId) await ctx.db.patch(cartId, { adminChatMessageId: messageId });
      chatMessageId = messageId;
      chatSent = true;
    }
    return { chatSent, expiresAt: cart?.expiresAt ?? Date.now() + 7 * 86400000, ...(chatMessageId ? { chatMessageId } : {}) };
  },
});

export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db.query("checkout_carts")
      .withIndex("by_expiry", q => q.lte("expiresAt", Date.now()))
      .take(100);
    for (const cart of expired) await ctx.db.delete(cart._id);
    if (expired.length === 100) await ctx.scheduler.runAfter(0, internal.checkoutCartData.purgeExpired, {});
    return { deleted: expired.length };
  },
});

export const get = query({
  args: { shareKey: v.string(), start: v.optional(v.number()), end: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(args.shareKey)) return null;
    const cart = await ctx.db.query("checkout_carts").withIndex("by_share", q => q.eq("shareKey", args.shareKey)).unique();
    if (!cart || cart.expiresAt <= Date.now()) return null;
    const hasRequestedRange = args.start !== undefined || args.end !== undefined;
    if (hasRequestedRange && (args.start === undefined || args.end === undefined || !Number.isSafeInteger(args.start) || !Number.isSafeInteger(args.end) || args.end < args.start || args.end - args.start > 365 * 86400000)) {
      throw Error("Choose a valid start and return date.");
    }
    const lines = cart.lines.map(line => line.start === undefined && args.start !== undefined
      ? { ...line, start: args.start, end: args.end }
      : line);
    const dated = lines.every(line => line.start !== undefined && line.end !== undefined);
    let available: boolean | null = null;
    let availabilityCheckFailed = false;
    if (dated) {
      available = true;
      try {
        await assertRentalInventory(ctx, lines.map(line => ({ ...line, qty: 1 })));
      } catch (error) {
        if ((error as { code?: string } | null)?.code === "RENTAL_INVENTORY_UNAVAILABLE") available = false;
        else { available = null; availabilityCheckFailed = true; }
      }
    }
    const items = await Promise.all(lines.map(async (line, index) => {
      const listing = await ctx.db.get(line.listingId);
      if (!listing || !isPubliclyBookable(listing)) return null;
      const images = listingImages(listing);
      if (line.start === undefined || line.end === undefined) {
        return {
          key: `email-cart-${index}`,
          listingId: String(listing._id),
          title: listing.title,
          slug: listing.slug,
          heroImage: images[0] ?? null,
          imageSources: images,
          start: null,
          end: null,
          pickupTime: line.pickupTime,
          returnTime: line.returnTime,
          days: null,
          total: null,
          perDay: null,
          deposit: listing.depositAmount,
        };
      }
      const days = rentalPricingDays(line.start, line.end, line.pickupTime, line.returnTime);
      const price = quote(listing.pricing, days);
      const total = price.total;
      return {
        key: `email-cart-${index}`,
        listingId: String(listing._id),
        title: listing.title,
        slug: listing.slug,
        heroImage: images[0] ?? null,
        imageSources: images,
        start: new Date(line.start).toISOString().slice(0, 10),
        end: new Date(line.end).toISOString().slice(0, 10),
        pickupTime: line.pickupTime,
        returnTime: line.returnTime,
        days,
        total,
        perDay: Math.round(total / days * 100) / 100,
        deposit: listing.depositAmount,
      };
    }));
    const presentItems = items.filter(item => item !== null);
    const allItemsPresent = items.every(Boolean);
    return { items: presentItems, itemCount: lines.length, available: allItemsPresent ? available : false, availabilityCheckFailed: allItemsPresent && availabilityCheckFailed, needsDates: !dated, expiresAt: cart.expiresAt };
  },
});
