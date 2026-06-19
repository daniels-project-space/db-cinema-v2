import { NextRequest, NextResponse } from "next/server";
import { handleChat } from "@/lib/gaffer";

// Gaffer v2: thin transport. All intelligence lives in src/lib/gaffer.ts
// ("engine decides, LLM narrates"). This route only parses the request, calls the
// pipeline, and shapes the JSON response.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reply: "Sorry, I didn't catch that.", cards: [], suggestions: [] });
  }
  try {
    const out = await handleChat(body);
    return NextResponse.json(out);
  } catch (e) {
    console.error("[bot] handleChat failed:", e);
    return NextResponse.json({
      reply: "Sorry, I'm having a moment — please try again, or reach us via the contact page.",
      cards: [],
      suggestions: [],
    });
  }
}
