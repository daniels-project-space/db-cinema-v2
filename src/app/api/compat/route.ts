import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cvx/_generated/api";
import { quote } from "@/lib/pricing";

export const maxDuration = 60;
const msOf = (d: string) => { const t = Date.parse(/T/.test(d) ? d : d + "T00:00:00Z"); return Number.isNaN(t) ? 0 : t; };

const SCHEMA = z.object({
  warnings: z.array(z.object({
    level: z.enum(["error", "warn", "info"]),
    text: z.string(),
  })),
  upgrades: z.array(z.object({
    replace: z.string().describe("the lesser item in the kit being upgraded from"),
    toQuery: z.string().describe("short search phrase for the better item, e.g. 'Sony 24-70mm GM'"),
    reason: z.string(),
  })),
});

export async function POST(req: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ warnings: [], upgrades: [] });
  const b: any = await req.json().catch(() => ({}));
  const items: any[] = b.items || [];
  if (items.length === 0) return NextResponse.json({ warnings: [], upgrades: [] });

  const list = items.map((i) => `- ${i.title} (£${i.total ?? "?"})`).join("\n");
  let out: any = { warnings: [], upgrades: [] };
  try {
    const or = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
    const { object } = await generateObject({
      model: or(process.env.BOT_MODEL || "deepseek/deepseek-chat") as any,
      schema: SCHEMA,
      prompt: `You are a meticulous cinema-gear rental compatibility expert at Db Cinema (London). Analyse the customer's current KIT and flag ONLY real problems and genuine upgrade opportunities. Reason carefully about:

1) REDUNDANCY / basket awareness: many camera listings are BUNDLES whose title already INCLUDES a lens (e.g. "Sony a7III + 28-70mm"). If the kit has such a camera AND a separate lens, warn that the camera already includes a lens (name it) — the extra lens is a second lens, not required.
2) LENS MOUNT vs camera mount (Sony E, Canon RF, EF, MFT, PL). Action cameras (GoPro/Osmo Action) take no interchangeable lenses.
3) ND FILTER THREAD: an ND filter has a thread size (mm). It must match the lens FRONT filter thread or need a step-ring. Infer typical threads: Sony 28-70 kit ≈ 67mm; Sony 24-70 GM / 16-35 GM ≈ 82mm; 24-105 ≈ 77mm. If the ND size ≠ the kit lens thread and no adapter, warn it won't fit.
4) BATTERY type vs camera: e.g. Sony mirrorless use NP-FZ100; Canon R use LP-E6; cine cameras use V-mount. If a battery clearly won't power the camera in the kit, warn.
5) UPGRADES: if the kit's lens is a standard/kit zoom (e.g. 28-70), offer a premium upgrade (e.g. Sony 24-70mm GM, 16-35mm GM) via toQuery.

Be specific (name the items). Only flag REAL issues — return empty arrays if the kit is fine. Keep each warning to one sentence.

KIT:
${list}`,
    });
    out = object;
  } catch {
    out = { warnings: [], upgrades: [] };
  }

  // resolve upgrade suggestions to real, available lens listings (using the kit's dates)
  const start = items[0]?.start, end = items[0]?.end;
  let upgradeCards: any[] = [];
  if (start && end && (out.upgrades || []).length) {
    const c = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const lenses: any[] = await c.query(api.catalog.byItemType, { types: ["lens"] });
    const days = Math.max(1, Math.round((msOf(end) - msOf(start)) / 86400000) + 1);
    const have = new Set(items.map((i) => i.listingId));
    for (const u of out.upgrades.slice(0, 3)) {
      const toks = (u.toQuery || "").toLowerCase().match(/[a-z0-9.\-]{2,}/g) || [];
      let best: any = null, score = 0;
      for (const l of lenses) {
        if (have.has(l._id)) continue;
        const t = l.title.toLowerCase();
        const s = toks.reduce((n: number, k: string) => n + (t.includes(k) ? 1 : 0), 0);
        if (s > score) { score = s; best = l; }
      }
      if (best && score > 0) {
        const av: any = await c.query(api.availability.forListing, { listingId: best._id, start: msOf(start), end: msOf(end) });
        if ((av?.available ?? 0) > 0) {
          const q: any = quote(best.pricing, days);
          upgradeCards.push({
            listingId: best._id, slug: best.slug, title: best.title, image: best.heroImage ?? null,
            start, end, days, perDay: q.perDay, total: q.total, deposit: best.depositAmount ?? 0,
            reason: u.reason, replace: u.replace,
          });
        }
      }
    }
  }

  return NextResponse.json({ warnings: out.warnings || [], upgrades: upgradeCards });
}
