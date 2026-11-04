import { query } from "./_generated/server";
import { v } from "convex/values";
import { checkAdminToken } from "./adminAuth";

export const recent = query({
  args: { token: v.string() },
  handler: async (_ctx, { token }) => {
    if (!checkAdminToken(token)) return { authorized: false as const, hits: [] };
    return { authorized: true as const, hits: [], diagnosticsAvailable: false as const,
      reason: "Inbound call diagnostics are disabled because the previous feed could be forged. Incoming call routing is unchanged." };
  },
});
