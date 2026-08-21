"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useConvex } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";
import { quote, depositFor } from "@/lib/pricing";
import { resolveDate, inclusiveDays, londonToday } from "@/lib/voiceDates";
import { dayMs } from "@/lib/dates";
import { useGafferFocus } from "@/components/gaffer/GafferFocus";

/**
 * Lets Gaffer act on the page while it talks.
 *
 * The webhook tools (/api/voice) can only answer questions — they run on the
 * server and can't touch the customer's screen. These are ElevenLabs *client*
 * tools: the agent calls them and they execute here, in the browser, so saying
 * "I'll pull that up for you" actually opens the product, and "shall I add it?"
 * actually fills the basket. Without them the call is a phone call that happens
 * to be in a browser tab.
 *
 * Every tool returns a short string. The agent reads it as the tool result, so
 * these double as its knowledge of what the customer can now see — which is why
 * they report the real outcome ("added, that's 2 items") rather than just "ok".
 */

/** Spoken destinations → routes. Category words go to the filtered gear page. */
const ROUTES: Record<string, string> = {
  home: "/", gear: "/gear", catalogue: "/gear", catalog: "/gear", shop: "/gear",
  basket: "/cart", cart: "/cart", checkout: "/checkout",
  account: "/account", profile: "/account",
  membership: "/membership", member: "/membership", join: "/join",
  about: "/about", faq: "/faq", help: "/faq", contact: "/contact",
  guides: "/guides", "how it works": "/how-it-works", assemble: "/assemble",
};

const CATEGORIES = [
  "Cameras", "Lenses", "Lighting", "Audio", "Monitors", "Drones",
  "Stabilizers", "Grip", "Power", "Accessories", "Packages", "Sound & DJ",
];

/**
 * Suppress entrance animations for navigations Gaffer performs.
 *
 * A page that fades and rises over ~0.9s reads as slow when the customer didn't
 * click anything and Gaffer is already talking about what's on screen. This
 * reuses the same escape hatch as `prefers-reduced-motion` (see globals.css) so
 * a customer navigating normally still gets the full treatment.
 */
function instant() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.gafferNav = "1";
  window.setTimeout(() => {
    delete document.documentElement.dataset.gafferNav;
  }, 1200);
}

