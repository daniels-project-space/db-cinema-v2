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

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// ── internal db helpers ──────────────────────────────────────────
export const _byEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) =>
    ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first(),
});

/** Resolve the AUTHENTICATED account from a session token (for checkout member perks —
 * so a member discount can't be claimed by merely typing a member's email). */
export const _byToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    return s ? await ctx.db.get(s.accountId) : null;
  },
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
    const now = Date.now();
    await ctx.db.insert("sessions", { token: a.token, accountId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
    return accountId;
  },
});

export const _session = internalMutation({
  args: { accountId: v.id("accounts"), token: v.string() },
  handler: async (ctx, { accountId, token }) => {
    const now = Date.now();
    await ctx.db.insert("sessions", { token, accountId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  },
});

/** Sweep expired sessions (Convex queries can't read the clock, so expiry is enforced by
 * deleting expired rows here — once gone, resolve() naturally returns null). Hourly cron.
 * Grandfathers legacy sessions that predate expiry tracking (expiresAt == null). */
export const sweepExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", now))
      .collect();
    let n = 0;
    for (const s of rows) {
      if (s.expiresAt != null && s.expiresAt < now) { await ctx.db.delete(s._id); n++; }
    }
    return { swept: n };
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
      avatarUrl: a.avatarStorageId ? await ctx.storage.getUrl(a.avatarStorageId) : null,
      idVerified: a.idVerified ?? false,
      membershipTier: a.membershipTier ?? null,
      membershipActive: a.membershipActive ?? false,
      freeAccessoryMonth: a.freeAccessoryMonth ?? null,
      freeAccessoryUsed: a.freeAccessoryUsed ?? 0,
    };
  },
});

export const _useFreeAccessories = internalMutation({
  args: { email: v.string(), month: v.string(), count: v.number() },
  handler: async (ctx, { email, month, count }) => {
    const a: any = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (!a) return;
    const used = a.freeAccessoryMonth === month ? a.freeAccessoryUsed ?? 0 : 0;
    await ctx.db.patch(a._id, { freeAccessoryMonth: month, freeAccessoryUsed: used + count });
  },
});

export const _setMembership = internalMutation({
  args: { email: v.string(), tier: v.string(), subscriptionId: v.optional(v.string()) },
  handler: async (ctx, { email, tier, subscriptionId }) => {
    const a = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (a)
      await ctx.db.patch(a._id, {
        membershipTier: tier,
        membershipActive: true,
        stripeSubscriptionId: subscriptionId,
      });
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

/** Stash an account-level Stripe Identity session id (crew/member verification). */
export const _setIdSession = internalMutation({
  args: { accountId: v.id("accounts"), sessionId: v.string() },
  handler: async (ctx, { accountId, sessionId }) => {
    await ctx.db.patch(accountId, { idSessionId: sessionId });
  },
});

/** Mark an account ID-verified (called by identity.refreshAccount once Stripe clears it). */
export const _markIdVerified = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await ctx.db.patch(accountId, { idVerified: true });
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

/** Profile photo upload — returns a short-lived Convex storage upload URL (token-gated). */
export const generateAvatarUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Set (or clear, when avatarStorageId is omitted) the account profile photo. Kept separate
 * from updateProfile so a normal profile save can never accidentally wipe the avatar. */
export const setAvatar = mutation({
  args: { token: v.string(), avatarStorageId: v.optional(v.id("_storage")) },
  handler: async (ctx, { token, avatarStorageId }) => {
    const a: any = await resolve(ctx, token);
    if (!a) throw new Error("unauthorized");
    // delete the previous blob to avoid orphaned storage
    if (a.avatarStorageId && a.avatarStorageId !== avatarStorageId) {
      try { await ctx.storage.delete(a.avatarStorageId); } catch {}
    }
    await ctx.db.patch(a._id, { avatarStorageId: avatarStorageId ?? undefined });
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

    // resolve a display image url for a listing (R2 → source → gallery), cached across bookings
    const listingCache = new Map<string, any>();
    const getListing = async (id: any) => {
      const k = String(id);
      if (!listingCache.has(k)) listingCache.set(k, await ctx.db.get(id));
      return listingCache.get(k);
    };
    const heroOf = (l: any): string | null => {
      if (!l) return null;
      const imgs = (l.r2Images?.length ? l.r2Images : (l.sourceImages ?? l.gallery ?? [])) as string[];
      return imgs?.[0] ?? null;
    };

    const out = [];
    for (const b of rows) {
      const lines = [];
      for (const li of b.lineItems) {
        const l = await getListing(li.listingId);
        lines.push({
          listingId: li.listingId,
          title: li.title,
          start: li.start,
          end: li.end,
          qty: li.qty,
          lineTotal: li.lineTotal,
          slug: (l as any)?.slug ?? null,
          heroImage: heroOf(l),
          category: (l as any)?.category ?? null,
        });
      }
      const starts = b.lineItems.map((li: any) => li.start);
      const ends = b.lineItems.map((li: any) => li.end);
      out.push({
        _id: b._id,
        status: b.status,
        lineItems: lines,
        total: b.total,
        subtotal: b.subtotal,
        discount: b.discount,
        depositAmount: b.depositAmount,
        depositRefunded: b.depositRefunded ?? false,
        currency: b.currency ?? "GBP",
        fulfilment: b.fulfilment,
        address: b.address ?? null,
        pickupTime: b.pickupTime ?? null,
        returnTime: b.returnTime ?? null,
        idVerifyStatus: b.idVerifyStatus ?? "required",
        reviewed: reviewed.has(b._id),
        firstSlug: lines[0]?.slug ?? null,
        start: starts.length ? Math.min(...starts) : null,
        end: ends.length ? Math.max(...ends) : null,
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
