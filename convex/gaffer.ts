"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { z } from "zod";

/** Gaffer auto-replies to a renter message in the booking chat — unless a human has taken over. */
export const gafferReply = internalAction({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    if (!process.env.OPENROUTER_API_KEY) return;
    const cx: any = await ctx.runQuery(internal.chat._gafferContext, { accountId });
    if (!cx || cx.escalated) return; // human is handling it — stay quiet

    const or = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
    const model = or(process.env.BOT_MODEL || "deepseek/deepseek-chat-v3.1", {
      extraBody: { provider: { ignore: ["SiliconFlow"], allow_fallbacks: true } },
    });

    const b = cx.booking;
    const system = [
      `You are "Gaffer", the warm, concise assistant for Db Cinema Rentals — pro camera, lens & lighting hire in London.`,
      `Opening hours: ${cx.hours}.`,
      cx.location
        ? `Pickup / collection address: ${cx.location}. Share it if they ask where to collect.`
        : `Pickup is in central London; if they ask exactly where and no address is on file, say the team will message them the precise pickup details.`,
      b
        ? `THIS customer's current rental: ${b.summary}. Dates ${b.dates}. ${b.fulfilment === "delivery" ? `Delivery to ${b.address ?? "their address"}` : "Collection in central London"}${b.pickupTime ? `, pickup ${b.pickupTime}` : ""}${b.returnTime ? `, return ${b.returnTime}` : ""}.`
        : `This customer has no active rental on file right now.`,
      `Answer questions about their rental, pickup/return, gear and policies. Keep replies under ~80 words, friendly and practical.`,
      `Set handoff=true ONLY for: a complaint, damage, a refund/cancellation/dispute, or when they clearly ask for a human/person/staff. When handing off, briefly say you're connecting them with the team.`,
      `Never invent prices or promise refunds.`,
    ].join("\n");

    const convo = cx.messages
      .map((m: any) => `${m.sender === "renter" ? "Customer" : m.sender === "bot" ? "Gaffer" : "Note"}: ${m.text}`)
      .join("\n");

    let reply = "";
    let handoff = false;
    try {
      const out = await generateObject({
        model,
        schema: z.object({ reply: z.string(), handoff: z.boolean() }),
        system,
        prompt: `Conversation so far:\n${convo}\n\nWrite Gaffer's next reply.`,
      });
      reply = (out.object.reply ?? "").trim();
      handoff = !!out.object.handoff;
    } catch {
      return; // model error → stay silent so a human can pick up
    }
    if (!reply) return;

    await ctx.runMutation(internal.chat._postBot, { accountId, text: reply });
    if (handoff) {
      await ctx.runMutation(internal.chat._setEscalated, { accountId, escalated: true });
      await ctx.scheduler.runAfter(0, internal.chat._escalationAlert, { accountId });
    }
  },
});
