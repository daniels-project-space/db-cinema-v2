import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { mastra } from "@/mastra";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY)
    return NextResponse.json({ reply: "The assistant isn't configured yet." });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reply: "Sorry, I didn't catch that." });
  }
  const history = Array.isArray(body?.messages) ? body.messages.slice(-12) : [];

  // optional logged-in personalization (read-only, resolved server-side)
  let ctx = "";
  if (body?.token) {
    try {
      const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
      const me: any = await c.query(api.accounts.me, { token: body.token });
      if (me) {
        ctx =
          `Signed-in customer: ${me.name || me.email}` +
          (me.membershipActive ? ` (${me.membershipTier} member)` : "") +
          ".";
        const bk: any = await c.query(api.accounts.myBookings, { token: body.token });
        if (Array.isArray(bk) && bk.length) {
          const b = bk[0];
          ctx += ` Their latest booking is ${b.status}: ${b.lineItems
            .map((li: any) => li.title)
            .join(", ")}.`;
        }
      }
    } catch {}
  }

  const messages = ctx ? [{ role: "system", content: ctx }, ...history] : history;
  try {
    const agent = mastra.getAgent("renterBot");
    const res: any = await agent.generate(messages, { maxSteps: 6 });
    return NextResponse.json({ reply: res?.text || "How can I help with your shoot?" });
  } catch (e) {
    return NextResponse.json({
      reply: "Sorry, I'm having a moment — please try again, or reach us via the contact page.",
    });
  }
}
