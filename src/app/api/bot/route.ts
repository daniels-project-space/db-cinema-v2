import { NextRequest, NextResponse } from "next/server";
import { handleChat } from "@/lib/gaffer";
import { rateLimit } from "@/lib/ratelimit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { signGafferCompletion } from "../../../../shared/gafferCompletionProof";

// Gaffer v2: thin transport. All intelligence lives in src/lib/gaffer.ts
// ("engine decides, LLM narrates"). This route only parses the request, calls the
// pipeline, and shapes the JSON response.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, "bot", 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { reply: "You're sending messages very quickly — give me a few seconds and try again.", cards: [], suggestions: [] },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reply: "Sorry, I didn't catch that.", cards: [], suggestions: [] });
  }
  try {
    let verifiedMessageId:string|undefined;
    if(typeof body?.token==="string"&&typeof body?.renterMessageId==="string"){
      const client=new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
      const messages=await client.query(api.chat.myThread,{token:body.token});
      const latest=messages?.at(-1);
      if(!messages||!latest||String(latest._id)!==body.renterMessageId||latest.sender!=="renter")return NextResponse.json({reply:"Your conversation changed. Please try again in Account → Messages.",cards:[],suggestions:[]},{status:409});
      verifiedMessageId=String(latest._id);
      body={...body,channel:"chat",messages:messages.map(message=>({role:message.sender==="renter"?"user":"assistant",content:message.text}))};
    }
    const out = await handleChat(body);
    const secret=process.env.GAFFER_COMPLETION_PROOF_SECRET??"";
    const completionProof=verifiedMessageId&&out.resolvedInquiry===true&&secret.length>=32?await signGafferCompletion(secret,{messageId:verifiedMessageId,answer:out.reply.trim(),resolved:true,expiresAt:Date.now()+120000}):undefined;
    return NextResponse.json({...out,...(completionProof?{completionProof}:{})},{headers:{"cache-control":"no-store"}});
  } catch (e) {
    console.error("[bot] handleChat failed:", e);
    return NextResponse.json({
      reply: "Sorry, I'm having a moment — please try again, or reach us via the contact page.",
      cards: [],
      suggestions: [],
    });
  }
}
