import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";

/**
 * /api/swml/inbound — SWML script served to SignalWire for inbound calls.
 *
 * SignalWire fetches this on EVERY inbound call to the Gaffer line and executes
 * the returned document, which bridges the caller to the ElevenLabs agent over
 * SIP TLS. Hosting it here (rather than pasting it into the SignalWire dashboard)
 * keeps it in version control AND makes each call observable: if this route is
 * never hit, SignalWire isn't running the script at all, which is a very
 * different fault from the SIP bridge failing downstream.
 *
 * The destination user-part is hard-coded rather than interpolated from
 * `%{call.to}`: ElevenLabs matches the inbound number against its registered
 * E.164 string, and SignalWire's `call.to` is not guaranteed to carry the
 * leading "+". One number, one line — no reason to risk the mismatch.
 */
export const dynamic = "force-dynamic";

const ELEVENLABS_SIP = "sip:+12053513784@sip.rtc.elevenlabs.io:5061;transport=tls";

const swml = {
  version: "1.0.0",
  sections: {
    main: [{ connect: { to: ELEVENLABS_SIP } }],
  },
};

/**
 * Record the fetch in Convex (and stdout). Convex is the one that matters:
 * it's readable without Vercel log access, which is the whole point of this
 * route existing. Never let a diagnostic failure block the call.
 */
async function trace(req: NextRequest, method: string, body?: unknown) {
  const url = new URL(req.url);
  const detail = JSON.stringify({
    query: Object.fromEntries(url.searchParams),
    body: body ?? null,
  }).slice(0, 4000);

  console.log("[swml/inbound]", method, detail);

  try {
    const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    await c.mutation(api.swml.record, {
      method,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      ua: req.headers.get("user-agent") ?? undefined,
      detail,
    });
  } catch {
    // Diagnostics must never break call routing.
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  await trace(req, "POST", body);
  return NextResponse.json(swml);
}

// SignalWire may fetch with GET; browsers/health checks will too.
export async function GET(req: NextRequest) {
  await trace(req, "GET");
  return NextResponse.json(swml);
}
