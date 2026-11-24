import { publicPageMetadata } from "@/lib/pageMetadata";
import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { IconArrowRight, IconClock, IconBolt } from "@/components/icons";
import { BadgeBrowse, BadgeCalendar, BadgeLock, BadgeTruck } from "@/components/AnimatedIcons";
import { HOURS_WINDOWS } from "@/lib/site";
import { currentLegalVersion } from "@/lib/currentLegalVersion";
import { CancellationPolicyQuickGuide } from "@/components/CancellationPolicyQuickGuide";

export const metadata = publicPageMetadata(
  "/how-it-works",
  "How to hire cinema equipment in London",
  "Choose your gear, set rental dates, pay securely, complete any required verification, then collect in Trafalgar Square or arrange local delivery.",
);
export const dynamic = "force-dynamic";

const FLOW_IMAGE = "/images/home/rental-flow-atlas-20261103-fixed.webp";
const VERIFICATION_DEADLINE_VERSIONS = ["2026-11-v30", "2026-11-v31", "2026-11-v32", "2026-11-v33", "2026-11-v34"];

const STEPS = [
  {
    number: "01",
    title: "Browse",
    body: "Explore real kit listings, live dates and clear rental rates.",
    note: "Build your kit",
    Icon: BadgeBrowse,
    position: "0% 0%",
  },
  {
    number: "02",
    title: "Pick your dates",
    body: "Choose rental dates first. Set exact pickup and return times at checkout.",
    note: "Dates first · times at checkout",
    Icon: BadgeCalendar,
    position: "100% 0%",
  },
  {
    number: "03",
    title: "Book & pay securely",
    body: "Review the full total and security terms before paying. Payment alone is not confirmation.",
    note: "Payment + required verification",
    Icon: BadgeLock,
    position: "0% 100%",
  },
  {
    number: "04",
    title: "Pickup or delivery",
    body: "Collect in Trafalgar Square or choose delivery. Exact meeting details follow payment, any required checks and confirmation.",
    note: "Ready for your shoot",
    Icon: BadgeTruck,
    position: "100% 100%",
  },
] as const;

