import { NextRequest, NextResponse } from "next/server";

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

/** Log enough to prove SignalWire reached us, and what it thinks the call is. */
function trace(req: NextRequest, method: string, body?: unknown) {
  const url = new URL(req.url);
  console.log(
    "[swml/inbound]",
    JSON.stringify({
      method,
      at: new Date().toISOString(),
      from: req.headers.get("x-forwarded-for") ?? null,
      ua: req.headers.get("user-agent") ?? null,
      query: Object.fromEntries(url.searchParams),
      body: body ?? null,
    }),
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  trace(req, "POST", body);
  return NextResponse.json(swml);
}

// SignalWire may fetch with GET; browsers/health checks will too.
export async function GET(req: NextRequest) {
  trace(req, "GET");
  return NextResponse.json(swml);
}
