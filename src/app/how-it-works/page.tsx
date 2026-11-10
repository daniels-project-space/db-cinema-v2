import {publicPageMetadata} from "@/lib/pageMetadata";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { IconArrowRight, IconClock, IconBolt } from "@/components/icons";
import { BadgeBrowse, BadgeCalendar, BadgeLock, BadgeTruck } from "@/components/AnimatedIcons";
import { HOURS_WINDOWS } from "@/lib/site";

export const metadata = publicPageMetadata("/how-it-works",'How to hire equipment in London','Choose equipment, check your dates, complete booking and verification, then collect in central London or arrange local delivery.');

const STEPS = [
  ["01", "Browse", "Find the gear you need by category — cameras, lenses, lighting, audio and more. Each listing shows live availability and multi-day rates.", BadgeBrowse],
  ["02", "Pick your dates", "Choose your start and end date on the calendar. The longer you rent, the better the per-day rate — applied automatically. Add suggested kit in one tap.", BadgeCalendar],
  ["03", "Book & pay securely", "Checkout shows the rental total and the security terms that apply before you confirm. Your accepted agreement explains whether any refundable payment, card authorisation or saved-card permission applies.", BadgeLock],
  ["04", "Pickup or delivery", "Collect from central London or get it delivered locally. Shoot, then return it on your end date — that's it.", BadgeTruck],
] as const;
const MOBILE_STEP_COPY = [
  "Explore cameras, lenses, lighting and audio. Listings show current availability and rental rates.",
  "Choose start and end dates. Multi-day rates apply automatically; add suggested kit in one tap.",
  "Review the rental total and security terms at checkout before you confirm.",
  "Collect in central London or choose local delivery. Return the kit by the agreed time.",
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-14">
        <PageHero
          eyebrow="How it works"
          lead="Rent in"
          accent="four steps"
          titleClassName="text-[clamp(1.85rem,8vw,3rem)] sm:text-6xl"
          sub="From first browse to back on set, here is the whole flow in four easy steps."
        />

        {/* timeline */}
        <Reveal className="relative mt-8 sm:mt-12">
          <div className="timeline-line left-[19px] hidden sm:block" aria-hidden />
          <div className="flex flex-col gap-3 sm:gap-6">
            {STEPS.map(([n, h, p, Icon], i) => (
              <Reveal key={n} delay={i * 110}>
                <div className="relative flex gap-6 sm:pl-14">
                  <span
                    className="absolute left-0 top-1 hidden h-10 w-10 items-center justify-center rounded-full border border-accent-400/30 bg-charcoal-950 font-mono text-xs text-accent-300 accent-glow sm:flex"
                    aria-hidden
                  >
                    {n}
                  </span>
                  <div className="spot gradient-border flex-1 rounded-2xl p-4 sm:p-6">
                    <div className="flex items-start gap-3 sm:gap-5">
                      <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-500/10 text-accent-400 sm:h-14 sm:w-14">
                        <Icon className="h-8 w-8 sm:h-10 sm:w-10" />
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] font-semibold tracking-[0.18em] text-accent-300/75 sm:hidden">STEP {n}</div>
                        <h2 className="font-display text-lg font-semibold leading-tight text-white/90 sm:mt-0 sm:text-xl">{h}</h2>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-white/55 sm:hidden">{MOBILE_STEP_COPY[i]}</p>
                        <p className="mt-2 hidden text-sm leading-relaxed text-white/50 sm:block">{p}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Reveal>

        <div className="mt-7 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4">
          <Reveal delay={60}>
            <div className="spot h-full rounded-2xl p-4 text-sm leading-relaxed text-white/50 sm:p-6">
              <div className="flex items-center gap-2.5">
                <IconBolt className="h-4 w-4 text-accent-400" />
                <span className="font-display font-semibold text-white/80">Discounts &amp; offers</span>
              </div>
              <p className="mt-2.5 hidden sm:block">
                Multi-day rates apply automatically, and spending over £300 unlocks add-on deals.
              </p>
              <p className="mt-2.5 sm:hidden">
                Multi-day savings apply automatically. Spend over £300 for add-on offers.
              </p>
            </div>
          </Reveal>
          <Reveal delay={130}>
            <div className="spot h-full rounded-2xl p-4 text-sm leading-relaxed text-white/50 sm:p-6">
              <div className="flex items-center gap-2.5">
                <IconClock className="h-4 w-4 text-accent-400" />
                <span className="font-display font-semibold text-white/80">Opening hours &amp; delivery</span>
              </div>
              <p className="mt-2.5 hidden sm:block">
                Pickup, return and delivery windows are{" "}
                {HOURS_WINDOWS.map((w, i) => (
                  <span key={w.opens}>
                    <span className="font-mono text-white/70">{w.opens}–{w.closes}</span>
                    {i < HOURS_WINDOWS.length - 1 ? " and " : ""}
                  </span>
                ))}
                , every day. You choose your time slots at checkout. Local delivery is quoted by distance and item
                size as a round trip (delivery + collection), within ~30km of central London — beyond that, pickup
                only. Delivery uses a third-party courier; times are estimates and may be affected by traffic.
              </p>
              <p className="mt-2.5 sm:hidden">
                Daily time slots: {HOURS_WINDOWS.map((w, i) => `${w.opens}–${w.closes}${i < HOURS_WINDOWS.length - 1 ? " · " : ""}`)}. Choose times at checkout. Local delivery covers delivery and collection within about 30 km. Courier times are estimates.
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal className="mt-7 sm:mt-10">
          <Link href="/gear" className="btn-primary px-7 py-3">
            Start browsing
            <IconArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </main>
    </>
  );
}
