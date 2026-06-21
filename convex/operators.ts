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
        age: o.age ?? null,
        tagline: o.tagline,
        bio: o.bio ?? null,
        tags: o.tags ?? [],
        headshot: o.headshot ?? null,
        skills: o.skills,
        rateHourly: o.rateHourly ?? null,
        rateHalfDay: o.rateHalfDay ?? null,
        rateDay: o.rateDay ?? null,
        portfolioUrl: o.portfolioUrl ?? null,
        neon: o.neon,
      }));
  },
});

const hs = (n: string) => `/crew/headshots/${n.toLowerCase()}.jpg`;
const SEED = [
  { role: "cinematographer", roleLabel: "Cinematographer", firstName: "Marco", years: 9, age: 31, tagline: "Narrative & commercial camera eye — paints with light, shoots on Alexa/FX6.", bio: "Cinematographer shooting narrative and commercial work on Alexa and FX6, with a lighting-led approach to every setup.", tags: ["Commercials", "Narrative", "Own lighting"], headshot: hs("Marco"), skills: ["Lighting", "Camera op", "Colour"], rateHourly: 65, rateHalfDay: 260, rateDay: 480, neon: "cyan", order: 1, active: true },
  { role: "videographer", roleLabel: "Videographer", firstName: "Jess", years: 6, age: 28, tagline: "Fast run-and-gun for events, brand films & socials — shoot to delivery.", bio: "Run-and-gun videographer for events, brand films and social, delivering fully edited cuts fast.", tags: ["Events", "Brand films", "Edit included"], headshot: hs("Jess"), skills: ["Run & gun", "Interviews", "Edit"], rateHourly: 45, rateHalfDay: 180, rateDay: 320, neon: "violet", order: 2, active: true },
  { role: "dop", roleLabel: "Director of Photography", firstName: "Alex", years: 14, age: 38, tagline: "Feature & high-end commercial DOP — full lighting design and crew lead.", bio: "Director of Photography for features and high-end commercials, leading full lighting design and crew.", tags: ["Features", "Lighting design", "Crew lead"], headshot: hs("Alex"), skills: ["Lighting design", "Crew lead", "Lensing"], rateHourly: 90, rateHalfDay: 360, rateDay: 650, neon: "amber", order: 3, active: true },
  { role: "editor", roleLabel: "Editor", firstName: "Liam", years: 8, age: 30, tagline: "Narrative & ad cuts in Premiere/Resolve — sharp story, fast turnarounds.", bio: "Editor cutting narrative and advertising work in Premiere and DaVinci Resolve, with sound editing.", tags: ["Premiere", "Resolve", "Fast turnaround"], headshot: hs("Liam"), skills: ["Premiere", "DaVinci Resolve", "Sound edit"], rateHourly: 40, rateHalfDay: 160, rateDay: 280, neon: "green", order: 4, active: true },
  { role: "music-composer", roleLabel: "Film Composer", firstName: "Theo", years: 11, age: 34, tagline: "Original score & sound design for film and ads — bespoke to your cut.", bio: "Composer writing original score and sound design for film and advertising, bespoke to the cut.", tags: ["Original score", "Sound design", "Mixing"], headshot: hs("Theo"), skills: ["Original score", "Sound design", "Mix"], rateHourly: undefined as number | undefined, rateHalfDay: 220, rateDay: 400, neon: "pink", order: 5, active: true },
  { role: "drone-operator", roleLabel: "Drone Operator", firstName: "Ryan", years: 7, age: 29, tagline: "CAA-licensed cinematic aerials & FPV — fully insured, Mavic/Inspire.", bio: "CAA-licensed drone operator for cinematic aerials and FPV, fully insured on Mavic and Inspire.", tags: ["CAA licensed", "Insured", "FPV"], headshot: hs("Ryan"), skills: ["CAA A2 CofC", "FPV", "Insured"], rateHourly: 80, rateHalfDay: 320, rateDay: 550, neon: "blue", order: 6, active: true },
  { role: "sound-operator", roleLabel: "Sound Operator", firstName: "Nadia", years: 10, age: 33, tagline: "Location sound recordist — boom, lav rigs & timecode, clean takes.", bio: "Location sound recordist running boom, lav rigs and timecode for clean production audio.", tags: ["Boom op", "Lav rigs", "Timecode"], headshot: hs("Nadia"), skills: ["Boom op", "Lav rigging", "Timecode"], rateHourly: 50, rateHalfDay: 200, rateDay: 360, neon: "orange", order: 7, active: true },
  { role: "videographer", roleLabel: "Videographer", firstName: "Sam", years: 4, age: 26, tagline: "Social-first content & brand reels — punchy edits, quick turnaround.", bio: "Social-first videographer producing short-form content and brand reels with quick turnarounds.", tags: ["Social", "Reels", "Quick turnaround"], headshot: hs("Sam"), skills: ["Reels", "Run & gun", "Edit"], rateHourly: 38, rateHalfDay: 150, rateDay: 280, neon: "violet", order: 8, active: true },
  { role: "videographer", roleLabel: "Videographer", firstName: "Priya", years: 8, age: 33, tagline: "Weddings & events specialist — calm on the day, beautiful story edits.", bio: "Wedding and events videographer covering multi-camera days with colour-graded story edits.", tags: ["Weddings", "Multicam", "Colour grade"], headshot: hs("Priya"), skills: ["Weddings", "Multicam", "Colour"], rateHourly: 50, rateHalfDay: 190, rateDay: 360, neon: "violet", order: 9, active: true },
  { role: "cinematographer", roleLabel: "Cinematographer", firstName: "Noah", years: 6, age: 29, tagline: "Commercial & fashion camera — clean, contrasty, brand-ready frames.", bio: "Cinematographer for commercial and fashion work with a clean, contrast-led look.", tags: ["Commercials", "Fashion", "Studio"], headshot: hs("Noah"), skills: ["Lighting", "Camera op", "Fashion"], rateHourly: 58, rateHalfDay: 230, rateDay: 420, neon: "cyan", order: 10, active: true },
  { role: "editor", roleLabel: "Editor", firstName: "Maya", years: 5, age: 27, tagline: "Social & short-form editor — hooks, captions, motion in Premiere/AE.", bio: "Short-form editor building hooks, captions and motion graphics in Premiere and After Effects.", tags: ["Short-form", "Motion graphics", "Captions"], headshot: hs("Maya"), skills: ["Premiere", "After Effects", "Captions"], rateHourly: 35, rateHalfDay: 130, rateDay: 240, neon: "green", order: 11, active: true },
  { role: "drone-operator", roleLabel: "Drone Operator", firstName: "Tom", years: 5, age: 31, tagline: "CAA-licensed aerials for property & landscape — smooth reveals.", bio: "CAA-licensed drone operator for property and landscape aerials, with mapping experience.", tags: ["CAA licensed", "Property", "Mapping"], headshot: hs("Tom"), skills: ["CAA A2 CofC", "Mapping", "Insured"], rateHourly: 70, rateHalfDay: 260, rateDay: 480, neon: "blue", order: 12, active: true },
  { role: "dop", roleLabel: "Director of Photography", firstName: "Elena", years: 11, age: 36, tagline: "Drama & branded-content DP — lighting design with a crew lead's calm.", bio: "Director of Photography for drama and branded content, pairing lighting design with a calm set.", tags: ["Drama", "Branded content", "Lighting"], headshot: hs("Elena"), skills: ["Lighting design", "Lensing", "Crew lead"], rateHourly: 85, rateHalfDay: 330, rateDay: 600, neon: "amber", order: 13, active: true },
];

