"use client";

import { pickRentalDates } from "@/lib/dateSelection";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { getSessionId } from "@/lib/session";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { BookingPanel } from "@/components/booking/BookingPanel";
import {RentalContentsList} from "@/components/booking/RentalContentsList";
import { Recommendations } from "@/components/Recommendations";
import { useGafferFocus } from "@/components/gaffer/GafferFocus";
import { SmartImage } from "@/components/SmartImage";
import { addDaysIso, daysInclusive } from "@/components/booking/Calendar";
import { IconCheck, IconChevronLeft, IconChevronRight } from "@/components/icons";

function expandUnavailable(raw: string[]): Set<string> {
  const set = new Set<string>();
  for (const e of raw) {
    if (/^\d{4}-\d{2}-\d{2}/.test(e)) {
      set.add(e.slice(0, 10));
      continue;
    }
    try {
      const o = JSON.parse(e);
      const from = o.from ?? o.start ?? o.date;
      const to = o.to ?? o.end ?? from;
      if (from) {
        let cur = String(from).slice(0, 10);
        const last = String(to).slice(0, 10);
        for (let i = 0; i < 400 && cur <= last; i++) {
          set.add(cur);
          cur = addDaysIso(cur, 1);
        }
      }
    } catch {}
  }
  return set;
}

