import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertAdmin, checkAdminToken } from "./adminAuth";
import { accountForToken } from "./lib/rentalChat";

const NEONS = ["cyan", "violet", "amber", "green", "pink", "blue", "orange"];

/**
 * Creative Collective application — gear providers and professionals.
 * NOTHING is published here. We store it as `pending`, drop it in the contact
 * inbox and alert the owner. Publishing only happens via `review` (admin).
 */
export const apply = mutation({
  args: {
    kind: v.union(v.literal("gear-provider"), v.literal("professional")),
    fullName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    role: v.optional(v.string()),
    roleLabel: v.optional(v.string()),
    firstName: v.optional(v.string()),
    years: v.optional(v.number()),
    age: v.optional(v.number()),
    tagline: v.optional(v.string()),
    bio: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    headshotStorageId: v.optional(v.id("_storage")),
    skills: v.optional(v.array(v.string())),
    rateHourly: v.optional(v.number()),
    rateHalfDay: v.optional(v.number()),
    rateDay: v.optional(v.number()),
    portfolio: v.optional(v.string()),
    gearList: v.optional(v.string()),
    gearValue: v.optional(v.string()),
    agreementAccepted: v.optional(v.boolean()),
    termsAgreed: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if (a.headshotStorageId) throw new Error("Headshot uploads are temporarily unavailable. Please submit your application without a photo.");
    if (!a.fullName.trim() || !/\S+@\S+\.\S+/.test(a.email)) {
      throw new Error("Please give your name and a valid email.");
    }
    if (!a.phone || !a.phone.trim()) {
      throw new Error("A phone number is required.");
    }
    if (!a.termsAgreed) {
      throw new Error("Please read and agree to the rental terms.");
    }
    if (a.kind === "gear-provider" && !a.agreementAccepted) {
      throw new Error("Please accept the revenue-share, custody & agency terms to apply as a gear provider.");
    }
    if (a.kind === "gear-provider" && !a.gearValue?.trim()) {
      throw new Error("Please add an approximate total value of your gear.");
    }
    // normalize to match accounts.ts (`.trim().toLowerCase()`) so a later signup's by_email
    // lookup in _applyPendingCollectiveGrant reliably finds this application's grant.
    a.email = a.email.trim().toLowerCase();
    await ctx.db.insert("collective_applications", { ...a, status: "pending", idStatus: "none" });

    const summary =
      a.kind === "gear-provider"
        ? `[CREATIVE COLLECTIVE · GEAR PROVIDER] ${a.fullName} wants to list gear (60/40 split + custody terms accepted).\nGear: ${a.gearList ?? "—"}\nApprox value: ${a.gearValue ?? "—"}\nPhone: ${a.phone ?? "—"}${a.notes ? `\nNotes: ${a.notes}` : ""}`
        : `[CREATIVE COLLECTIVE · PROFESSIONAL] ${a.fullName} applied as ${a.roleLabel ?? a.role ?? "crew"}.\nDisplay name: ${a.firstName ?? "—"} · ${a.years ?? "?"}y\nTagline: ${a.tagline ?? "—"}\nSkills: ${(a.skills ?? []).join(", ") || "—"}\nRates: hr ${a.rateHourly ?? "—"} / half ${a.rateHalfDay ?? "—"} / day ${a.rateDay ?? "—"}\nPortfolio: ${a.portfolio ?? "—"}\nPhone: ${a.phone ?? "—"}${a.notes ? `\nNotes: ${a.notes}` : ""}`;

    await ctx.db.insert("contact_messages", {
      name: a.fullName,
      email: a.email,
      message: summary,
      routedTo: "collective",
      handled: false,
    });
    await ctx.scheduler.runAfter(0, internal.notify.contactAlert, {
      name: a.fullName,
      email: a.email,
      message: summary,
    });
    return { ok: true };
  },
});

/** Anonymous upload URL for an applicant's headshot during onboarding (pre-account). */
export const applicantUploadUrl = mutation({
  args: {},
  handler: async () => { throw new Error("Headshot uploads are temporarily unavailable. Please submit your application without a photo."); },
});

// ── Member profile (token-scoped) ────────────────────────────────────
/** Resolve the signed-in account's email from a session token. */
async function emailFromToken(ctx: any, token: string): Promise<string | null> {
  const acct = await accountForToken(ctx, token);
  return acct?.email ?? null;
}

