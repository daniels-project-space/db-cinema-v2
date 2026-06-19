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

export default http;
