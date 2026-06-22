import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// Stripe webhook → server-side booking confirmation (see checkout.stripeWebhook for the
// 2-step activation). Transports the raw body + signature to the node action that verifies
// and confirms. Public URL: https://<deployment>.convex.site/stripe-webhook
http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const sig = req.headers.get("stripe-signature") ?? "";
    const body = await req.text();
    const ok: boolean = await ctx.runAction(internal.checkout.stripeWebhook, { body, sig });
    return new Response(ok ? "ok" : "ignored", { status: ok ? 200 : 400 });
  }),
});

// Telegram inbound — Approve/Decline inline-button callbacks for booking change requests.
// Set the bot webhook to https://<deployment>.convex.site/telegram with secret_token = TELEGRAM_WEBHOOK_SECRET.
http.route({
  path: "/telegram",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = req.headers.get("x-telegram-bot-api-secret-token");
    if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    let update: any;
    try {
      update = await req.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }
    const cb = update?.callback_query;
    if (cb?.data && typeof cb.data === "string" && cb.data.startsWith("chg:")) {
      const [, action, requestId] = cb.data.split(":");
      if (requestId && (action === "approve" || action === "decline")) {
        await ctx.runAction(internal.changes.resolveChange, {
          requestId: requestId as any,
          action,
          callbackQueryId: cb.id,
          chatId: cb.message?.chat?.id,
          messageId: cb.message?.message_id,
        });
      }
    }
    return new Response("ok");
  }),
});

export default http;