/** Preserve an established approved application when newer applications arrive. */
async function memberApp(ctx: any, email: string) {
  const approved = await ctx.db.query("collective_applications").withIndex("by_email_status", (q: any) => q.eq("email", email).eq("status", "approved")).order("desc").first();
  if (approved) return approved;
  return await ctx.db.query("collective_applications").withIndex("by_email_status", (q: any) => q.eq("email", email).eq("status", "pending")).order("desc").first();
}

/** Member-facing membership status + completeness (drives the profile glow). */
export const myMembership = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const acct = await accountForToken(ctx, token);
    if (!acct?.email) return null;
    const app = await memberApp(ctx, acct.email);
    if (!app) return null;
    const bankProvided = !!app.bankAccountNumber;
    // ID is cleared by Stripe Identity at the account level (or a manual admin mark on the app)
    const idVerified = acct.idVerified === true || app.idStatus === "verified";
    const operational = app.status === "approved" && bankProvided && idVerified;
    return {
      kind: app.kind as "gear-provider" | "professional",
      status: app.status as "pending" | "approved",
      firstName: app.firstName ?? app.fullName.split(" ")[0],
      roleLabel: app.roleLabel ?? null,
      bankProvided,
      bankLast4: app.bankAccountNumber ? app.bankAccountNumber.slice(-4) : null,
      idVerified,
      operational,
    };
  },
});

/** Member: save payout bank details (only after approval). */
export const saveBankDetails = mutation({
  args: {
    token: v.string(),
    accountName: v.string(),
    sortCode: v.string(),
    accountNumber: v.string(),
  },
  handler: async (ctx, a) => {
    const email = await emailFromToken(ctx, a.token);
    if (!email) throw new Error("Please sign in.");
    const app = await memberApp(ctx, email);
    if (!app || app.status !== "approved") throw new Error("No approved membership found for this account.");
    if (!a.accountName.trim() || a.sortCode.replace(/\D/g, "").length < 6 || a.accountNumber.replace(/\D/g, "").length < 6) {
      throw new Error("Please enter valid bank details.");
    }
    await ctx.db.patch(app._id, {
      bankAccountName: a.accountName.trim(),
      bankSortCode: a.sortCode.trim(),
      bankAccountNumber: a.accountNumber.trim(),
    });
    return { ok: true };
  },
});

/** Member: get a one-time upload URL for an ID document. */
export const idUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const email = await emailFromToken(ctx, token);
    if (!email) throw new Error("Please sign in.");
    throw new Error("Collective ID uploads are temporarily unavailable. Please contact the team.");
  },
});

/** Member: attach the uploaded ID document and mark it submitted for review. */
export const attachId = mutation({
  args: { token: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { token, storageId }) => {
    const email = await emailFromToken(ctx, token);
    if (!email) throw new Error("Please sign in.");
    throw new Error("Collective ID uploads are temporarily unavailable. Please contact the team.");
  },
});

export const adminList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!checkAdminToken(token)) {
      return { authorized: false as const, items: [] };
    }
    const rows = await ctx.db.query("collective_applications").order("desc").take(100);
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        at: r._creationTime,
        idUrl: r.idStorageId ? await ctx.storage.getUrl(r.idStorageId) : null,
        bankProvided: !!r.bankAccountNumber,
      })),
    );
    return { authorized: true as const, items };
  },
});

/** Admin: mark a member's ID check passed (or revert). */
export const setIdVerified = mutation({
  args: { token: v.string(), id: v.id("collective_applications"), verified: v.boolean() },
  handler: async (ctx, { token, id, verified }) => {
    await assertAdmin(ctx, token, "collective.setIdVerified");
    await ctx.db.patch(id, { idStatus: verified ? "verified" : "submitted" });
    return { ok: true };
  },
});

/**
 * Approve → publish, or reject. Approving a professional creates the public
 * `operators` row (first-name-only). Approving a gear provider just marks it
 * approved — the owner onboards the items into the catalogue separately.
 */