/** Idempotent seed — inserts missing crew and backfills new profile fields on existing rows. */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("operators").collect();
    const byKey = new Map(existing.map((o) => [`${o.role}|${o.firstName}`, o]));
    let added = 0, patched = 0;
    for (const o of SEED) {
      const cur = byKey.get(`${o.role}|${o.firstName}`);
      if (!cur) {
        await ctx.db.insert("operators", o);
        added++;
      } else {
        const fix: any = {};
        if (cur.roleLabel !== o.roleLabel) fix.roleLabel = o.roleLabel;
        if (cur.age == null && o.age != null) fix.age = o.age;
        if (!cur.bio && o.bio) fix.bio = o.bio;
        if ((!cur.tags || cur.tags.length === 0) && o.tags) fix.tags = o.tags;
        if (!cur.headshot && o.headshot) fix.headshot = o.headshot;
        if (Object.keys(fix).length) { await ctx.db.patch(cur._id, fix); patched++; }
      }
    }
    return { added, patched, total: existing.length + added };
  },
});

/** Quote / booking request — routed THROUGH us (lands in the contact inbox). We never expose
 * the operator's full identity/contact, so it always goes via Db Cinema. */
export const requestQuote = mutation({
  args: {
    role: v.string(),
    firstName: v.string(),
    name: v.string(),
    email: v.string(),
    start: v.optional(v.string()),
    end: v.optional(v.string()),
    callTime: v.optional(v.string()),
    wrapTime: v.optional(v.string()),
    location: v.optional(v.string()),
    gear: v.optional(v.array(v.string())),
    specialRequests: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const dates = a.start ? (a.end && a.end !== a.start ? `${a.start} → ${a.end}` : a.start) : "flexible";
    const times = [a.callTime ? `call ${a.callTime}` : "", a.wrapTime ? `wrap ${a.wrapTime}` : ""].filter(Boolean).join(", ");
    const lines = [
      `[CREW ENQUIRY] ${a.name} wants to hire ${a.firstName} (${a.role}).`,
      `Dates: ${dates}${times ? ` (${times})` : ""}`,
      a.location ? `Location: ${a.location}` : "",
      a.gear && a.gear.length > 0 ? `Asked to bring: ${a.gear.join(", ")}` : "",
      a.specialRequests ? `Special requests: ${a.specialRequests}` : "",
    ].filter(Boolean);
    const body = lines.join("\n");
    await ctx.db.insert("contact_messages", { name: a.name, email: a.email, message: body, routedTo: "crew", handled: false });
    await ctx.scheduler.runAfter(0, internal.notify.contactAlert, { name: a.name, email: a.email, message: body });
    return { ok: true };
  },
});
