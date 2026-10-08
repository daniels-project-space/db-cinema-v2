import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { listingImages } from "./lib/catalogImages";
import { checkAdminToken } from "./adminAuth";
import { isMarketingOnly } from "./lib/marketingInventory";
import { membershipActiveNow, membershipTierFor } from "../shared/membership";
import { lateFeeQuote } from "./lib/lateFee";
import { confirmedRentalRefundPence } from "./lib/rentalPaymentPlan";

/** Record a first-party event (views, funnel steps, zero-result searches). */
export const track = mutation({
  args: {
    type: v.string(),
    path: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    listingId: v.optional(v.string()),
    title: v.optional(v.string()),
    qty: v.optional(v.number()),
  },
  handler: async (ctx, { type, path, sessionId, listingId, title, qty }) => {
    // lightweight hardening on this open endpoint: bound the payload so it can't be used
    // to inject huge/arbitrary rows that pollute analytics. Legit event names are short
    // slugs. (Full per-session/IP rate-limiting is a separate task.)
    if (typeof type !== "string" || type.length === 0 || type.length > 40 || !/^[a-z0-9_.:-]+$/i.test(type)) return;
    const p = typeof path === "string" ? path.slice(0, 200) : undefined;
    const s = typeof sessionId === "string" ? sessionId.slice(0, 80) : undefined;
    const li = typeof listingId === "string" ? listingId.slice(0, 60) : undefined;
    const t = typeof title === "string" ? title.slice(0, 120) : undefined;
    const q = typeof qty === "number" && qty > 0 ? Math.min(Math.round(qty), 99) : undefined;
    await ctx.db.insert("events", { type, path: p, sessionId: s, listingId: li, title: t, qty: q, at: Date.now() });
  },
});

const DAYMS = 86400000;

/** Add-to-cart demand: a daily time-series + the most-added items (incl. marketing-only,
 * since the cart logs every add). Powers the admin demand graph. */
export const cartDemand = query({
  args: { token: v.string(), days: v.optional(v.number()), now: v.number() },
  handler: async (ctx, { token, days, now }) => {
    if (!checkAdminToken(token)) {
      return { authorized: false as const, days: 0, total: 0, series: [], top: [] };
    }
    const D = Math.min(Math.max(days ?? 30, 7), 120);
    const since = now - D * DAYMS;
    // demand = add-to-cart (bookable items) + register-interest (display-only items)
    const ev = [
      ...(await ctx.db.query("events").withIndex("by_type_at", (q) => q.eq("type", "add_to_cart").gte("at", since)).collect()).sort((a, b) => a._creationTime - b._creationTime),
      ...(await ctx.db.query("events").withIndex("by_type_at", (q) => q.eq("type", "register_interest").gte("at", since)).collect()).sort((a, b) => a._creationTime - b._creationTime),
    ];
    const adds = ev.filter((e) => e.at >= since);

    // daily buckets, oldest → newest
    const series = Array.from({ length: D }, (_, i) => {
      const date = new Date(now - (D - 1 - i) * DAYMS).toISOString().slice(0, 10);
      return { date, count: 0, units: 0 };
    });
    const idx = new Map(series.map((s, i) => [s.date, i]));

    // per-item rollup (group by listingId, fall back to slug/title for legacy rows)
    const byItem = new Map<string, { listingId: string | null; title: string; adds: number; units: number; displayOnly: boolean; cartAdds: number; interestRequests: number }>();
    for (const e of adds) {
      const day = new Date(e.at).toISOString().slice(0, 10);
      const si = idx.get(day);
      const u = (e as any).qty ?? 1;
      if (si != null) { series[si].count += 1; series[si].units += u; }
      const id = (e as any).listingId || e.path || (e as any).title || "unknown";
      const cur = byItem.get(id) ?? { listingId: (e as any).listingId ?? null, title: (e as any).title || e.path || "(unknown item)", adds: 0, units: 0, displayOnly: false, cartAdds: 0, interestRequests: 0 };
      cur.adds += 1; cur.units += u;
      if(e.type === "register_interest") cur.interestRequests += 1; else cur.cartAdds += 1;
      if (e.type === "register_interest") cur.displayOnly = true;
      if ((e as any).title && (cur.title === "(unknown item)" || cur.title === e.path)) cur.title = (e as any).title;
      byItem.set(id, cur);
    }
    const top = [...byItem.values()].sort((a, b) => b.adds - a.adds).slice(0, 25);
    const pictured = await Promise.all(top.map(async item => {
      let listing = null;
      if (item.listingId) {
        const id = ctx.db.normalizeId("listings", item.listingId);
        if (id) listing = await ctx.db.get(id);
      }
      const imageSources = listingImages(listing);
      return { ...item, heroImage: imageSources[0] ?? null, imageSources };
    }));
    return { authorized: true as const, days: D, total: adds.length, series, top: pictured };
  },
});