function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const nav = navigator as any;
    if (nav.share) {
      try {
        await nav.share({ title, url });
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }
  return (
    <button
      onClick={share}
      data-testid="listing-share-button"
      aria-label={copied ? "Listing link copied to clipboard" : `Share ${title}`}
      className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-xs font-medium text-white/65 transition hover:border-accent-300/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300"
    >
      {copied ? <><svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m4 10 4 4 8-8" /></svg>Copied</> : <><svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="15.5" cy="4.5" r="2.25" /><circle cx="4.5" cy="10" r="2.25" /><circle cx="15.5" cy="15.5" r="2.25" /><path d="m6.6 8.9 6.8-3.3M6.6 11.1l6.8 3.3" /></svg>Share</>}
    </button>
  );
}

export default function GearDetailClient({ slug, initialListing }: { slug: string; initialListing?: NonNullable<import("convex/server").FunctionReturnType<typeof api.catalog.getListingBySlug>> }) {
  const { focusedId } = useGafferFocus();
  const liveListing = useQuery(api.catalog.getListingBySlug, { slug });
  const listing = liveListing === undefined ? initialListing : liveListing;
  const reviewStats = useQuery(api.reviews.stats, {});

  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search),
      s = q.get("start"),
      e = q.get("end");
    const valid = (d: string | null) =>
      !!d &&
      /^\d{4}-\d{2}-\d{2}$/.test(d) &&
      Number.isFinite(Date.parse(`${d}T00:00:00Z`)) &&
      new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
    if (
      valid(s) &&
      valid(e) &&
      e! >= s! &&
      Date.parse(e!) - Date.parse(s!) <= 365 * 86400000 &&
      Date.parse(s!) <= Date.now() + 730 * 86400000
    ) {
      setStart(s);
      setEnd(e);
      const [y, m] = s!.split("-").map(Number);
      setMonth(new Date(y, m - 1, 1));
    }
  }, []);
  const [imgIdx, setImgIdx] = useState(0);
  const galleryTouchStart = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => setImgIdx(0), [slug]);
  const bookingPanelRef = useRef<HTMLDivElement>(null);
  const [bookingActionVisible, setBookingActionVisible] = useState(false);
  const canBook = !!listing && !(listing as any).displayOnly && (listing as any).bookable !== false;
  const [month, setMonth] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const track = useMutation(api.analytics.track);
  const [registered, setRegistered] = useState(false);

  // The shared Gaffer launcher is fixed to the bottom of the viewport. When
  // the product date shortcut is present, move both the launcher and its chat
  // panel above that dock so it cannot cover the price or booking action.
  useEffect(() => {
    const body = document.body;
    if (canBook && !bookingActionVisible) body.dataset.mobileBookingDock = "true";
    else delete body.dataset.mobileBookingDock;
    return () => {
      if (body.dataset.mobileBookingDock === "true") delete body.dataset.mobileBookingDock;
    };
  }, [canBook, bookingActionVisible]);

  function handleGalleryTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) {
      galleryTouchStart.current = null;
      return;
    }
    const touch = event.touches[0];
    galleryTouchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleGalleryTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    const start = galleryTouchStart.current;
    galleryTouchStart.current = null;
    if (!start || event.changedTouches.length !== 1 || gallery.length < 2) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Let the browser keep vertical page scrolling. Only a deliberate,
    // predominantly horizontal gesture changes the selected product photo.
    if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    setImgIdx((current) => (current + (dx < 0 ? 1 : -1) + gallery.length) % gallery.length);
  }

  function pick(iso: string) {
    const next = pickRentalDates(start, end, iso);
    setStart(next.start);
    setEnd(next.end);
  }

  const unavailable = useMemo(
    () => expandUnavailable(listing?.unavailableDates ?? []),
    [listing?.unavailableDates],
  );
  const days = start && end ? daysInclusive(start, end) : 0;

  useEffect(() => {
    const panel = bookingPanelRef.current;
    const action = panel?.querySelector<HTMLElement>('[data-testid="booking-add-to-kit"]');
    if (!action || !canBook || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => setBookingActionVisible(entry.isIntersecting && entry.intersectionRatio >= 0.99),
      { rootMargin: "0px 0px -72px 0px", threshold: [0, 0.99, 1] },
    );
    observer.observe(action);
    return () => observer.disconnect();
  }, [canBook, listing?._id]);

  if (listing === undefined)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-7xl px-6 py-10">
          <div className="h-4 w-24 animate-pulse rounded bg-charcoal-800" />
          <div className="mt-8 grid gap-10 lg:grid-cols-2">
            <div>
              <div className="aspect-[4/3] animate-pulse rounded-2xl bg-charcoal-800" />
              <div className="mt-6 h-3 w-1/4 animate-pulse rounded bg-charcoal-800" />
              <div className="mt-3 h-7 w-2/3 animate-pulse rounded bg-charcoal-800" />
              <div className="mt-4 h-3 w-full animate-pulse rounded bg-charcoal-800" />
            </div>
            <div className="h-96 animate-pulse rounded-2xl bg-charcoal-800/60" />
          </div>
        </main>
      </>
    );
  if (listing === null)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-7xl px-6 py-24 text-center">
          <div className="hud-label">404 · Reel not found</div>
          <p className="mt-4 text-white/40">
            That listing doesn&apos;t exist (anymore).
          </p>
          <Link href="/gear" className="btn-ghost mt-6 px-6 py-2.5 text-sm">
            Back to gear
          </Link>
        </main>
      </>
    );

  const gallery = listing.gallery.length
    ? listing.gallery
    : ([listing.heroImage].filter(Boolean) as string[]);
  const hero = gallery[Math.min(imgIdx, gallery.length - 1)] ?? null;
  const k: any = (listing as any).knowledge ?? {};

  function jumpToBookingPanel() {
    const panel = bookingPanelRef.current;
    if (!panel) return;
    const action = start && end ? panel.querySelector<HTMLElement>('[data-testid="booking-add-to-kit"]') : null;
    const target = action ?? panel;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: action ? "center" : "start" });
    window.setTimeout(() => target.focus({ preventScroll: true }), reduceMotion ? 0 : 350);
  }

  return (
    <>
      <SiteHeader />
      <main data-listing-id={listing._id} data-gaffer-focused={focusedId === listing._id || undefined} className="section-window mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 sm:py-10">
        <Link
          href="/gear"
          className="group inline-flex items-center gap-1.5 text-sm text-white/40 transition-colors hover:text-white"
        >
          <IconChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          All gear
        </Link>

        <div className="mt-5 grid gap-6 sm:mt-6 sm:gap-10 lg:grid-cols-2">
          {/* gallery + copy */}
          <div className="page-in min-w-0">
            <div
              className="spot gradient-border group relative touch-pan-y overflow-hidden rounded-2xl"
              data-testid="product-photo-gallery"
              onTouchStart={handleGalleryTouchStart}
              onTouchEnd={handleGalleryTouchEnd}
              onTouchCancel={() => { galleryTouchStart.current = null; }}
            >
              <SmartImage fit="contain" loading="eager"
                key={hero ?? "none"}
                src={hero}
                fallbackSources={gallery}
                alt={listing.title}
                className="aspect-[3/2] sm:aspect-video lg:aspect-[4/3]"
                imgClassName="transition-transform duration-700 ease-out group-hover:scale-[1.04]"
              />
              {gallery.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setImgIdx((imgIdx - 1 + gallery.length) % gallery.length)}
                    aria-label="Previous product photo"
                    className="absolute left-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg backdrop-blur-md transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300 lg:hidden"
                  >
                    <IconChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setImgIdx((imgIdx + 1) % gallery.length)}
                    aria-label="Next product photo"
                    className="absolute right-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg backdrop-blur-md transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300 lg:hidden"
                  >
                    <IconChevronRight className="h-5 w-5" />
                  </button>
                  <span aria-live="polite" className="absolute bottom-3 right-3 z-10 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 font-mono text-[10px] text-white/85 backdrop-blur-md lg:hidden">
                    {imgIdx + 1} / {gallery.length}
                  </span>
                </>
              )}
              <div
                className="pointer-events-none absolute left-3 top-3 hidden sm:block"
                aria-hidden
              >
                <span className="hud-label rounded bg-black/45 px-2 py-1">
                  {listing.category} <span className="tick">/</span>{" "}
                  {String(Math.min(imgIdx + 1, gallery.length)).padStart(2, "0")}—
                  {String(gallery.length).padStart(2, "0")}
                </span>
              </div>
            </div>
            {gallery.length > 1 && (
              <div className="mt-3 flex gap-2.5 overflow-x-auto pb-2">
                {gallery.map((g, i) => (
                  <button
                    key={i}
                    onClick={() => setImgIdx(i)}
                    aria-label={`Photo ${i + 1} of ${gallery.length}`}
                    aria-pressed={i === imgIdx}
                    className={`w-16 shrink-0 overflow-hidden rounded-lg transition-all sm:w-20 ${
                      i === imgIdx
                        ? "ring-2 ring-accent-400"
                        : "opacity-55 ring-1 ring-white/10 hover:opacity-90"
                    }`}
                  >
                    <SmartImage fit="contain" src={g} alt={`${listing.title} — photo ${i + 1}`} className="aspect-square" />
                  </button>
                ))}
              </div>
            )}

            <span className="hud-label mt-7 block !text-accent-400/90">
              {listing.category}
            </span>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-white lg:text-4xl">
              {listing.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              {reviewStats && reviewStats.count > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                  <span className="text-amber-300">★</span>{" "}
                  {reviewStats.average}
                  <span className="text-white/40">
                    {" "}
                    · {reviewStats.count} verified hires
                  </span>
                </span>
              )}
              {((listing as any).demandScore ?? 0) >= 120 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-2.5 py-1 font-medium text-accent-200">
                  Crew favourite
                </span>
              ) : ((listing as any).demandScore ?? 0) >= 30 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-white/60">
                  Popular with London crews
                </span>
              ) : null}
              <ShareButton title={listing.title} />
            </div>
            <p className="mt-4 text-balance leading-relaxed text-white/60">
              {listing.description || k.summary ||
                `Professional ${listing.category.toLowerCase()} for hire in London. Pick your dates and the longer you rent, the better the per-day rate. Delivered across London or collect central.`}
            </p>

            {listing.description ? <RentalContentsList listing={listing}/> : null}
            {Array.isArray(k.features) && k.features.length > 0 && (
              <ul className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {k.features.slice(0, 6).map((f: string, i: number) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 text-sm text-white/65"
                  >
                    <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-accent-400">
                      <IconCheck className="h-3 w-3" />
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}

            {!!(k.bestFor?.length || k.tips?.length || k.limits?.length) && (
              <div className="spot mt-6 space-y-5 rounded-2xl p-5 text-sm">
                {k.bestFor?.length > 0 && (
                  <div>
                    <div className="hud-label">Best for</div>
                    <div className="mt-1.5 capitalize text-white/70">
                      {k.bestFor.join("  ·  ")}
                    </div>
                  </div>
                )}
                {k.tips?.length > 0 && (
                  <div>
                    <div className="hud-label">Pro tips</div>
                    <ul className="mt-1.5 space-y-1.5 text-white/65">
                      {k.tips.slice(0, 3).map((t: string, i: number) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-accent-400">›</span>
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {k.limits?.length > 0 && (
                  <div>
                    <div className="hud-label">Good to know</div>
                    <ul className="mt-1.5 space-y-1.5 text-white/55">
                      {k.limits.slice(0, 3).map((t: string, i: number) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-amber-400/80">!</span>
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* booking — or, for display-only items, register interest */}
          <div
            id="rental-booking-panel"
            ref={bookingPanelRef}
            tabIndex={-1}
            aria-label="Choose rental dates and add this listing to your kit"
            className="page-in min-w-0 scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60 lg:sticky lg:top-24 lg:self-start"
            style={{ animationDelay: "0.15s" }}
          >
            {(listing as any).displayOnly ? (
              <div className="spot gradient-border rounded-2xl p-6">
                <span className="rounded-full bg-sky-500/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-300">
                  Display only
                </span>
                <h2 className="mt-3 font-display text-lg font-semibold text-white/90">
                  Not available to book directly
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  This item is shown for reference. Register your interest and
                  we&apos;ll let you know if it comes into the hire range — it
                  also tells us what crews want us to stock.
                </p>
                <button
                  onClick={() => {
                    setRegistered(true);
                    track({
                      type: "register_interest",
                      path: listing.slug,
                      listingId: listing._id,
                      title: listing.title,
                      qty: 1,
                      sessionId: getSessionId(),
                    }).catch(() => {});
                  }}
                  disabled={registered}
                  className={`mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition ${registered ? "bg-emerald-500/85 text-white" : "btn-primary"}`}
                >
                  {registered ? (
                    <>
                      <IconCheck className="h-4 w-4" /> Interest registered
                    </>
                  ) : (
                    "Register interest"
                  )}
                </button>
              </div>
            ) : (listing as any).bookable === false ? (
              <div className="spot gradient-border rounded-2xl p-6">
                <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-100">
                  Inventory check
                </span>
                <h2 className="mt-3 font-display text-lg font-semibold text-white/90">
                  Let’s check this kit for you
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/60">
                  We can’t offer online dates until the live equipment record is confirmed. Ask us to check whether we can supply this kit and what it includes. No booking or payment is created here.
                </p>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("dbc:open-gaffer-chat"))}
                  className="btn-primary mt-5 flex w-full items-center justify-center rounded-full py-3 text-sm font-semibold"
                >
                  Ask Gaffer to check
                </button>
              </div>
            ) : (
              <BookingPanel
                listing={listing as any}
                start={start}
                end={end}
                month={month}
                onPick={pick}
                onMonthChange={setMonth}
                unavailable={unavailable}
                demand={(listing as any).demandScore ?? 0}
                touchFriendlyCalendar
              />
            )}
          </div>
        </div>

        <Recommendations
          slug={listing.slug}
          start={start}
          end={end}
          days={days}
        />
      </main>
      {canBook && !bookingActionVisible && (
        <div data-testid="mobile-booking-jump-bar" data-mobile-booking-dock="true" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-charcoal-950/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-10px_36px_rgba(0,0,0,.35)] backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <p className="min-w-0 shrink-0 whitespace-nowrap text-[11px] text-white/55 min-[360px]:text-xs">
              From <strong className="ml-1 font-display text-sm text-accent-300 min-[360px]:text-base">£{listing.pricing.daily}</strong><span className="ml-0.5">/day</span>
            </p>
            <button
              type="button"
              data-testid="mobile-gaffer-trigger"
              aria-label="Ask Gaffer about this listing"
              onClick={() => window.dispatchEvent(new CustomEvent("dbc:open-gaffer-chat", { detail: { prompt: `Tell me about ${listing.title}` } }))}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-accent-300/30 bg-white/[0.04] px-2.5 text-xs font-semibold text-accent-200 transition hover:border-accent-300/60 hover:bg-accent-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300 min-[360px]:px-3"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 4.5h13v9h-8l-4 3v-12Z" />
                <path d="M6.5 8h7M6.5 10.5h4" />
              </svg>
              <span>Gaffer</span>
            </button>
            <button
              type="button"
              data-testid="mobile-booking-jump"
              aria-controls="rental-booking-panel"
              onClick={jumpToBookingPanel}
              className="btn-primary min-h-11 min-w-0 flex-1 whitespace-nowrap px-1.5 text-[11px] min-[360px]:px-5 min-[360px]:text-sm"
            >
              {start && end ? <><span className="hidden min-[360px]:inline">Review price &amp; add</span><span className="min-[360px]:hidden">Review &amp; add</span></> : "Choose dates"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
