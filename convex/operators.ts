import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/** Public roster — active crew, ordered. First name only (we stay the middleman). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("operators").withIndex("by_order").collect();
    return rows
      .filter((o) => o.active)
      .map((o) => ({
        _id: o._id,
        role: o.role,
        roleLabel: o.roleLabel,
        firstName: o.firstName,
        years: o.years,
        tagline: o.tagline,
        skills: o.skills,
        rateHourly: o.rateHourly ?? null,
        rateHalfDay: o.rateHalfDay ?? null,
        rateDay: o.rateDay ?? null,
        neon: o.neon,
      }));
  },
});

const SEED = [
  { role: "cinematographer", roleLabel: "Cinematographer", firstName: "Marco", years: 9, tagline: "Narrative & commercial camera eye — paints with light, shoots on Alexa/FX6.", skills: ["Lighting", "Camera op", "Colour"], rateHourly: 65, rateHalfDay: 260, rateDay: 480, neon: "cyan", order: 1, active: true },
  { role: "videographer", roleLabel: "Videographer", firstName: "Jess", years: 6, tagline: "Fast run-and-gun for events, brand films & socials — shoot to delivery.", skills: ["Run & gun", "Interviews", "Edit"], rateHourly: 45, rateHalfDay: 180, rateDay: 320, neon: "violet", order: 2, active: true },
  { role: "dop", roleLabel: "Director of Photography", firstName: "Alex", years: 14, tagline: "Feature & high-end commercial DOP — full lighting design and crew lead.", skills: ["Lighting design", "Crew lead", "Lensing"], rateHourly: 90, rateHalfDay: 360, rateDay: 650, neon: "amber", order: 3, active: true },
  { role: "editor", roleLabel: "Editor", firstName: "Liam", years: 8, tagline: "Narrative & ad cuts in Premiere/Resolve — sharp story, fast turnarounds.", skills: ["Premiere", "DaVinci Resolve", "Sound edit"], rateHourly: 40, rateHalfDay: 160, rateDay: 280, neon: "green", order: 4, active: true },
  { role: "music-composer", roleLabel: "Music Composer", firstName: "Theo", years: 11, tagline: "Original score & sound design for film and ads — bespoke to your cut.", skills: ["Original score", "Sound design", "Mix"], rateHourly: undefined as number | undefined, rateHalfDay: 220, rateDay: 400, neon: "pink", order: 5, active: true },
  { role: "drone-operator", roleLabel: "Drone Operator", firstName: "Ryan", years: 7, tagline: "CAA-licensed cinematic aerials & FPV — fully insured, Mavic/Inspire.", skills: ["CAA A2 CofC", "FPV", "Insured"], rateHourly: 80, rateHalfDay: 320, rateDay: 550, neon: "blue", order: 6, active: true },
  { role: "sound-operator", roleLabel: "Sound Operator", firstName: "Nadia", years: 10, tagline: "Location sound recordist — boom, lav rigs & timecode, clean takes.", skills: ["Boom op", "Lav rigging", "Timecode"], rateHourly: 50, rateHalfDay: 200, rateDay: 360, neon: "orange", order: 7, active: true },
];

/** Idempotent seed — only inserts roles that don't exist yet. */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = new Set((await ctx.db.query("operators").collect()).map((o) => o.role));
    let added = 0;
    for (const o of SEED) if (!existing.has(o.role)) { await ctx.db.insert("operators", o); added++; }
    return { added, total: existing.size + added };
  },
});

/** Quote request — routed THROUGH us (lands in the contact inbox). We never expose the
 * operator's full identity/contact, so the booking always goes via Db Cinema. */
export const requestQuote = mutation({
  args: { role: v.string(), firstName: v.string(), name: v.string(), email: v.string(), dates: v.optional(v.string()), message: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const body = `[CREW ENQUIRY] ${a.name} wants to hire ${a.firstName} (${a.role})${a.dates ? ` for ${a.dates}` : ""}.${a.message ? ` Notes: ${a.message}` : ""}`;
    await ctx.db.insert("contact_messages", { name: a.name, email: a.email, message: body, handled: false });
    await ctx.scheduler.runAfter(0, internal.notify.contactAlert, { name: a.name, email: a.email, message: body });
    return { ok: true };
  },
});
