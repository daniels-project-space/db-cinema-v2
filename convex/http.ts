import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

function documentCors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowed = new Set([process.env.APP_URL?.replace(/\/$/, ""), "https://dbcinemarentals.com", "https://www.dbcinemarentals.com"]);
  return allowed.has(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" } : null;
}
http.route({ path: "/admin-verification-document", method: "OPTIONS", handler: httpAction(async (_ctx, req) => {
  const cors = documentCors(req);
  return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
}) });
http.route({ path: "/admin-verification-document", method: "POST", handler: httpAction(async (ctx, req) => {
  const cors = documentCors(req);
  if (!cors) return new Response("Forbidden", { status: 403 });
  const headers = { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const { documentId } = await req.json();
    const document = await ctx.runMutation(internal.verificationArchive.downloadAccess, { token, documentId });
    const blob = await ctx.storage.get(document.storageId);
    if (!blob) return new Response("Document unavailable", { status: 404, headers });
    return new Response(blob, { headers: { ...headers, "Content-Type": document.contentType, "Content-Disposition": `inline; filename="${document.kind}.${document.contentType === "application/pdf" ? "pdf" : "image"}"` } });
  } catch { return new Response("Access denied or document unavailable", { status: 403, headers }); }
}) });

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

http.route({
  path: "/didit-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    const ok: boolean = await ctx.runAction(internal.didit.webhook, {
      body,
      signature: req.headers.get("x-signature-v2") ?? "",
      timestamp: req.headers.get("x-timestamp") ?? "",
    });
    return new Response(ok ? "ok" : "invalid", { status: ok ? 200 : 400 });
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
    // admin REPLY to an escalation message → route into the renter's chat thread
    const msg = update?.message;
    if (msg?.reply_to_message?.message_id && typeof msg.text === "string" && msg.text.trim()) {
      await ctx.runMutation(internal.chat._adminReply, { tgMessageId: msg.reply_to_message.message_id, text: msg.text });
    }
    return new Response("ok");
  }),
});

export default http;
