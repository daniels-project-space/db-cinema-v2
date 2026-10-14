import {NextRequest,NextResponse} from "next/server";
import {ConvexHttpClient} from "convex/browser";
import {renderToBuffer} from "@react-pdf/renderer";
import {api} from "@cvx/_generated/api";
import {CreditStatementDocument} from "@/lib/invoice/CreditStatementDocument";
export const runtime="nodejs";
export async function POST(request:NextRequest){
 const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)return new NextResponse("Forbidden",{status:403});
 const token=request.headers.get("authorization")?.replace(/^Bearer /,"");if(!token)return new NextResponse("Unauthorized",{status:401});
 try{const body=await request.json();if(typeof body.creditId!=="string"||body.creditId.length>80)return new NextResponse("Invalid receipt",{status:400});
  const url=process.env.NEXT_PUBLIC_CONVEX_URL;if(!url)throw Error("Unavailable");
  const data=await new ConvexHttpClient(url).query(api.accountCredits.statement,{token,creditId:body.creditId as any});
  const pdf=await renderToBuffer(CreditStatementDocument({data}));
  return new NextResponse(new Uint8Array(pdf),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${data.number}.pdf"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
 }catch{return new NextResponse("Credit receipt unavailable",{status:403,headers:{"Cache-Control":"no-store"}})}
}
