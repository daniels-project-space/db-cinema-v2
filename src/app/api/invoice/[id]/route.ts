import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoiceDocument, ReturnStatementDocument } from "@/lib/invoice/InvoiceDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const authorization = req.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : sp.get("token") ?? undefined;
  const key = req.headers.get("x-invoice-key") ?? undefined;

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

  const isReturn = sp.get("phase") === "return";
  if (isReturn && !data.returnStatement) return new Response("Return statement not issued", { status: 404 });

  const document = isReturn
    ? createElement(ReturnStatementDocument, { data: data.returnStatement })
    : createElement(InvoiceDocument, { data });
  const buf = await renderToBuffer(document as Parameters<typeof renderToBuffer>[0]);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="DbCinema-${isReturn ? "return" : "receipt"}-${id.slice(-8)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}


/** Server-to-server draft rendering; the secret is checked by the same booking query as GET. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const key = req.headers.get("x-invoice-key");
  if (!key || req.nextUrl.searchParams.get("phase") !== "return-preview") return new Response("Unauthorized", { status: 403 });
  const convex = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convex) return new Response("Not configured", { status: 500 });
  let data: any;
  try {
    const response = await fetch(`${convex}/api/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "bookings:invoiceData", args: { bookingId: id, key }, format: "json" }), cache: "no-store", signal: AbortSignal.timeout(20000) });
    const body = await response.json(); data = body.status === "success" ? body.value : null;
  } catch { return new Response("Upstream error", { status: 502 }); }
  if (!data) return new Response("Not found or unauthorized", { status: 403 });
  const body = await req.text();
  if (Buffer.byteLength(body) > 1_500_000) return new Response("Preview too large", { status: 413 });
  let input: any;
  try { input = JSON.parse(body); } catch { return new Response("Invalid preview", { status: 400 }); }
  const statement = input.statement ? {...input.statement,supplierName:"DB Cinema Rentals",supplierAddress:undefined} : null;
  if (typeof input.draft !== "boolean" || !statement || statement.number !== `DBC-R-${id.toUpperCase()}` || statement.customerEmail !== (data.email ?? "")) return new Response("Invalid rental preview", { status: 400 });
  if (!input.draft) {
    if (!data.returnStatement || JSON.stringify(statement) !== JSON.stringify(data.returnStatement)) return new Response("Issued statement does not match", { status: 409 });
  } else {
    if (JSON.stringify(statement.lineItems) !== JSON.stringify(data.lineItems) || statement.subtotal !== data.subtotal || statement.discount !== data.discount || statement.deliveryFee !== data.deliveryFee || statement.creditApplied !== data.creditApplied || statement.checkoutPaid !== data.total || statement.securityPaid !== data.depositAmount) return new Response("Booking particulars do not match", { status: 409 });
    if (![statement.securityRefunded, statement.damageTotal, statement.damageFromHold, statement.lateAssessed, statement.lateWaived, statement.actualReturnedAt, statement.issuedAt].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) || statement.securityRefunded > data.depositAmount || statement.damageFromHold > statement.damageTotal || !Array.isArray(statement.inspection) || statement.inspection.length > 500 || !Array.isArray(statement.lateBreakdown)) return new Response("Invalid settlement amounts", { status: 400 });
  }
  try {
    const document = createElement(ReturnStatementDocument, { data: statement, draft: input.draft });
    const pdf = await renderToBuffer(document as Parameters<typeof renderToBuffer>[0]);
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="DbCinema-${input.draft ? "draft-" : ""}return-${id.slice(-8)}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch { return new Response("PDF rendering failed", { status: 502 }); }
}
