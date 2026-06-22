import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoiceDocument } from "@/lib/invoice/InvoiceDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const token = sp.get("token") ?? undefined;
  const key = sp.get("key") ?? undefined;

  const convex = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convex) return new Response("not configured", { status: 500 });

  let data: any = null;
  try {
    const r = await fetch(`${convex}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "bookings:invoiceData", args: { bookingId: id, token, key }, format: "json" }),
      cache: "no-store",
    });
    const j = await r.json();
    data = j?.status === "success" ? j.value : null;
  } catch {
    return new Response("upstream error", { status: 502 });
  }
  if (!data) return new Response("Not found or unauthorized", { status: 403 });

  const buf = await renderToBuffer(createElement(InvoiceDocument, { data }) as any);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="DbCinema-receipt-${id.slice(-8)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