/** Owner dashboard summary. `now` passed in (queries can't read the clock). */
export const adminSummary = query({
  args: { token: v.string(), now: v.number() },
  handler: async (ctx, { token, now }) => {
    if (!checkAdminToken(token))
      return { authorized: false as const };

    const DAY = 86400000;
    const events = (await ctx.db.query("events")
      .withIndex("by_at", q => q.gte("at", now - 7 * DAY)).collect())
      // Preserve original creation ordering for equally ranked pages/searches.
      .sort((a, b) => a._creationTime - b._creationTime);
    const in24 = events.filter((e) => e.at >= now - DAY);
    const in7 = events.filter((e) => e.at >= now - 7 * DAY);

    const count = (arr: typeof events, t: string) => arr.filter((e) => e.type === t).length;
    const views24 = count(in24, "view");
    const carts24 = count(in24, "add_to_cart");
    const checkouts24 = count(in24, "checkout_start");
    const purchases24 = count(in24, "purchase");

    // live viewers: distinct sessions with a view in last 15 min
    const live = new Set(
      events
        .filter((e) => e.type === "view" && e.at >= now - 15 * 60000 && e.sessionId)
        .map((e) => e.sessionId),
    ).size;

    // top pages (24h) + zero-result searches (7d)
    const pageCounts = new Map<string, number>();
    for (const e of in24) if (e.type === "view" && e.path) pageCounts.set(e.path, (pageCounts.get(e.path) ?? 0) + 1);
    const topPages = [...pageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const searchMisses = new Map<string, number>();
    for (const e of in7) if (e.type === "search_no_results" && e.path) searchMisses.set(e.path, (searchMisses.get(e.path) ?? 0) + 1);
    const topMisses = [...searchMisses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

    // Operational status is authoritative: overdue kit remains on hire until
    // its return is recorded; an uncollected confirmation is not an active hire.
    const confirmed = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "confirmed"))
      .collect();
    const active = await ctx.db
      .query("bookings")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const byDate = (rows: typeof active, key: "start" | "end") => [...rows].sort((a, b) => {
      const date = (row: typeof a) => {
        const values = row.lineItems.map(line => line[key]).filter(Number.isFinite);
        return values.length ? (key === "start" ? Math.min(...values) : Math.max(...values)) : Infinity;
      };
      return date(a) - date(b) || a._creationTime - b._creationTime;
    });
    const sourceImages = new Map<string, Promise<string[]>>();
    const project = async (b: typeof active[number], index: number) => {
      const starts = b.lineItems.map(line => line.start).filter(Number.isFinite);
      const ends = b.lineItems.map(line => line.end).filter(Number.isFinite);
      const lastDay = ends.length ? Math.max(...ends) : null;
      const finalSlots = b.lineItems.filter(line => line.end === lastDay).map(line => line.returnTime === undefined ? b.returnTime : line.returnTime);
      const returnTime = finalSlots.length && finalSlots.every(slot => typeof slot === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot)) ? [...finalSlots as string[]].sort().at(-1)! : null;
      let overdue = false, deadlineNeedsReview = false;
      if (b.status === "active") {
        try { overdue = lateFeeQuote(b.lineItems, b.returnTime ?? null, now).breakdown.length > 0; }
        catch { deadlineNeedsReview = true; }
      }
      const kit = index < 6 ? await Promise.all(b.lineItems.map(async line => {
        const id = String(line.listingId ?? "");
        if (id && !sourceImages.has(id)) sourceImages.set(id, ctx.db.get(line.listingId).then(listing => listingImages(listing)));
        const images = id ? await sourceImages.get(id)! : [];
        return { title: line.title, qty: line.qty ?? 1, start: line.start, end: line.end, heroImage: images[0] ?? null, imageSources: images };
      })) : [];
      return { _id: b._id, guestEmail: b.guestEmail, customerName: b.guestName ?? b.agreementName ?? null,
        status: b.status, verification: b.idVerifyStatus ?? "required", droneVerification: b.droneLicenceStatus ?? null, start: starts.length ? Math.min(...starts) : null, end: ends.length ? Math.max(...ends) : null,
        pickupTime: b.pickupTime ?? null, returnTime, total: b.total,
        items: b.lineItems.map(line => line.title).join(", "), kit, fulfilment: b.fulfilment,
        calendarLines: b.lineItems.map(line => ({title:line.title,qty:line.qty ?? 1,start:line.start,end:line.end,returnTime:line.returnTime})),
        overdue, deadlineNeedsReview };
    };
    const ongoing = await Promise.all(byDate(active, "end").map(project));
    const awaitingCollection = await Promise.all(byDate(confirmed, "start").map(project));

    return {
      authorized: true as const,
      live,
      views24,
      views7: count(in7, "view"),
      carts24,
      checkouts24,
      purchases24,
      conversion: views24 > 0 ? Math.round((purchases24 / views24) * 1000) / 10 : 0,
      topPages,
      topMisses,
      ongoing,
      awaitingCollection,
      overdueCount: ongoing.filter(rental => rental.overdue).length,
      itemsOut: active.reduce((total,booking)=>total+booking.lineItems.reduce((count,line)=>count+(Number.isSafeInteger(line.qty ?? 1) && (line.qty ?? 1)>0 ? line.qty ?? 1 : 0),0),0),
    };
  },
});

