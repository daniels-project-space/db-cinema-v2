import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const submit = mutation({
  args: { name: v.string(), email: v.string(), message: v.string() },
  handler: async (ctx, a) => {
    const id = await ctx.db.insert("contact_messages", {
      name: a.name,
      email: a.email,
      message: a.message,
      handled: false,
    });
    await ctx.scheduler.runAfter(0, internal.notify.contactAlert, a);
    return { id };
  },
});

function assertAdmin(token: string) {
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    throw new Error("unauthorized");
  }
}

export const adminList = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return { authorized: false as const, items: [] };
    }
    const rows = await ctx.db.query("contact_messages").order("desc").take(100);
    const items = rows.map((r) => ({
      _id: r._id,
      name: r.name,
      email: r.email,
      message: r.message,
      handled: r.handled,
      at: r._creationTime,
    }));
    return { authorized: true as const, items };
  },
});

export const adminMarkHandled = mutation({
  args: { token: v.string(), id: v.id("contact_messages") },
  handler: async (ctx, { token, id }) => {
    assertAdmin(token);
    await ctx.db.patch(id, { handled: true });
  },
});
