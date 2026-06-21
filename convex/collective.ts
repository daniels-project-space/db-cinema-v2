import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

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
    skills: v.optional(v.array(v.string())),
    rateHourly: v.optional(v.number()),
    rateHalfDay: v.optional(v.number()),
    rateDay: v.optional(v.number()),
    portfolio: v.optional(v.string()),
    gearList: v.optional(v.string()),
    gearValue: v.optional(v.string()),
    agreementAccepted: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if (!a.fullName.trim() || !/\S+@\S+\.\S+/.test(a.email)) {
      throw new Error("Please give your name and a valid email.");
    }
    if (a.kind === "gear-provider" && !a.agreementAccepted) {
      throw new Error("Please accept the revenue-share & custody terms to apply as a gear provider.");
    }
    await ctx.db.insert("collective_applications", { ...a, status: "pending" });

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

function assertAdmin(token: string) {
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) throw new Error("unauthorized");
}

export const adminList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return { authorized: false as const, items: [] };
    }
    const rows = await ctx.db.query("collective_applications").order("desc").take(100);
    return { authorized: true as const, items: rows.map((r) => ({ ...r, at: r._creationTime })) };
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
        skills: v.optional(v.array(v.string())),
        rateHourly: v.optional(v.number()),
        rateHalfDay: v.optional(v.number()),
        rateDay: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { token, id, action, edits }) => {
    assertAdmin(token);
    const app = await ctx.db.get(id);
    if (!app) throw new Error("not found");

    if (action === "reject") {
      await ctx.db.patch(id, { status: "rejected", reviewedAt: Date.now() });
      return { ok: true, published: false };
    }

    // fold any admin edits over the submitted values, both for the published
    // card and the stored application record
    const e = { ...app, ...(edits ?? {}) };
    if (edits && Object.keys(edits).length > 0) await ctx.db.patch(id, edits);

    let published = false;
    if (app.kind === "professional") {
      const ops = await ctx.db.query("operators").collect();
      await ctx.db.insert("operators", {
        role: e.role || "videographer",
        roleLabel: e.roleLabel || e.role || "Crew",
        firstName: e.firstName || app.fullName.split(" ")[0],
        years: e.years ?? 1,
        age: e.age,
        tagline: e.tagline || "",
        skills: e.skills ?? [],
        rateHourly: e.rateHourly,
        rateHalfDay: e.rateHalfDay,
        rateDay: e.rateDay,
        neon: NEONS[ops.length % NEONS.length],
        order: ops.length + 1,
        active: true,
      });
      published = true;
    }
    await ctx.db.patch(id, { status: "approved", reviewedAt: Date.now() });
    return { ok: true, published };
  },
});