/** Admin-only Insights: first-party observations, never invented render values. */
export const dashboardPanels = query({
  args: { token: v.string(), now: v.number() },
  handler: async (ctx, { token, now }) => {
    if (!checkAdminToken(token)) return { authorized: false as const };
    const date = new Date(now);
    const months = Array.from({ length: 6 }, (_, i) => ({
      at: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 5 + i, 1), rentalPence: 0,
    }));
    const [rows, listings] = await Promise.all([
      ctx.db.query("bookings").withIndex("by_creation_time", q => q.gte("_creationTime", months[0].at)).take(1001),
      ctx.db.query("listings").withIndex("by_active", q => q.eq("active", true)).take(1001),
    ]);
    const paid = rows.slice(0, 1000).filter(b => b._creationTime <= now && b.stripePaymentIntentId && b.currency === "GBP" &&
      (["confirmed", "active", "returned"].includes(b.status) || b.status === "cancelled" && !!b.cancellationDecision));
    await Promise.all(paid.map(async b => {
      const refunds = await ctx.db.query("rental_refunds").withIndex("by_booking", q => q.eq("bookingId", b._id)).collect();
      // Booking totals include applied, paid additions and extensions. The original
      // rentalPaidPence snapshot does not; using it would omit later kit changes.
      const pence = Math.max(0, Math.round((b.total - b.depositAmount) * 100) - confirmedRentalRefundPence(refunds));
      const month = [...months].reverse().find(m => b._creationTime >= m.at);
      if (month) month.rentalPence += pence;
    }));
    const categories = new Map<string, number>();
    for (const listing of listings.slice(0, 1000)) {
      const category = listing.category || "Other";
      categories.set(category, (categories.get(category) ?? 0) + 1);
    }
    return { authorized: true as const, months, totalPence: months.reduce((n, m) => n + m.rentalPence, 0),
      receiptCount: paid.length, partialReceipts: rows.length > 1000, partialCatalogue: listings.length > 1000,
      categories: [...categories].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, count]) => ({ name, count })) };
  },
});

