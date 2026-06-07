import {
  action,
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ── crypto helpers (Web Crypto, available in Convex actions) ──────
const toHex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const fromHex = (h: string) =>
  new Uint8Array((h.match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));
function randomHex(n: number) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return toHex(b);
}
async function pbkdf2(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

// ── internal db helpers ──────────────────────────────────────────
export const _byEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) =>
    ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first(),
});

export const _create = internalMutation({
  args: {
    email: v.string(),
    salt: v.string(),
    hash: v.string(),
    name: v.optional(v.string()),
    token: v.string(),
  },
  handler: async (ctx, a) => {
    const accountId = await ctx.db.insert("accounts", {
      email: a.email,
      salt: a.salt,
      hash: a.hash,
      name: a.name,
      createdAt: Date.now(),
    });
    await ctx.db.insert("sessions", { token: a.token, accountId });
    return accountId;
  },
});

export const _session = internalMutation({
  args: { accountId: v.id("accounts"), token: v.string() },
  handler: async (ctx, { accountId, token }) => {
    await ctx.db.insert("sessions", { token, accountId });
  },
});

// ── public actions ───────────────────────────────────────────────
export const signUp = action({
  args: { email: v.string(), password: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { email, password, name }): Promise<{ token: string }> => {
    const e = email.trim().toLowerCase();
    if (!/\S+@\S+\.\S+/.test(e) || password.length < 6)
      throw new Error("Enter a valid email and a password of 6+ characters.");
    const existing = await ctx.runQuery(internal.accounts._byEmail, { email: e });
    if (existing) throw new Error("An account with that email already exists.");
    const salt = randomHex(16);
    const hash = await pbkdf2(password, salt);
    const token = randomHex(24);
    await ctx.runMutation(internal.accounts._create, { email: e, salt, hash, name, token });
    return { token };
  },
});

export const signIn = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<{ token: string }> => {
    const e = email.trim().toLowerCase();
    const acct: any = await ctx.runQuery(internal.accounts._byEmail, { email: e });
    if (!acct) throw new Error("No account found for that email.");
    const hash = await pbkdf2(password, acct.salt);
    if (hash !== acct.hash) throw new Error("Incorrect password.");
    const token = randomHex(24);
    await ctx.runMutation(internal.accounts._session, { accountId: acct._id, token });
    return { token };
  },
});

// ── token-scoped queries / mutations ─────────────────────────────
async function resolve(ctx: any, token: string) {
  const s = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q: any) => q.eq("token", token))
    .first();
  if (!s) return null;
  return await ctx.db.get(s.accountId);
}

export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await resolve(ctx, token);
    if (!a) return null;
    return {
      _id: a._id,
      email: a.email,
      name: a.name ?? null,
      phone: a.phone ?? null,
      address: a.address ?? null,
      marketingEmails: a.marketingEmails ?? false,
      favorites: (a.favorites ?? []) as string[],
      idVerified: a.idVerified ?? false,
    };
  },
});

/** Mark an account ID-verified once any of its bookings clears Stripe Identity. */
export const _markVerifiedByEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (a) await ctx.db.patch(a._id, { idVerified: true });
  },
});

export const toggleFavorite = mutation({
  args: { token: v.string(), listingId: v.string() },
  handler: async (ctx, { token, listingId }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    const cur: string[] = a.favorites ?? [];
    const next = cur.includes(listingId)
      ? cur.filter((x) => x !== listingId)
      : [...cur, listingId];
    await ctx.db.patch(a._id, { favorites: next });
    return { favorites: next };
  },
});

export const updateProfile = mutation({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    marketingEmails: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, ...patch }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    await ctx.db.patch(a._id, patch);
    return { ok: true };
  },
});

export const signOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (s) await ctx.db.delete(s._id);
  },
});

export const myBookings = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await resolve(ctx, token);
    if (!a) return null;
    const rows = await ctx.db
      .query("bookings")
      .withIndex("by_guestEmail", (q) => q.eq("guestEmail", a.email))
      .order("desc")
      .take(50);
    const allReviews = await ctx.db.query("reviews").collect();
    const reviewed = new Set(allReviews.map((r) => r.verifiedBookingId).filter(Boolean));
    const out = [];
    for (const b of rows) {
      const firstListing = b.lineItems[0]
        ? await ctx.db.get(b.lineItems[0].listingId)
        : null;
      out.push({
        _id: b._id,
        status: b.status,
        lineItems: b.lineItems,
        total: b.total,
        depositAmount: b.depositAmount,
        idVerifyStatus: b.idVerifyStatus ?? "required",
        reviewed: reviewed.has(b._id),
        firstSlug: (firstListing as any)?.slug ?? null,
        at: b._creationTime,
      });
    }
    return out;
  },
});

// ── account management: change password / delete ─────────────────
export const _authFor = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!s) return null;
    const a: any = await ctx.db.get(s.accountId);
    if (!a) return null;
    return { accountId: a._id, salt: a.salt, hash: a.hash };
  },
});

export const _setPassword = internalMutation({
  args: { accountId: v.id("accounts"), salt: v.string(), hash: v.string() },
  handler: async (ctx, { accountId, salt, hash }) => {
    await ctx.db.patch(accountId, { salt, hash });
  },
});

export const changePassword = action({
  args: { token: v.string(), oldPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { token, oldPassword, newPassword }) => {
    if (newPassword.length < 6) throw new Error("New password must be 6+ characters.");
    const a: any = await ctx.runQuery(internal.accounts._authFor, { token });
    if (!a) throw new Error("unauthorized");
    const oldHash = await pbkdf2(oldPassword, a.salt);
    if (oldHash !== a.hash) throw new Error("Current password is incorrect.");
    const salt = randomHex(16);
    const hash = await pbkdf2(newPassword, salt);
    await ctx.runMutation(internal.accounts._setPassword, { accountId: a.accountId, salt, hash });
    return { ok: true };
  },
});

export const deleteAccount = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    const sessions = await ctx.db.query("sessions").collect();
    for (const s of sessions) if (s.accountId === a._id) await ctx.db.delete(s._id);
    await ctx.db.delete(a._id);
    return { ok: true };
  },
});

export const _setStripeCustomer = internalMutation({
  args: { email: v.string(), customerId: v.string() },
  handler: async (ctx, { email, customerId }) => {
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (a) await ctx.db.patch(a._id, { stripeCustomerId: customerId });
  },
});