export const review = mutation({
  args: {
    token: v.string(),
    id: v.id("collective_applications"),
    action: v.union(v.literal("approve"), v.literal("reject")),
    // optional admin edits applied before publishing a professional ("edit & post")
    edits: v.optional(
      v.object({
        role: v.optional(v.string()),
        roleLabel: v.optional(v.string()),
        firstName: v.optional(v.string()),
        years: v.optional(v.number()),
        age: v.optional(v.number()),
        tagline: v.optional(v.string()),
        bio: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        skills: v.optional(v.array(v.string())),
        rateHourly: v.optional(v.number()),
        rateHalfDay: v.optional(v.number()),
        rateDay: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { token, id, action, edits }) => {
    await assertAdmin(ctx, token, "collective.review");
    const app = await ctx.db.get(id);
    if (!app) throw new Error("not found");

    if (action === "reject") {
      await ctx.db.patch(id, { status: "rejected", reviewedAt: Date.now() });
      return { ok: true, published: false };
    }

    const existingApplications = await ctx.db.query("collective_applications").withIndex("by_email_status", q => q.eq("email", app.email).eq("status", "approved")).take(2);
    if (existingApplications.some(existing => existing._id !== app._id && existing.status === "approved"))
      throw new Error("An approved application already exists for this email. Review the existing membership before approving another application.");

    // fold any admin edits over the submitted values, both for the published
    // card and the stored application record
    const e = { ...app, ...(edits ?? {}) };
    if (edits && Object.keys(edits).length > 0) await ctx.db.patch(id, edits);

    let published = false;
    // complimentary membership grant — professionals get "pro", gear-providers get "plus"
    // (see convex/accounts.ts _grantComplimentaryMembership / schema.ts membershipSource)
    const grantPatch: Record<string, unknown> = { status: "approved", reviewedAt: Date.now() };
    let grantTier: "pro" | "plus" | null = null;
    if (app.kind === "professional") {
      const ops = await ctx.db.query("operators").collect();
      const operatorId = await ctx.db.insert("operators", {
        role: e.role || "videographer",
        roleLabel: e.roleLabel || e.role || "Crew",
        firstName: e.firstName || app.fullName.split(" ")[0],
        years: e.years ?? 1,
        age: e.age,
        tagline: e.tagline || "",
        bio: e.bio || undefined,
        tags: e.tags && e.tags.length ? e.tags : undefined,
        skills: e.skills ?? [],
        rateHourly: e.rateHourly,
        rateHalfDay: e.rateHalfDay,
        rateDay: e.rateDay,
        neon: NEONS[ops.length % NEONS.length],
        order: ops.length + 1,
        active: true,
      });
      published = true;
      grantTier = "pro";
      grantPatch.grantedTier = "pro";
      grantPatch.grantActive = true;
      grantPatch.operatorId = operatorId;
    } else if (app.kind === "gear-provider") {
      grantTier = "plus";
      grantPatch.grantedTier = "plus";
      grantPatch.grantActive = true;
    }
    await ctx.db.patch(id, grantPatch);
    if (grantTier) {
      await ctx.runMutation(internal.accounts._grantComplimentaryMembership, { email: app.email, tier: grantTier });
    }
    return { ok: true, published };
  },
});

/** Admin: activate/deactivate an approved member's complimentary membership perk (and, for
 *  professionals, their published roster card). Deactivating never touches a real paid
 *  Stripe subscription — `_revokeComplimentaryMembership` only acts on accounts whose
 *  membership came from this grant (`membershipSource === "collective-comp"`). */
export const setActive = mutation({
  args: { token: v.string(), id: v.id("collective_applications"), active: v.boolean() },
  handler: async (ctx, { token, id, active }) => {
    await assertAdmin(ctx, token, "collective.setActive");
    const app = await ctx.db.get(id);
    if (!app) throw new Error("Application not found");
    await ctx.db.patch(id, { grantActive: active });
    if (active) {
      const tier = app.grantedTier ?? (app.kind === "professional" ? "pro" : "plus");
      await ctx.runMutation(internal.accounts._grantComplimentaryMembership, { email: app.email, tier });
      if (app.operatorId) await ctx.db.patch(app.operatorId, { active: true });
    } else {
      await ctx.runMutation(internal.accounts._revokeComplimentaryMembership, { email: app.email });
      if (app.operatorId) await ctx.db.patch(app.operatorId, { active: false });
    }
    return { ok: true };
  },
});