export const insights = query({
  args: { token:v.string(), days:v.number(), now:v.number() },
  handler:async(ctx,{token,days,now})=>{
    if(!checkAdminToken(token))return {authorized:false as const};
    const duration=[7,30,90].includes(days)?days:30;
    const end=Math.floor(now/DAYMS)*DAYMS+DAYMS, since=end-duration*DAYMS;
    const events=(await ctx.db.query("events").withIndex("by_at",q=>q.gte("at",since)).collect()).filter(e=>e.at<=now);
    const series=Array.from({length:duration},(_,i)=>({date:new Date(since+i*DAYMS).toISOString().slice(0,10),visitors:0,adds:0}));
    const unique=new Set<string>(), daily=series.map(()=>new Set<string>());
    const items=new Map<string,{listingId:string|null,title:string,adds:number,units:number}>(),searches=new Map<string,number>(),misses=new Map<string,number>(),pages=new Map<string,Set<string>>();
    const increment=(map:Map<string,number>,key:string)=>{if(key)map.set(key,(map.get(key)??0)+1)};
    let cartAdds=0,gaffer=0,checkouts=0,interest=0;
    for(const event of events){
      const index=Math.floor((event.at-since)/DAYMS);
      if(event.type==="view"&&event.sessionId){unique.add(event.sessionId);daily[index]?.add(event.sessionId);const page=pages.get(event.path??"/")??new Set<string>();page.add(event.sessionId);pages.set(event.path??"/",page)}
      if(event.type==="add_to_cart"){cartAdds++;if(series[index])series[index].adds++;const key=event.listingId??event.path??event.title??"unknown";const item=items.get(key)??{listingId:event.listingId??null,title:event.title??event.path??"Unknown equipment",adds:0,units:0};item.adds++;item.units+=Number.isSafeInteger(event.qty)&&event.qty!>0?event.qty!:1;items.set(key,item)}
      if(event.type==="search_tag")increment(searches,`Tag: ${(event.path??"").trim()}`);
      if(event.type==="search")increment(searches,(event.path??"").trim().toLowerCase());
      if(event.type==="search_no_results")increment(misses,(event.path??"").trim().toLowerCase());
      if(event.type==="gaffer_connected")gaffer++;
      if(event.type==="checkout_start")checkouts++;
      if(event.type==="register_interest")interest++;
    }
    series.forEach((row,i)=>{row.visitors=daily[i].size});
    const top=await Promise.all([...items.values()].sort((a,b)=>b.adds-a.adds||a.title.localeCompare(b.title)).slice(0,25).map(async item=>{
      const id=item.listingId?ctx.db.normalizeId("listings",item.listingId):null,listing=id?await ctx.db.get(id):null;
      const imageSources=listingImages(listing);return {...item,title:listing?.title??item.title,marketingOnly:listing?isMarketingOnly(listing):null,heroImage:imageSources[0]??null,imageSources};
    }));
    const accounts=await ctx.db.query("accounts").collect(), members=accounts.filter(membershipActiveNow), tiers=new Map<string,number>();
    for(const member of members)increment(tiers,membershipTierFor(member)??"Member");
    const sorted=(map:Map<string,number>)=>[...map].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    return {authorized:true as const,days:duration,since,now,uniqueVisitors:unique.size,cartAdds,gaffer,noResults:[...misses.values()].reduce((n,v)=>n+v,0),checkouts,interest,series,top,searches:sorted(searches).slice(0,20),misses:sorted(misses).slice(0,20),pages:sorted(new Map([...pages].map(([key,value])=>[key,value.size]))).slice(0,8),membership:{active:members.length,new:members.filter(a=>(a.membershipSubscriptionCreatedAt??a.createdAt)>=since&&(a.membershipSubscriptionCreatedAt??a.createdAt)<=now).length,scheduledCancellations:members.filter(a=>a.membershipCancelAtPeriodEnd).length,tiers:sorted(tiers)}};
  }
});
