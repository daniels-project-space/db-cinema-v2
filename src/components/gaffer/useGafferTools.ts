"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useConvex } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";
import { quote, depositFor } from "@/lib/pricing";
import { resolveDate, inclusiveDays, londonToday } from "@/lib/voiceDates";
import { dayMs } from "@/lib/dates";
import { useGafferFocus, scrollToId } from "@/components/gaffer/GafferFocus";

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

/**
 * The compat engine reports three levels; "info" is for the page, not a
 * phone call — a fixed-lens note or a redundant-lens heads-up reads as
 * competent on screen but as filler out loud. Only error/warn get said.
 */
function speakCompat(warnings: { level: string; text: string }[]): string {
  const said = warnings.filter((w) => w.level === "error" || w.level === "warn");
  if (!said.length) return "";
  return " Compatibility check: " + said.map((w) => w.text).join(" ");
}

export function useGafferTools() {
  const router = useRouter();
  const cart = useCart();
  const account = useAccount();
  const convex = useConvex();
  const { focus, suggest } = useGafferFocus();
  /**
   * Has the customer been shown the basket breakdown yet this basket?
   * Reset whenever the basket changes, so adding something after reviewing
   * means they see the new total before paying rather than skipping past it.
   */
  const reviewed = useRef(false);
  const basketSig = cart.items.map((i) => `${i.listingId}:${i.start}:${i.end}`).join("|");
  useEffect(() => { reviewed.current = false; }, [basketSig]);

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

  /**
   * Guard against booking the wrong bundle.
   *
   * The catalogue has several near-identical bodies that differ only by the
   * lens in the box — an a7 III with a 28-70 and an a7 III with a GM 24-70 are
   * different listings at different prices. Title matching alone picks one of
   * them, so someone asking for "the a7 III with the 24-70" can end up booked
   * on the 28-70 and only discover it at collection.
   *
   * If the caller named a focal length and the match doesn't carry it, look for
   * a sibling that does rather than adding the wrong one.
   */
  const lensMismatch = useCallback(
    async (request: string, hit: any): Promise<{ wanted: string; better: any | null } | null> => {
      const wanted = String(request ?? "").match(/(\d{2,3})\s*(?:-|to|–)\s*(\d{2,3})/);
      if (!wanted) return null;
      const asked = `${wanted[1]}-${wanted[2]}`;
      const got = hit?.lensFocal ? String(hit.lensFocal) : null;
      if (got === asked) return null;
      // nothing bundled and nothing asked-for to contradict → not a mismatch
      if (!hit?.includesLens && !got) return null;

      // Prefer the same body carrying the right glass over any old listing that
      // happens to include that focal length — offering a bare lens when they
      // asked for the camera-with-lens bundle is its own kind of wrong.
      const siblings = (await findMany(request, 10)).filter(
        (s: any) => String(s.lensFocal ?? "") === asked && s.id !== hit.id,
      );
      const words = (s: string) =>
        new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
      const hitWords = words(hit.title);
      const overlap = (s: any) => [...words(s.title)].filter((w) => hitWords.has(w)).length;
      const better =
        siblings.slice().sort((a: any, b: any) => overlap(b) - overlap(a))[0] ?? null;
      return { wanted: asked, better };
    },
    [findMany],
  );

  /**
   * In-category substitutes that are actually free, minus anything already held.
   *
   * Was reading from `catalog.listListings` — the query built for the public
   * /gear page, which keeps display-only marketing rows visible on purpose
   * (sunk to the bottom, not hidden, for a human scrolling past them). A voice
   * call has no bottom of the page: whatever this returned, Gaffer would offer
   * as a real booking. `voiceCatalog.byCategory` is the same bookable-only
   * gate every other Gaffer-facing query in this file already goes through.
   */
  const alternativesFor = useCallback(
    async (hit: any, startIso: string, endIso: string, limit = 3) => {
      if (!hit?.category) return [];
      const rows: any[] = (await convex.query(api.voiceCatalog.byCategory, { category: hit.category, limit: 12 })) ?? [];
      const out: { title: string; daily: number }[] = [];
      for (const r of rows) {
        const id = String(r.id);
        if (id === hit.id || cart.has(id)) continue;
        const a = await availabilityFor(id, startIso, endIso);
        if (a.available >= 1) out.push({ title: r.title, daily: r.daily ?? 0 });
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

  /**
   * Mount, coverage, filter thread, battery — the same cross-item engine the
   * cart page itself uses (src/lib/compat.ts, via /api/compat), so Gaffer can
   * never disagree with what the customer sees on screen. Not reimplemented
   * here: that engine needs full specs per item (mount, filter thread,
   * battery type) that the cart only carries a price/title summary of, and
   * the route already does the spec lookup — hitting it is simpler and
   * guaranteed consistent, not a shortcut around real logic.
   */
  const compatWarnings = useCallback(async () => {
    if (cart.items.length < 2) return { warnings: [], upgrades: [] };
    try {
      const r = await fetch("/api/compat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: cart.items.map((i) => ({ listingId: i.listingId, title: i.title, total: i.total, start: i.start, end: i.end })),
        }),
      });
      return await r.json();
    } catch {
      return { warnings: [], upgrades: [] };
    }
  }, [cart]);

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
        if (!hits.length) {
          /**
           * A category-only browse ("show me lighting") has no single item to
           * focus, so nothing ever scrolled — the customer was left looking at
           * the hero and assembly card while the actual, correctly filtered
           * results sat a full screen below the fold. Scroll to the toolbar
           * regardless of whether a specific item was found.
           */
          scrollToId("gear-toolbar");
          return `Showing ${cat ?? "the catalogue"} on screen — scrolled down to it.`;
        }

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

      /**
       * "Let's have a look at what we've got" — the recommendation tool.
       *
       * Filters the real catalogue page to what was asked for, highlights the
       * shortlist and scrolls the top pick into view, then reports back what is
       * on screen with prices and what is and isn't in the case. Bare items are
       * offered before sets: the catalogue is overwhelmingly combos, so asking
       * for "a Sony camera" otherwise buries the bodies under
       * body-plus-lens-plus-tripod listings.
       */
      recommend_gear: async ({ item, category }: { item?: string; category?: string }) => {
        const q = String(item ?? "").trim();
        const cat = category
          ? CATEGORIES.find((c) => c.toLowerCase().startsWith(String(category).toLowerCase()))
          : undefined;

        let res: any;
        try {
          res = await convex.query(api.voiceCatalog.recommend, {
            q: q || undefined,
            category: cat,
            limit: 6,
          });
        } catch {
          return "Couldn't pull the catalogue up just now.";
        }

        const picks = [...(res.standalone ?? []), ...(res.bundles ?? [])];
        if (!picks.length) return `Nothing in the catalogue matches ${q || cat || "that"}.`;

        // put them on the real page, filtered the same way
        const qs = new URLSearchParams();
        if (res.category) qs.set("cat", res.category);
        if (res.brand) qs.set("q", res.brand);
        else if (q) qs.set("q", q);
        instant();
        router.push(`/gear?${qs.toString()}`);
        suggest(picks.map((p: any) => p.id));

        const line = (p: any) =>
          `${p.title} at £${p.daily} a day` +
          (p.includes?.length ? ` (includes ${p.includes.join(", ")})` : "") +
          (p.excludes?.length ? ` — ${p.excludes.join("; ")}` : "");

        const parts: string[] = [];
        if (res.standalone?.length)
          parts.push(`On their own: ${res.standalone.slice(0, 3).map(line).join(". ")}.`);
        if (res.bundles?.length)
          parts.push(`With extras included: ${res.bundles.slice(0, 3).map(line).join(". ")}.`);
        return (
          `${picks.length} on screen and highlighted. ${parts.join(" ")} ` +
          `Offer the bare item first unless they asked for a set, and say what isn't included.`
        );
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

        // Wrong-lens guard: don't book the 28-70 body when they asked for the
        // 24-70 one. Check before anything goes in the basket.
        const lens = await lensMismatch(item, hit);
        if (lens) {
          return lens.better
            ? `Careful — "${hit.title}" comes with the ${hit.lensFocal ?? "kit"} lens, not the ` +
                `${lens.wanted} they asked for. There is a separate listing with the ${lens.wanted}: ` +
                `"${lens.better.title}" at £${lens.better.daily} a day. Confirm which one they want, ` +
                `then add that one by name.`
            : `Careful — "${hit.title}" comes with the ${hit.lensFocal ?? "kit"} lens, not the ` +
                `${lens.wanted}. We don't have that body bundled with a ${lens.wanted}; offer the ` +
                `${lens.wanted} as a separate hire alongside it, or this bundle as it is.`;
        }

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
        /**
         * The drawer's backdrop is a full-screen black/65 overlay — opening it
         * right on top of the add covered the highlighted, dimmed-around card
         * before the confirm had time to register as anything more than a
         * hover flicker. This beat lets the pick actually land in view first;
         * the glow (2.6s total) is still visible once the drawer slides over.
         */
        await new Promise((r) => setTimeout(r, 450));
        cart.open();
        return (
          `Added ${hit.title}` +
          (hit.includesLens && hit.lensFocal ? ` (includes the ${hit.lensFocal} lens)` : "") +
          `, ${startIso} to ${endIso}, ${days} day${days > 1 ? "s" : ""}, £${q.total}. ` +
          `Basket is now ${cart.count + 1} item${cart.count ? "s" : ""}. ` +
          // Say the dates back. A misheard date is the single most expensive
          // thing to get wrong here and the least likely to be noticed.
          `Read the dates back to them to confirm.` +
          (pencilled
            ? ` NOTE: I could not understand the date you passed, so this is pencilled in for ` +
              `${startIso}. Ask them for the dates and add it again with them.`
            : "")
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

      /**
       * File the enquiry. This is the one that makes taking someone's details
       * mean something.
       *
       * Without it Gaffer collected names, numbers and requirements on a call
       * and they evaporated when the socket closed — nothing in the inbox,
       * nothing in anyone's email. This lands it in the same contact inbox the
       * website form feeds, and alerts the owner by email and Telegram, using
       * the path the phone line already uses.
       *
       * Call it before the call ends, even if a follow-up email was also sent:
       * the customer's copy and the owner's copy are different jobs.
       */
      log_enquiry: async ({ kind, name, phone, email, message }: {
        kind?: string; name?: string; phone?: string; email?: string; message: string;
      }) => {
        const detail = String(message ?? "").trim();
        if (!detail) return "Tell me what to write down first.";

        const me: any = (account as any)?.me ?? null;
        const who = String(name ?? "").trim() || me?.name || "Voice caller";
        const addr = String(email ?? "").trim() || me?.email || undefined;
        // booking | inquiry | issue | callback — anything else is an inquiry
        const k = ["booking", "inquiry", "issue", "callback"].includes(String(kind))
          ? String(kind)
          : "inquiry";

        try {
          await convex.mutation(api.voice.lead, {
            kind: k,
            name: who,
            phone: phone ? String(phone) : undefined,
            email: addr,
            message: detail,
          });
          return (
            `Logged it as a ${k} for ${who}${addr ? ` (${addr})` : ""} — the team has it now ` +
            `and will pick it up.`
          );
        } catch {
          return "Couldn't file that just now — take their email and use send_follow_up instead.";
        }
      },

      /**
       * "I'll email that over" — puts the outcome of the call in writing.
       *
       * The reply-to is threaded, so when the customer answers that email it
       * comes back into this same conversation rather than as an orphan in the
       * owner's inbox. If they have an account it lands in their chat and Gaffer
       * answers it there.
       */
      send_follow_up: async ({ email, name, summary, subject }: { email?: string; name?: string; summary: string; subject?: string }) => {
        // A signed-in caller has already told us their address — don't make them
        // say it out loud again.
        const to = String(email ?? "").trim() || ((account as any)?.me?.email ?? "");
        if (!to) return "I need an email address before I can send that — what's the best one?";
        if (!summary?.trim()) return "Tell me what to put in it first.";
        try {
          return await convex.action(api.followUp.send, {
            email: to,
            name: name ?? (account as any)?.me?.name ?? undefined,
            summary: String(summary),
            subject: subject ? String(subject) : undefined,
          });
        } catch {
          return "Couldn't get that email away just now — I'll flag it for the team instead.";
        }
      },

      /**
       * "Want an account? Then I can just answer you in your chat."
       *
       * The pitch is the point: a registered customer gets a thread Gaffer
       * replies in directly, instead of waiting on email round-trips.
       */
      offer_account: async () => {
        if ((account as any)?.me) {
          instant();
          router.push("/account");
          return "They're already signed in — their chat is open on screen.";
        }
        instant();
        router.push("/account");
        return (
          "Sign-up is on screen. Tell them it takes a moment and means I can answer them directly " +
          "in their own chat instead of going back and forth by email."
        );
      },

      /** "I'll pick this up in your chat" — only useful once they're signed in. */
      open_chat: async () => {
        if (!(account as any)?.me)
          return "They're not signed in, so there's no chat yet — offer them an account, or take an email address.";
        instant();
        router.push("/account#chat");
        return "Their chat is on screen — anything they send there comes to me.";
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
        const [bad, compat] = await Promise.all([basketProblems(), compatWarnings()]);
        const holding = depositFor("verify", cart.depositTotal);
        const summary =
          `Basket breakdown is on screen: ${cart.items.length} line${cart.items.length > 1 ? "s" : ""}, ` +
          `£${cart.subtotal} plus a £${holding} refundable holding deposit.` +
          speakCompat(compat.warnings ?? []);
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

      /**
       * "Anything else that goes with this?" — the same contextual add-on
       * engine the cart page itself uses (convex/offers.ts), so the discount
       * and the reason are never invented: an ND filter only comes up because
       * there's a lens or camera in the basket and no filter yet, a tripod
       * only because there's something to lock off and no tripod yet, and the
       * percentage off is the one figure checkout will actually honour.
       */
      suggest_addons: async () => {
        if (!cart.count) return "Basket is empty — nothing to suggest add-ons for yet.";
        let offers: any[] = [];
        try {
          offers = await convex.query(api.offers.forCart, {
            items: cart.items.map((i) => ({ listingId: i.listingId as any, start: dayMs(i.start), end: dayMs(i.end), total: i.total })),
          });
        } catch {
          return "Couldn't pull up add-on offers just now.";
        }
        if (!offers.length) return "Nothing extra suggested for what's in the basket right now.";
        const lines = offers
          .map((o: any) => `${o.title} at ${o.pct}% off — £${o.total} for ${o.days} day${o.days > 1 ? "s" : ""} (${o.reason})`)
          .join("; ");
        return `On screen: ${lines}. Offer these naturally, don't read out all of them like a list — add whichever they want.`;
      },

      /**
       * Add one of the offers suggest_addons just named. Re-checks the offer
       * rather than trusting what was said a turn or two ago — the basket may
       * have changed since — and carries offerType through so checkout
       * applies the real discount rather than the full price.
       */
      add_addon: async ({ type }: { type: string }) => {
        if (!cart.count) return "Basket is empty — nothing to add an offer to yet.";
        let offers: any[] = [];
        try {
          offers = await convex.query(api.offers.forCart, {
            items: cart.items.map((i) => ({ listingId: i.listingId as any, start: dayMs(i.start), end: dayMs(i.end), total: i.total })),
          });
        } catch {
          return "Couldn't check that offer just now.";
        }
        const want = String(type ?? "").toLowerCase().replace(/[^a-z-]/g, "");
        const hit = offers.find((o: any) => o.offerType.startsWith(want)) ?? offers.find((o: any) => o.title.toLowerCase().includes(want));
        if (!hit) return `That offer isn't available for what's in the basket right now.`;
        if (cart.has(hit.listingId)) return `${hit.title} is already in the basket.`;

        const iso = (m: number) => new Date(m).toISOString().slice(0, 10);
        focus(hit.listingId);
        await new Promise((r) => setTimeout(r, 1000));
        cart.add({
          listingId: hit.listingId,
          slug: hit.slug,
          title: hit.title,
          heroImage: hit.heroImage ?? null,
          start: iso(hit.start),
          end: iso(hit.end),
          days: hit.days,
          perDay: hit.perDay,
          total: hit.total,
          deposit: hit.deposit ?? 0,
          offerType: hit.offerType,
        });
        await new Promise((r) => setTimeout(r, 450));
        cart.open();
        return `Added ${hit.title} at ${hit.pct}% off — £${hit.total} for ${hit.days} day${hit.days > 1 ? "s" : ""}. Basket is now ${cart.count + 1} items.`;
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

        /**
         * First ask shows the breakdown; only a second one goes to payment.
         *
         * Enforced here rather than in the agent's instructions because the
         * agent has no review_basket tool registered — it only knows
         * go_to_checkout, so asking it to "review first" could never work. This
         * makes the checkout button itself the two-step: nobody reaches payment
         * without having seen dates, line prices and the deposit, and without
         * availability having been checked at that moment.
         */
        if (!reviewed.current) {
          reviewed.current = true;
          instant();
          cart.close();
          router.push("/cart");
          const compat = await compatWarnings();
          const holding = depositFor("verify", cart.depositTotal);
          const lines = cart.items
            .map((i) => `${i.title}, ${i.start} to ${i.end}, £${i.total}`)
            .join("; ");
          return (
            `Full breakdown is on screen and everything in it is available.${speakCompat(compat.warnings ?? [])} ${lines}. ` +
            `That's £${cart.subtotal} plus a £${holding} refundable holding deposit. ` +
            `Read it back to them, then ask if they're happy to go through to payment — ` +
            `call go_to_checkout again only once they say yes.`
          );
        }

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
    [router, cart, account, convex, findOne, findMany, focus, availabilityFor, resolveWindow, alternativesFor, basketProblems, lensMismatch, suggest],
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