export default async function HowItWorksPage() {
  const cancellationVersion = await currentLegalVersion();
  const hasVerificationDeadline = VERIFICATION_DEADLINE_VERSIONS.includes(cancellationVersion);

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-[1440px] px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-10 lg:px-8">
        <Reveal>
          <section className="relative grid overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#11100e] shadow-[0_28px_90px_-48px_rgba(218,168,100,.46)] sm:rounded-[2.25rem] lg:grid-cols-[.88fr_1.12fr]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_18%_0%,rgba(212,172,107,.15),transparent_45%)]" aria-hidden="true" />
            <div className="relative z-10 flex flex-col items-start justify-center px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-14">
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.23em] text-accent-300 sm:text-xs">
                <span className="h-px w-7 bg-accent-300/70" aria-hidden="true" />
                The rental, made simple
              </p>
              <h1 className="mt-4 max-w-[12ch] font-display text-[clamp(2.55rem,6vw,5rem)] font-semibold leading-[.98] tracking-[-.045em] text-white">
                Gear up.
                <span className="serif-accent gradient-text mt-1 block italic">Get to set.</span>
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-white/65 sm:mt-5 sm:text-base sm:leading-7">
                Find the right kit, see your price, and know what happens next — before your shoot begins.
              </p>
              <div className="mt-6 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
                <Link href="/gear" className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 text-sm">
                  Browse the gear
                  <IconArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/faq" className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 px-5 text-sm font-medium text-white/75 transition-colors hover:border-accent-300/40 hover:text-white">
                  Read the FAQs
                </Link>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 text-[11px] font-medium text-white/65 sm:mt-8">
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">Live availability</span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">Secure checkout</span>
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">Central London pickup</span>
              </div>
            </div>
            <figure className="relative isolate mx-3 mb-3 min-h-[210px] overflow-hidden rounded-[1.35rem] border border-white/10 sm:mx-4 sm:mb-4 sm:min-h-[280px] sm:rounded-[1.75rem] lg:mx-4 lg:my-4 lg:min-h-[430px]">
              <Image
                src={FLOW_IMAGE}
                alt="A camera team prepares cinema gear, checks rental dates and packs a kit before filming in London"
                width={1774}
                height={887}
                priority
                sizes="(max-width: 1023px) 100vw, 58vw"
                className="absolute inset-0 h-full w-full object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/10" aria-hidden="true" />
              <figcaption className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3 sm:bottom-5 sm:left-5 sm:right-5">
                <span className="max-w-[22ch] font-display text-sm font-medium leading-snug text-white sm:text-lg">The right tools for the story you want to tell.</span>
                <span className="shrink-0 rounded-full border border-white/20 bg-black/35 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-white/85 backdrop-blur-md">DB Cinema · London</span>
              </figcaption>
            </figure>
          </section>
        </Reveal>

        <section className="mt-12 sm:mt-16" aria-labelledby="rental-steps-title">
          <Reveal className="mb-5 flex flex-col gap-2 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-accent-300">A clear four-step flow</p>
              <h2 id="rental-steps-title" className="mt-2 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">From shortlist to shoot.</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-white/50">Your basket helps you plan. Exact handover times come later at checkout.</p>
          </Reveal>

          <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:gap-4">
            {STEPS.map(({ number, title, body, note, Icon, position }) => (
                <li key={number} data-testid="how-it-works-step" className="group h-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[.055] to-white/[.02] shadow-[0_18px_45px_-34px_rgba(0,0,0,.9)] motion-safe:transition motion-safe:duration-300 hover:-translate-y-1 hover:border-accent-300/35 hover:shadow-[0_24px_55px_-35px_rgba(212,172,107,.52)] motion-reduce:transform-none motion-reduce:transition-none">
                  <div className="relative aspect-[2/1] overflow-hidden bg-[#171512]">
                    <div
                      className="absolute inset-0 scale-[1.015] bg-no-repeat motion-safe:transition motion-safe:duration-700 motion-safe:ease-out group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none"
                      style={{ backgroundImage: `url("${FLOW_IMAGE}")`, backgroundPosition: position, backgroundSize: "200% auto" }}
                      aria-hidden="true"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-black/25" aria-hidden="true" />
                    <div className="absolute inset-x-3 top-3 flex items-start justify-between sm:inset-x-4 sm:top-4">
                      <span className="rounded-full border border-white/20 bg-black/45 px-2.5 py-1 font-mono text-[10px] tracking-[.12em] text-white/90 backdrop-blur-md">STEP {number}</span>
                      <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent-200/25 bg-black/45 text-accent-200 shadow-[0_0_24px_rgba(212,172,107,.2)] backdrop-blur-md sm:h-11 sm:w-11">
                        <Icon className="h-7 w-7" />
                      </span>
                    </div>
                  </div>
                  <div className="flex h-full flex-col px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5 sm:pt-4">
                    <h3 className="font-display text-base font-semibold leading-tight text-white sm:text-lg">{title}</h3>
                    <p className="mt-2 text-xs leading-5 text-white/60 sm:text-[13px] sm:leading-[1.55rem]">{body}</p>
                    <p className="mt-4 border-t border-white/[.08] pt-3 text-[10px] font-semibold uppercase tracking-[.11em] text-accent-200/80">{note}</p>
                  </div>
                </li>
            ))}
          </ol>
        </section>

        <Reveal className="mt-7 sm:mt-9">
          <section aria-labelledby="booking-confirmation-title" className="relative overflow-hidden rounded-3xl border border-accent-300/20 bg-[linear-gradient(120deg,rgba(212,172,107,.10),rgba(255,255,255,.025)_45%,rgba(10,10,10,.6))] p-5 sm:p-7">
            <div className="pointer-events-none absolute -right-10 -top-14 h-48 w-48 rounded-full bg-accent-300/[.08] blur-3xl" aria-hidden="true" />
            <div className="relative grid gap-5 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-10">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-accent-300">One important detail</p>
                <h2 id="booking-confirmation-title" className="mt-2 max-w-[22ch] font-display text-xl font-semibold leading-tight text-white sm:text-2xl">Payment starts your booking; confirmation follows any required checks.</h2>
                <p className="mt-2 max-w-xl text-xs leading-5 text-white/60 sm:text-sm sm:leading-6">If Didit verification is required, your paid booking reserves the items while it is pending. The rental is confirmed once payment and any required verification pass.</p>
              </div>
              <div>
                <ol aria-label="Booking confirmation steps" className="grid grid-cols-3 gap-2">
                  {[
                    ["01", "Payment"],
                    ["02", "Didit, if required"],
                    ["03", "Confirmed"],
                  ].map(([number, label], index) => (
                    <li key={number} className="relative flex min-w-0 flex-col items-center gap-2 text-center">
                      {index < 2 && <span className="absolute left-[calc(50%+1.15rem)] right-[calc(-50%+1.15rem)] top-[.92rem] h-px bg-gradient-to-r from-accent-300/55 to-white/15" aria-hidden="true" />}
                      <span className="relative z-10 grid h-8 w-8 place-items-center rounded-full border border-accent-200/30 bg-[#181512] font-mono text-[10px] text-accent-100 shadow-[0_0_18px_rgba(212,172,107,.18)]">{number}</span>
                      <span className="max-w-[12ch] text-[10px] font-semibold leading-4 text-white/80 sm:text-xs">{label}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 border-t border-white/10 pt-3 text-[10px] leading-4 text-white/45 sm:text-xs sm:leading-5">
                  {hasVerificationDeadline
                    ? "Current terms require Didit to approve required checks by two hours after the earliest scheduled London pickup. Late approval may need manual permission."
                    : "Follow the verification deadline shown for your rental and in the terms you accept at checkout."}
                  {" "}
                  <Link href="/legal/terms" className="font-semibold text-accent-200 underline decoration-accent-200/40 underline-offset-2 hover:text-accent-100">Read the rental terms</Link>.
                </p>
              </div>
            </div>
          </section>
        </Reveal>

        <section className="mt-8 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4" aria-label="Collection and delivery details">
          <Reveal delay={50}>
            <article className="h-full rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent-300/15 bg-accent-300/[.07] text-accent-200"><IconClock className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <h3 className="font-display text-sm font-semibold text-white">Collection &amp; return windows</h3>
                  <p className="mt-0.5 text-[10px] text-white/45">Daily · choose exact times at checkout</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {HOURS_WINDOWS.map(window => <span key={window.opens} className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 font-mono text-[11px] text-white/75">{window.opens}–{window.closes}</span>)}
              </div>
            </article>
          </Reveal>
          <Reveal delay={110}>
            <article className="h-full rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent-300/15 bg-accent-300/[.07] text-accent-200"><BadgeTruck className="h-7 w-7" /></span>
                <div className="min-w-0">
                  <h3 className="font-display text-sm font-semibold text-white">Trafalgar Square or delivery</h3>
                  <p className="mt-0.5 text-[10px] text-white/45">Exact meeting details follow confirmation</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-white/55">Choose courier delivery + collection, or one-way delivery and return the kit to Trafalgar Square. Checkout quotes delivery by postcode and kit size within the available area; timings are estimates.</p>
            </article>
          </Reveal>
        </section>

        <Reveal className="mt-9 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 sm:mt-12 sm:px-5">
          <p className="flex items-center gap-2 text-xs text-white/60 sm:text-sm"><IconBolt className="h-4 w-4 shrink-0 text-accent-300" />Multi-day rates and eligible account savings are shown in your quote.</p>
          <Link href="/membership" className="shrink-0 text-xs font-semibold text-accent-200 transition-colors hover:text-white">Membership details <span aria-hidden="true">→</span></Link>
        </Reveal>

        <Reveal className="mt-10 sm:mt-14">
          <CancellationPolicyQuickGuide version={cancellationVersion} />
        </Reveal>

        <Reveal className="mt-8 flex flex-col items-start justify-between gap-3 rounded-3xl border border-accent-300/20 bg-[radial-gradient(ellipse_at_90%_50%,rgba(212,172,107,.12),transparent_46%),rgba(255,255,255,.025)] p-5 sm:flex-row sm:items-center sm:px-7 sm:py-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-accent-300">Ready when you are</p>
            <h2 className="mt-1 font-display text-xl font-semibold text-white sm:text-2xl">Let’s build your kit.</h2>
          </div>
          <Link href="/gear" className="btn-primary inline-flex min-h-11 w-full items-center justify-center gap-2 px-5 text-sm sm:w-auto">
            Explore available gear
            <IconArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </main>
    </>
  );
}
