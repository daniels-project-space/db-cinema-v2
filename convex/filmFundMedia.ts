"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { mp4Duration } from "./lib/mp4Duration";
export const verifyVideo = action({
  args: { token: v.string(), projectId: v.id("film_fund_projects"), storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, a): Promise<string> => {
    const media: any = await ctx.runQuery(internal.filmFund.videoContext, { token: a.token, projectId: a.projectId, storageId: a.storageId });
    if (!media.url) throw Error("Uploaded pitch video was not found.");
    const response = await fetch(media.url);
    if (!response.ok) throw Error("Pitch video could not be read.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 120 * 1024 * 1024) throw Error("Pitch video exceeds 120 MB.");
    const durationSeconds = mp4Duration(bytes);
    if (durationSeconds < 55 || durationSeconds > 65) throw Error(`Pitch video is ${Math.round(durationSeconds)} seconds; use 55–65 seconds.`);
    return String(await ctx.runMutation(internal.filmFund.attachVideo, { ...a, durationSeconds }));
  },
});
