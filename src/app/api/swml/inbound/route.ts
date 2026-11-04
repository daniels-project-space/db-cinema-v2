import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ELEVENLABS_SIP = "sip:+12053513784@sip.rtc.elevenlabs.io:5061;transport=tls";
const swml = {
  version: "1.0.0",
  sections: { main: [{ connect: { to: ELEVENLABS_SIP } }] },
};

let reported = false;
function response() {
  if (!reported) {
    console.warn("[swml/inbound] Call routing is active; Convex inbound diagnostics are disabled because the old feed was unauthenticated.");
    reported = true;
  }
  return NextResponse.json(swml);
}

export async function POST() { return response(); }
export async function GET() { return response(); }
