import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { newTextOnly, plainBody, recipientCandidates, replyKeyFrom, senderFrom } from "@/lib/inboundEmail";

/**
 * Inbound email replies to Gaffer follow-ups.
 *
 * Gaffer sends follow-ups with a reply-to of gaffer+<replyKey>@<domain>, so the
 * key that identifies the conversation comes back to us in the To: address. That
 * is what turns "someone replied to an email" into "this is the same customer we
 * spoke to on Tuesday about the FX3".
 *
 * Routing, once matched:
 *   - customer has an account → the reply is posted into their chat thread and
 *     Gaffer answers it there, same as if they'd typed it on the site
 *   - no account            → the owner is alerted by Telegram + email
 *
 * Provider-agnostic: it reads the shapes Resend, Postmark and SendGrid inbound
 * webhooks use, so the mail provider can change without touching this.
 *
 * Requires INBOUND_EMAIL_DOMAIN on the Convex side and the provider's inbound
 * routing pointed here. Until that's configured nothing calls this route, and
 * follow-up replies simply land in the owner's inbox as ordinary mail.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Shared secret in the URL (?key=): inbound webhooks can't carry our headers.
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) {
    // 503, not 500: this is "not switched on yet", and a provider should stop
    // retrying rather than hammer a route that cannot succeed.
    return NextResponse.json(
      { error: "Inbound email is not configured (set INBOUND_EMAIL_SECRET)." },
      { status: 503 },
    );
  }
  if (req.nextUrl.searchParams.get("key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  // Resend nests the message; the others are flat.
  const msg = payload?.data ?? payload;

  const replyKey = replyKeyFrom(...recipientCandidates(msg));
  if (!replyKey) {
    // Not one of ours — accept it so the provider stops retrying, but do nothing.
    return NextResponse.json({ ok: true, ignored: "no reply key" });
  }

  const email = senderFrom(msg);
  if (!email) return NextResponse.json({ ok: true, ignored: "no sender" });

  const body = newTextOnly(plainBody(msg));
  if (!body) return NextResponse.json({ ok: true, ignored: "empty body" });

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return NextResponse.json({ error: "not configured" }, { status: 503 });

  try {
    const res = await new ConvexHttpClient(url).mutation(api.followUp.inbound, {
      // re-checked inside Convex: this route is not the only thing that can
      // reach that mutation
      secret,
      replyKey,
      email,
      body,
      subject: msg?.subject ?? msg?.Subject ?? undefined,
    });
    return NextResponse.json({ ok: true, routed: (res as any)?.routed ?? "owner" });
  } catch (err) {
    console.error("[email/inbound] failed to route reply", err);
    return NextResponse.json({ error: "routing failed" }, { status: 500 });
  }
}
