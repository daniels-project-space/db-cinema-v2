"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useConvex } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";
import { quote, depositFor } from "@/lib/pricing";
import { resolveDate, inclusiveDays, londonToday } from "@/lib/voiceDates";

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

  /** Resolve a spoken item name to a real listing via the same matcher the phone line uses. */
  const findOne = useCallback(
    async (item: string) => {
      const res: any = await convex.query(api.voiceCatalog.search, { q: String(item ?? ""), limit: 1 });
      return res?.matches?.[0] ?? null;
    },
    [convex],
  );

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
          router.push(`/gear?category=${encodeURIComponent(cat)}`);
          return `Showing ${cat} on screen.`;
        }
        router.push(`/gear?search=${encodeURIComponent(d)}`);
        return `Searching the catalogue for ${d}.`;
      },

      /** "Let me show you the FX3" — opens the actual product page. */
      show_gear: async ({ item }: { item: string }) => {
        const hit = await findOne(item);
        if (!hit) return `Couldn't find ${item} to show.`;
        instant();
        router.push(`/gear/${hit.slug}`);
        return `Showing ${hit.title} on screen, £${hit.daily} a day.`;
      },

      /** "Shall I put that in your basket?" — actually puts it in the basket. */
      add_to_basket: async ({ item, start, end }: { item: string; start?: string; end?: string }) => {
        const hit = await findOne(item);
        if (!hit) return `Couldn't find ${item} to add.`;

        const today = londonToday();
        const s = resolveDate(start, today);
        // No usable date yet? Pencil it in for tomorrow so the basket is real,
        // and say so — the customer can change dates in the basket.
        const fallback = resolveDate("tomorrow", today);
        const startIso = s.ok ? s.date : fallback.ok ? fallback.date : today;
        const e = end ? resolveDate(end, today) : null;
        const endIso = e?.ok ? e.date : startIso;
        const days = Math.max(inclusiveDays(startIso, endIso), hit.minDays ?? 1);
        const q: any = quote({ daily: hit.daily ?? 0 } as any, days);

        if (cart.has(hit.id)) return `${hit.title} is already in the basket.`;
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
          (s.ok ? "" : " I've pencilled it in for tomorrow — say the word if the dates differ.")
        );
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

      show_basket: async () => {
        cart.open();
        if (!cart.count) return "Basket is empty.";
        return `Basket: ${cart.items.map((i) => i.title).join(", ")}. Subtotal £${cart.subtotal}.`;
      },

      go_to_checkout: async () => {
        if (!cart.count) return "Basket is empty — nothing to check out yet.";
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
    [router, cart, findOne],
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
