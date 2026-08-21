"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { useAccount } from "@/components/account/AccountProvider";
import { IconArrowRight, IconCamera, IconCart, IconMenu, IconSpark, IconUser, IconX } from "@/components/icons";
import { SignatureProductionsOverlay } from "@/components/SignatureProductionsOverlay";
import { FormSevenBadge } from "@/components/FormSevenBadge";

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

const DESKTOP_NAV = NAV.filter((n) => n.href !== "/membership" && n.href !== "/how-it-works");

export function SiteHeader() {
  const { count, open } = useCart();
  const account = useAccount();
  const me = account.me;
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);

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
      {/* promo strip — cross-link to FORM / SEVEN, opens the overlay, never navigates */}
      <div className="sticky top-0 z-50 h-8 border-b border-white/5 bg-gradient-to-r from-accent-500/10 via-charcoal-900/70 to-accent-500/10">
        <button
          onClick={() => setSignatureOpen(true)}
          className="mx-auto flex h-8 w-full max-w-7xl items-center justify-center gap-2 px-6 text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-accent-300 transition-colors hover:text-accent-200 sm:text-[11px]"
        >
          <IconSpark className="h-3 w-3 shrink-0" />
          <span className="truncate">Signature Productions — meet our AI-native creative partner, FORM / SEVEN</span>
          <IconArrowRight className="h-3 w-3 shrink-0" />
        </button>
      </div>

      <header
        className={`sticky top-8 z-40 transition-[background-color,border-color,box-shadow] duration-500 ${
          scrolled
            ? "border-b border-white/[0.07] bg-[#060608]/95 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.8)]"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link href="/" className="group inline-flex min-h-[44px] items-center gap-1.5 font-display text-lg font-bold tracking-tight">
            <span className="text-white">DB</span>
            <span className="gradient-text">CINEMA</span>
            <span className="ml-1 hidden font-mono text-[9px] uppercase tracking-[0.3em] text-white/30 transition-colors group-hover:text-accent-400/70 lg:inline">
              Rentals
            </span>
          </Link>

          <nav className="flex items-center gap-5 text-sm">
            <div className="hidden items-center gap-5 md:flex">
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
              <FormSevenBadge />
            </div>

            {/* fixed-size slot: never reflows the header when auth resolves
                (logged-out button / skeleton / avatar pill all occupy the same box) */}
            <div className="hidden h-9 min-w-[148px] items-center justify-end md:flex">
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

            <Link
              href="/gear"
              onClick={(e) => gearClick(e, "/gear")}
              className="hidden h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-accent-400/40 hover:text-white md:flex"
              aria-label="Browse gear"
            >
              <IconCamera className="h-4.5 w-4.5" />
            </Link>

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

            <button
              onClick={() => setMobile(true)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition hover:text-white md:hidden"
              aria-label="Open menu"
            >
              <IconMenu className="h-5 w-5" />
            </button>
          </nav>
        </div>
      </header>

      {/* mobile menu — full-screen sheet with staggered links */}
      <div
        className={`fixed inset-0 z-50 flex flex-col bg-[#060608]/[0.985] px-6 pb-10 pt-4 transition-opacity duration-300 md:hidden ${
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

        <FormSevenBadge mobile />

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
