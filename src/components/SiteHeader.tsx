"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";
import { IconArrowRight, IconCart, IconMenu, IconUser, IconX } from "@/components/icons";
import { SignatureProductionsOverlay } from "@/components/SignatureProductionsOverlay";
import { FormSevenCoin, FormSevenMobileTrigger, useSpinAndShine } from "@/components/FormSevenBadge";

type NavItem = { href: string; label: string; external?: boolean };

// Full set — everything lives here for the mobile sheet (a separate,
// already-scrollable menu). The desktop row shows a trimmed subset below;
// Membership / How it works move into the profile dropdown(s) instead.
const NAV: NavItem[] = [
  { href: "/gear", label: "Gear" },
  { href: "/membership", label: "Membership" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/guides", label: "Guides" },
  { href: "/about", label: "About" },
  { href: "/join", label: "Join the Collective" },
  { href: "/contact", label: "Contact" },
];

const DESKTOP_NAV = NAV.filter(
  (n) => n.href !== "/membership" && n.href !== "/how-it-works" && n.href !== "/about" && n.href !== "/join"
);

export function SiteHeader() {
  const { count, open } = useCart();
  const account = useAccount();
  const me = account.me;
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  /**
   * Which half of the lockup is under the cursor.
   *
   * Was a single f7Hover boolean set on the whole group, which is why hovering
   * the Db Cinema wordmark also triggered the FORM 7 takeover and blanked the
   * nav. The two sides now announce different things and neither hides the
   * rest of the bar.
   */
  const [hover, setHover] = useState<null | "db" | "f7">(null);
  /**
   * The lockup introduces itself once, on arrival.
   *
   * Nothing on the bar suggests the coin opens into anything, so the words play
   * themselves in a second after landing, hold long enough to be read, and
   * withdraw behind the 7. It drives the same `data-open` attribute the hover
   * does, so it is literally the same animation rather than a second one kept
   * in sync by hand — and hovering during or after it behaves exactly as before.
   */
  const [intro, setIntro] = useState(false);
  /**
   * Separate from `intro` because it has to outlive it.
   *
   * This is what selects the slow timing, and the withdrawal needs it just as
   * much as the entrance — dropping it at the same moment `intro` flips would
   * snap the words away at hover speed after easing them in.
   */
  const [introSlow, setIntroSlow] = useState(false);
  const { spinning, shining } = useSpinAndShine();

  useEffect(() => {
    // An unprompted animation is the first thing this preference is asking us
    // not to do. The hover reveal stays available either way.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    /**
     * The hold starts once the words have actually arrived, not when they start
     * moving. At this speed the reveal takes ~1.4s and the tail waits another
     * 0.35s behind it, so closing two seconds after the *trigger* would leave
     * barely half a second of stillness to read them in.
     */
    const REVEAL_MS = 1600 + 350;
    const HOLD_MS = 2000;
    const timers = [
      setTimeout(() => { setIntroSlow(true); setIntro(true); }, 1000),
      setTimeout(() => setIntro(false), 1000 + REVEAL_MS + HOLD_MS),
      // only once the withdrawal has finished does the timing go back to hover's
      setTimeout(() => setIntroSlow(false), 1000 + REVEAL_MS * 2 + HOLD_MS + 200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // close the mobile sheet on navigation + lock body scroll while open
  useEffect(() => setMobile(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = mobile ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobile]);

  const avatar = me ? (me.avatarUrl ?? `https://i.pravatar.cc/80?u=${encodeURIComponent(me.email)}`) : "";

  const gearClick = (e: React.MouseEvent, href: string) => {
    if (href === "/gear" && pathname === "/" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("dbc:gear-turn"));
    }
  };

  const mobileLinks: NavItem[] = [
    ...NAV,
    { href: "/account", label: me ? "My account" : "Account" },
  ];

  return (
    <>
      <header
        className={`sticky top-0 z-40 transition-[background-color,border-color,box-shadow] duration-500 ${
          scrolled
            ? "border-b border-white/[0.07] bg-[#060608]/95 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.8)]"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        {/* Past 1536px the bar goes full width and is held off the edges by
            padding alone.
            Capped at the content's own max-w-7xl it stopped dead at 1280px, so
            on a wide monitor the nav sat stranded with ~540px of empty screen
            beside it — not tucked into the corner, not deliberately centred,
            just adrift. Anchoring to the viewport reads as intentional at any
            width; the hover headline fills the middle it opens up. */}
        <div className="relative mx-auto flex max-w-7xl items-center justify-between py-3 pl-3 pr-2 sm:pl-4 sm:pr-3 2xl:max-w-none 2xl:pl-10 2xl:pr-9">
          {/* logo + FORM / SEVEN coin — logo always stays put; hovering the coin fades
              the nav out for a centered takeover headline. Clicking the coin opens
              the partner overlay. */}
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <Link
              href="/"
              onMouseEnter={() => setHover("db")}
              onMouseLeave={() => setHover(null)}
              className="group inline-flex min-h-[44px] items-center gap-1.5 font-display text-xl font-bold tracking-tight"
            >
              <span className="text-white">DB</span>
              <span className="gradient-text">CINEMA</span>
              <span className="ml-1 hidden font-mono text-[10px] uppercase tracking-[0.3em] text-white/30 transition-colors group-hover:text-accent-400/70 lg:inline">
                Rentals
              </span>
            </Link>
            <span aria-hidden className="select-none text-lg font-light text-white/25">
              ×
            </span>
            {/* The coin doesn't sit alone any more: hovering slides it right to
                make room for FORM in front of it, then the collaboration line
                arrives just behind. The whole lockup is the target, so the
                words are clickable rather than only the coin. */}
            <button
              className="f7-lockup"
              data-open={hover === "f7" || intro}
              // Hovering hands control back immediately — a pointer should never
              // wait on the intro's leisurely timing.
              data-intro={introSlow && hover !== "f7" ? "true" : undefined}
              onClick={() => setSignatureOpen(true)}
              onMouseEnter={() => setHover("f7")}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover("f7")}
              onBlur={() => setHover(null)}
              aria-label="FORM / SEVEN — ad agency collaboration, open partner overlay"
            >
              <span className="f7-reveal f7-reveal--lead" aria-hidden>
                <span>FORM</span>
              </span>
              <FormSevenCoin spinning={spinning} shining={shining} />
              <span className="f7-reveal f7-reveal--tail" aria-hidden>
                <span>ad agency collaboration</span>
              </span>
            </button>
          </div>

          {/* What each half of the lockup gets you, said in the middle of the
              bar. Only ever one at a time, and it no longer takes the bar over
              — the nav stays put and stays usable. */}
          <div className="pointer-events-none absolute inset-0 hidden items-center justify-center lg:flex" aria-hidden>
            <span
              className={`absolute serif-accent whitespace-nowrap text-2xl not-italic text-white transition-opacity duration-300 ${
                hover === "db" ? "opacity-100" : "opacity-0"
              }`}
            >
              Book <span className="text-accent-300">gear</span>
            </span>
            <span
              className={`absolute serif-accent whitespace-nowrap text-2xl not-italic text-white transition-opacity duration-300 ${
                hover === "f7" ? "opacity-100" : "opacity-0"
              }`}
            >
              Create <span className="text-accent-300">an ad</span>
            </span>
          </div>

          <nav className="flex items-center gap-2 text-sm sm:gap-2.5">
            {/* sits hard against the account slot rather than drifting toward
                the middle of the bar */}
            <div className="mr-1 hidden items-center gap-4 md:flex lg:gap-5">
              {DESKTOP_NAV.map((n) => {
                const active = pathname === n.href || pathname.startsWith(n.href + "/");
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={(e) => gearClick(e, n.href)}
                    className={`nav-link transition-colors ${
                      active ? "active text-white" : "text-white/55 hover:text-white"
                    }`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </div>

            {/* fixed-size slot: never reflows the header when auth resolves
                (logged-out button / skeleton / avatar pill all occupy the same box) */}
            {/* Sizes to its contents now. The old fixed 104px reserve existed
                to stop the bar reflowing when auth resolved, but a signed-out
                visitor only has a 36px icon in there — the other ~70px was
                dead air wedged between the nav links and Kit, holding them
                apart. The skeleton below carries the reserve instead, so the
                anti-reflow guarantee survives where it actually applies. */}
            <div className="hidden h-9 items-center justify-end md:flex">
              {me ? (
                <div className="relative">
                  <button
                    onClick={() => setMenu((m) => !m)}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3 transition hover:border-accent-400/40 hover:bg-white/[0.07]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={avatar} alt="" className="h-7 w-7 rounded-full object-cover ring-1 ring-accent-400/50" />
                    <span className="max-w-[90px] truncate text-sm text-white/80" title={me.name || me.email}>
                      {me.name || me.email.split("@")[0]}
                    </span>
                  </button>
                  {menu && (
                    <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl border border-white/10 bg-charcoal-900 shadow-2xl shadow-black/60">
                      <div className="flex items-center gap-3 border-b border-white/5 p-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={avatar} alt="" className="h-10 w-10 rounded-full object-cover ring-1 ring-accent-400/50" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white/90">{me.name || "Account"}</div>
                          <div className="truncate text-xs text-white/40">{me.email}</div>
                        </div>
                      </div>
                      <Link
                        href="/account"
                        onClick={() => setMenu(false)}
                        className="block px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        My account &amp; bookings
                      </Link>
                      <Link
                        href="/membership"
                        onClick={() => setMenu(false)}
                        className="block px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        Membership
                      </Link>
                      <Link
                        href="/how-it-works"
                        onClick={() => setMenu(false)}
                        className="block px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        How it works
                      </Link>
                      <Link
                        href="/join"
                        onClick={() => setMenu(false)}
                        className="block border-t border-white/5 px-4 py-2.5 text-sm text-accent-300 transition-colors hover:bg-white/5 hover:text-accent-200"
                      >
                        ✦ Join the Creative Collective
                      </Link>
                      <button
                        onClick={() => {
                          setMenu(false);
                          account.signOut();
                        }}
                        className="block w-full px-4 py-2.5 text-left text-sm text-rec-500 transition-colors hover:bg-white/5"
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              ) : account.loading && account.token ? (
                // returning user: hold the pill's footprint while me resolves
                <div
                  className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3"
                  aria-hidden
                >
                  <span className="h-7 w-7 animate-pulse rounded-full bg-white/10" />
                  <span className="h-3 w-16 animate-pulse rounded bg-white/10" />
                </div>
              ) : (
                <div className="relative">
                  <button
                    onClick={() => setMenu((m) => !m)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition hover:border-accent-400/40 hover:bg-white/[0.07] hover:text-white"
                    aria-label="Account"
                  >
                    <IconUser className="h-4 w-4" />
                  </button>
                  {menu && (
                    <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-charcoal-900 shadow-2xl shadow-black/60">
                      <Link
                        href="/account"
                        onClick={() => setMenu(false)}
                        className="block px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        Sign in
                      </Link>
                      <Link
                        href="/account"
                        onClick={() => setMenu(false)}
                        className="block border-t border-white/5 px-4 py-2.5 text-sm text-accent-300 transition-colors hover:bg-white/5 hover:text-accent-200"
                      >
                        Sign up
                      </Link>
                      <Link
                        href="/membership"
                        onClick={() => setMenu(false)}
                        className="block border-t border-white/5 px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        Membership
                      </Link>
                      <Link
                        href="/how-it-works"
                        onClick={() => setMenu(false)}
                        className="block px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        How it works
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={open}
              className="relative flex min-h-11 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-white/80 transition hover:border-accent-400/40 hover:text-white"
              aria-label="Open kit"
            >
              <IconCart className="h-4 w-4" />
              <span>Kit</span>
              {count > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1 font-mono text-xs font-semibold text-white">
                  {count}
                </span>
              )}
            </button>

            {/* Always present, at the far right.
                It used to be md:hidden, so on a desktop the sheet — which holds
                Membership, How it works, About, Join the Collective and the
                FORM 7 collaboration — had no way in at all. Those pages were
                only reachable by shrinking the window. */}
            <button
              onClick={() => setMobile(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-accent-400/40 hover:bg-white/[0.07] hover:text-white"
              aria-label="Open menu"
              aria-expanded={mobile}
            >
              <IconMenu className="h-5 w-5" />
            </button>
          </nav>
        </div>
      </header>

      {/* mobile menu — full-screen sheet with staggered links */}
      <div
        /* No md:hidden here. The button that opens this is visible at every
           width, so hiding the sheet above md meant a desktop click set the
           state and then rendered display:none — the menu appeared to do
           nothing at all. */
        className={`fixed inset-0 z-50 flex flex-col bg-[#060608]/[0.985] px-6 pb-10 pt-4 transition-opacity duration-300 ${
          mobile ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between">
          <span className="font-display text-lg font-bold">
            <span className="text-white">DB</span> <span className="gradient-text">CINEMA</span>
          </span>
          <button
            onClick={() => setMobile(false)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-white/70"
            aria-label="Close menu"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <nav className="mt-10 flex flex-col">
          {mobileLinks.map((n, i) => {
            const style = mobile ? { animation: `stage-in 0.5s var(--ease-out-expo) ${80 + i * 55}ms both` } : undefined;
            const content = (
              <>
                <span className="font-display text-2xl font-semibold text-white/85 transition-colors group-hover:text-white">
                  {n.label}
                </span>
                <IconArrowRight className="h-5 w-5 text-white/25 transition-transform group-hover:translate-x-1 group-hover:text-accent-400" />
              </>
            );
            if (n.external) {
              return (
                <a
                  key={n.href + n.label}
                  href={n.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobile(false)}
                  className="group flex items-center justify-between border-b border-white/[0.06] py-4"
                  style={style}
                >
                  {content}
                </a>
              );
            }
            return (
              <Link
                key={n.href + n.label}
                href={n.href}
                onClick={(e) => {
                  setMobile(false);
                  gearClick(e, n.href);
                }}
                className="group flex items-center justify-between border-b border-white/[0.06] py-4"
                style={style}
              >
                {content}
              </Link>
            );
          })}
        </nav>

        <FormSevenMobileTrigger
          spinning={spinning}
          shining={shining}
          onOpen={() => {
            setMobile(false);
            setSignatureOpen(true);
          }}
        />

        <div className="mt-auto">
          <span className="hud-label">
            London cinema rental <span className="tick">/</span> open daily
          </span>
        </div>
      </div>

      <SignatureProductionsOverlay open={signatureOpen} onClose={() => setSignatureOpen(false)} />
    </>
  );
}
