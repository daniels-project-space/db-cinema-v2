import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");
const icsDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
};
const esc = (s: string) =>
  String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Add-to-calendar (.ics) for a renter's own booking. Auth is delegated to bookings:invoiceData
// (token → session → account → email ownership), same as the invoice route.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = req.nextUrl.searchParams.get("token") ?? undefined;
  const convex = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convex) return new Response("not configured", { status: 500 });

  let data: any = null;
  try {
    const r = await fetch(`${convex}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "bookings:invoiceData", args: { bookingId: id, token }, format: "json" }),
      cache: "no-store",
    });
    const j = await r.json();
    data = j?.status === "success" ? j.value : null;
  } catch {
    return new Response("upstream error", { status: 502 });
  }
  if (!data || !data.lineItems?.length) return new Response("Not found or unauthorized", { status: 403 });

  const items = data.lineItems.map((li: any) => (li.qty > 1 ? `${li.qty}x ` : "") + li.title).join(", ");
  const start = Math.min(...data.lineItems.map((li: any) => li.start));
  const end = Math.max(...data.lineItems.map((li: any) => li.end));
  const loc = data.fulfilment === "delivery" ? data.address || "Delivery to your address" : "Central London (collection)";
  const ref = data.number || id.slice(-8);
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const desc = `Booking ${ref}. ${data.fulfilment === "delivery" ? "Delivered" : "Collect"} from ${loc}. Manage your rental at https://dbcinemarentals.com/account`;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Db Cinema Rentals//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ref}@dbcinemarentals.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(start)}`,
    `DTEND;VALUE=DATE:${icsDate(end + 86400000)}`, // all-day DTEND is exclusive
    `SUMMARY:${esc("Db Cinema rental: " + items)}`,
    `LOCATION:${esc(loc)}`,
    `DESCRIPTION:${esc(desc)}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc("Db Cinema pickup tomorrow — " + items)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="dbcinema-${ref}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
