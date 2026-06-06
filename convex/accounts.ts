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
    };
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
    return rows.map((b) => ({
      _id: b._id,
      status: b.status,
      lineItems: b.lineItems,
      total: b.total,
      depositAmount: b.depositAmount,
      idVerifyStatus: b.idVerifyStatus ?? "required",
      at: b._creationTime,
    }));
  },
});