export function useGafferTools() {
  const router = useRouter();
  const cart = useCart();
  const account = useAccount();
  const convex = useConvex();
  const { focus } = useGafferFocus();

  /** Resolve a spoken item name to a real listing via the same matcher the phone line uses. */
  const findOne = useCallback(
    async (item: string) => {
      const res: any = await convex.query(api.voiceCatalog.search, { q: String(item ?? ""), limit: 1 });
      return res?.matches?.[0] ?? null;
    },
    [convex],
  );

  /** Several candidates — a spoken request often matches a bundle and a body. */
  const findMany = useCallback(
    async (item: string, limit = 4): Promise<any[]> => {
      const res: any = await convex.query(api.voiceCatalog.search, { q: String(item ?? ""), limit });
      return res?.matches ?? [];
    },
    [convex],
  );

  /**
   * Real stock for a window, from the same query the basket page uses
   * (`availability.forListing`) — which nets off Hygglo's own bookings, mirrored
   * into the reservations ledger every 15 minutes by the sync-hygglo-reservations
   * cron. So "is it free?" means free across both the site and Hygglo, not just
   * free here.
   *
   * `unknown` on a query failure, deliberately distinct from `available: 0`: a
   * flaky query should not tell a customer their kit is booked out.
   */
  const availabilityFor = useCallback(
    async (listingId: string, startIso: string, endIso: string) => {
      try {
        const r: any = await convex.query(api.availability.forListing, {
          listingId: listingId as any,
          start: dayMs(startIso),
          end: dayMs(endIso),
        });
        return { available: Number(r?.available ?? 0), blocked: !!r?.blocked, unknown: false };
      } catch {
        return { available: 0, blocked: false, unknown: true };
      }
    },
    [convex],
  );

  /** Spoken dates → a concrete window, honouring the listing's minimum hire. */
  const resolveWindow = useCallback((start?: string, end?: string, minDays = 1) => {
    const today = londonToday();
    const s = resolveDate(start, today);
    // No usable date yet? Pencil it in for tomorrow so the basket is real,
    // and say so — the customer can change dates in the basket.
    const fallback = resolveDate("tomorrow", today);
    const startIso = s.ok ? s.date : fallback.ok ? fallback.date : today;
    const e = end ? resolveDate(end, today) : null;
    const endIso = e?.ok ? e.date : startIso;
    return { startIso, endIso, days: Math.max(inclusiveDays(startIso, endIso), minDays), pencilled: !s.ok };
  }, []);

  /** In-category substitutes that are actually free, minus anything already held. */
  const alternativesFor = useCallback(
    async (hit: any, startIso: string, endIso: string, limit = 3) => {
      if (!hit?.category) return [];
      const rows: any[] = (await convex.query(api.catalog.listListings, { category: hit.category, limit: 12 })) ?? [];
      const out: { title: string; daily: number }[] = [];
      for (const r of rows) {
        const id = String(r._id);
        if (id === hit.id || cart.has(id)) continue;
        const a = await availabilityFor(id, startIso, endIso);
        if (a.available >= 1) out.push({ title: r.title, daily: r.pricing?.daily ?? 0 });
        if (out.length >= limit) break;
      }
      return out;
    },
    [convex, cart, availabilityFor],
  );

  /** Availability across every basket line, unit-aware (shared inventory included). */
  const basketProblems = useCallback(async () => {
    if (!cart.items.length) return [];
    try {
      const res: any = await convex.query(api.availability.forCart, {
        items: cart.items.map((i) => ({ listingId: i.listingId as any, start: dayMs(i.start), end: dayMs(i.end) })),
      });
      return cart.items.filter((i) => res?.[i.listingId] && !res[i.listingId].ok);
    } catch {
      return [];
    }
  }, [convex, cart]);

  const clientTools = useMemo(
    () => ({
      /** "Show me your lighting" / "take me to the basket". */
      navigate_to: async ({ destination }: { destination: string }) => {
        const d = String(destination ?? "").toLowerCase().trim();
        instant();

        const direct = ROUTES[d];
        if (direct) {
          router.push(direct);
          return `Opened ${d}.`;
        }
        const cat = CATEGORIES.find((c) => c.toLowerCase() === d || c.toLowerCase().startsWith(d));
        if (cat) {
          router.push(`/gear?cat=${encodeURIComponent(cat)}`);
          return `Showing ${cat} on screen.`;
        }
        router.push(`/gear?q=${encodeURIComponent(d)}`);
        return `Searching the catalogue for ${d}.`;
      },

      /**
       * "Let's see what lenses you've got free that week" — filters the
       * catalogue on screen AND reports which of the results are actually
       * available, so Gaffer offers real options rather than reading out a grid
       * that might be half booked.
       */
      browse_for: async ({ item, category, start, end }: { item?: string; category?: string; start?: string; end?: string }) => {
        const cat = category
          ? CATEGORIES.find((c) => c.toLowerCase().startsWith(String(category).toLowerCase()))
          : undefined;
        const q = String(item ?? "").trim();
        const qs = new URLSearchParams();
        if (cat) qs.set("cat", cat);
        if (q) qs.set("q", q);
        instant();
        router.push(`/gear?${qs.toString()}`);

        const hits = q ? await findMany(q, 4) : [];
        if (!hits.length) return `Showing ${cat ?? "the catalogue"} on screen.`;

        const w = resolveWindow(start, end);
        const free: string[] = [];
        const taken: string[] = [];
        for (const h of hits) {
          const a = await availabilityFor(h.id, w.startIso, w.endIso);
          (a.available >= 1 || a.unknown ? free : taken).push(`${h.title} at £${h.daily} a day`);
        }
        if (!free.length) return `Nothing matching ${q} is free ${w.startIso} to ${w.endIso}. Booked: ${taken.join("; ")}.`;
        return (
          `On screen now. Free ${w.startIso} to ${w.endIso}: ${free.join("; ")}.` +
          (taken.length ? ` Already booked: ${taken.join("; ")}.` : "")
        );
      },

      /** Availability question without moving the customer off the page. */
      find_gear: async ({ item, start, end }: { item: string; start?: string; end?: string }) => {
        const hits = await findMany(item, 3);
        if (!hits.length) return `Nothing in the catalogue matches ${item}.`;
        const w = resolveWindow(start, end, hits[0]?.minDays ?? 1);
        const lines: string[] = [];
        for (const h of hits) {
          const a = await availabilityFor(h.id, w.startIso, w.endIso);
          lines.push(
            a.unknown
              ? `${h.title}, £${h.daily} a day (couldn't confirm stock just now)`
              : a.available >= 1
                ? `${h.title}, £${h.daily} a day — ${a.available} free`
                : `${h.title} — booked out for those dates`,
          );
        }
        return `For ${w.startIso} to ${w.endIso}: ${lines.join("; ")}.`;
      },

      /** "That one" — lights the tile up without touching the basket. */
      select_item: async ({ item }: { item: string }) => {
        const hit = await findOne(item);
        if (!hit) return `Couldn't find ${item} on screen.`;
        focus(hit.id);
        return `Highlighted ${hit.title} on screen.`;
      },

      /** "Let me show you the FX3" — opens the actual product page. */
      show_gear: async ({ item }: { item: string }) => {
        const hit = await findOne(item);
        if (!hit) return `Couldn't find ${item} to show.`;
        instant();
        router.push(`/gear/${hit.slug}`);
        return `Showing ${hit.title} on screen, £${hit.daily} a day.`;
      },

      /**
       * "Shall I put that in your basket?" — checks it's actually free, lights
       * the tile up, then adds it a beat later so the customer watches the pick
       * land rather than a number changing off screen.
       *
       * Refuses rather than adding a line that can't be fulfilled: the basket
       * page gates checkout on the same availability data, so an unavailable
       * line is a dead end the customer would only discover later.
       */
      add_to_basket: async ({ item, start, end }: { item: string; start?: string; end?: string }) => {
        const hit = await findOne(item);
        if (!hit) return `Couldn't find ${item} to add.`;
        if (cart.has(hit.id)) return `${hit.title} is already in the basket.`;

        const { startIso, endIso, days, pencilled } = resolveWindow(start, end, hit.minDays ?? 1);
        const stock = await availabilityFor(hit.id, startIso, endIso);

        if (!stock.unknown && stock.available < 1) {
          const alts = await alternativesFor(hit, startIso, endIso);
          const line = `${hit.title} is booked out ${startIso} to ${endIso}, so I haven't added it.`;
          return alts.length
            ? `${line} Free instead: ${alts.map((a) => `${a.title} at £${a.daily} a day`).join("; ")}. Want one of those?`
            : `${line} Nothing else in ${hit.category} is free then either — shall I try different dates?`;
        }

        // the pick lands on screen first, the basket a moment later
        focus(hit.id);
        await new Promise((r) => setTimeout(r, 1000));

        const q: any = quote({ daily: hit.daily ?? 0 } as any, days);
        cart.add({
          listingId: hit.id,
          slug: hit.slug,
          title: hit.title,
          heroImage: hit.heroImage ?? null,
          start: startIso,
          end: endIso,
          days,
          perDay: q.perDay,
          total: q.total,
          deposit: hit.deposit ?? 0,
        });
        cart.open();
        return (
          `Added ${hit.title} for ${days} day${days > 1 ? "s" : ""}, £${q.total}. ` +
          `Basket is now ${cart.count + 1} item${cart.count ? "s" : ""}.` +
          (pencilled ? " I've pencilled it in for tomorrow — say the word if the dates differ." : "")
        );
      },

      /** Same-category substitutes that are genuinely free for those dates. */
      suggest_alternatives: async ({ item, start, end }: { item: string; start?: string; end?: string }) => {
        const hit = await findOne(item);
        if (!hit) return `Couldn't find ${item} to match against.`;
        const { startIso, endIso } = resolveWindow(start, end, hit.minDays ?? 1);
        const alts = await alternativesFor(hit, startIso, endIso);
        if (!alts.length) return `Nothing else in ${hit.category} is free ${startIso} to ${endIso}.`;
        return `Instead of ${hit.title}: ${alts.map((a) => `${a.title} at £${a.daily} a day`).join("; ")}.`;
      },

      remove_from_basket: async ({ item }: { item: string }) => {
        const needle = String(item ?? "").toLowerCase();
        const line = cart.items.find(
          (i) => i.title.toLowerCase().includes(needle) || i.slug.includes(needle),
        );
        if (!line) return `Nothing matching ${item} in the basket.`;
        cart.remove(line.key);
        return `Removed ${line.title}. Basket is now ${cart.count - 1} items.`;
      },

      /** Quick peek — the drawer, without leaving the page. */
      show_basket: async () => {
        cart.open();
        if (!cart.count) return "Basket is empty.";
        return `Basket: ${cart.items.map((i) => i.title).join(", ")}. Subtotal £${cart.subtotal}.`;
      },

      /**
       * First confirmation step: the full basket breakdown page, where dates,
       * line prices and the deposit are all visible. Checkout is the *second*
       * confirmation — don't jump straight there.
       */
      review_basket: async () => {
        if (!cart.count) return "Basket is empty — nothing to review yet.";
        instant();
        cart.close();
        router.push("/cart");
        const bad = await basketProblems();
        const holding = depositFor("verify", cart.depositTotal);
        const summary =
          `Basket breakdown is on screen: ${cart.items.length} line${cart.items.length > 1 ? "s" : ""}, ` +
          `£${cart.subtotal} plus a £${holding} refundable holding deposit.`;
        return bad.length
          ? `${summary} Heads up — ${bad.map((b) => b.title).join(" and ")} won't be free for those dates. ` +
              `Offer alternatives, or offer to take it off.`
          : `${summary} Happy to go through to checkout?`;
      },

      /** "Is everything in there actually available?" — unit-aware, shared stock included. */
      check_basket: async () => {
        if (!cart.count) return "Basket is empty.";
        const bad = await basketProblems();
        if (!bad.length) return `All ${cart.items.length} line${cart.items.length > 1 ? "s are" : " is"} available. Good to check out.`;
        return (
          `${bad.map((b) => `${b.title} (${b.start} to ${b.end})`).join(" and ")} ` +
          `${bad.length > 1 ? "aren't" : "isn't"} available for those dates. ` +
          `I can swap for something similar, or take ${bad.length > 1 ? "them" : "it"} off the basket.`
        );
      },

      /** "Just take the ones that aren't available off." */
      remove_unavailable: async () => {
        const bad = await basketProblems();
        if (!bad.length) return "Nothing in the basket needs removing — it's all available.";
        for (const line of bad) cart.remove(line.key);
        const left = cart.items.length - bad.length;
        return (
          `Took ${bad.map((b) => b.title).join(" and ")} off. ` +
          (left > 0 ? `${left} line${left > 1 ? "s" : ""} left, all available.` : "That empties the basket.")
        );
      },

      go_to_checkout: async () => {
        if (!cart.count) return "Basket is empty — nothing to check out yet.";
        // Don't walk them into a checkout that will reject the basket: the page
        // gates on this same data, so catch it here where Gaffer can still help.
        const bad = await basketProblems();
        if (bad.length)
          return (
            `Can't check out yet — ${bad.map((b) => b.title).join(" and ")} ` +
            `${bad.length > 1 ? "aren't" : "isn't"} available for those dates. ` +
            `Shall I swap ${bad.length > 1 ? "them" : "it"} for something free, or take ${bad.length > 1 ? "them" : "it"} off?`
          );
        instant();
        cart.close();
        router.push("/checkout");
        // cart.depositTotal is the summed REPLACEMENT value, which checkout runs
        // through depositFor — quoting it raw would tell the customer an FX3
        // needs £3,200 down instead of a £160 hold. Mirror the checkout default.
        const holding = depositFor("verify", cart.depositTotal);
        return `Taking them to checkout, £${cart.subtotal} plus a £${holding} refundable holding deposit.`;
      },
    }),
    [router, cart, findOne, findMany, focus, availabilityFor, resolveWindow, alternativesFor, basketProblems],
  );

  /**
   * Context handed to the agent at session start.
   *
   * This is how Gaffer greets a signed-in customer by name and knows what's
   * already in their basket, instead of asking for details the site already
   * holds. Phone callers get the same agent with these left empty.
   */
  const dynamicVariables = useMemo(() => {
    const me: any = (account as any)?.me ?? null;
    return {
      today: londonToday(),
      signed_in: me ? "yes" : "no",
      customer_name: me?.name ?? "",
      customer_email: me?.email ?? "",
      membership_tier: me?.membershipActive ? (me?.membershipTier ?? "") : "",
      basket_count: String(cart.count),
      basket_items: cart.items.map((i) => `${i.title} (${i.days}d, £${i.total})`).join("; "),
      basket_subtotal: String(cart.subtotal),
      current_page: typeof window !== "undefined" ? window.location.pathname : "",
    };
  }, [account, cart]);

  return { clientTools, dynamicVariables };
}
