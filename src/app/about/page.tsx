import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { CountUp } from "@/components/CountUp";
import { IconArrowRight } from "@/components/icons";

export const metadata = { title: "About — Db Cinema Rentals" };

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-3xl px-6 py-14">
        <PageHero
          eyebrow="About us"
          lead="Cinema gear,"
          accent="ready to roll"
          sub="We keep London film crews rolling with pro gear that just works, and people who actually pick up the phone."
        />

        <Reveal className="mt-10">
          <p className="serif-accent border-l-2 border-accent-400/50 pl-5 text-2xl leading-snug text-white/80 sm:text-3xl">
            We started out renting our own kit between shoots — and grew into one
            of the most-reviewed gear hosts in the city.
          </p>
        </Reveal>

        <div className="mt-10 flex flex-col gap-5 leading-relaxed text-white/55">
          <Reveal delay={60}>
            <p>
              Db Cinema Rentals is a London-based hire house for professional film
              and photography equipment — cinema cameras, lenses, lighting, audio,
              stabilisers and more.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <p>
              Every item is owned, maintained and tested by us. Whether you&apos;re
              shooting a short film, a music video, a wedding or a brand campaign,
              you get pro gear at fair daily rates — and the longer you rent, the
              more you save.
            </p>
          </Reveal>
          <Reveal delay={180}>
            <p>
              We offer pickup from central London or local delivery, with a simple,
              secure booking process and a refundable deposit. Thousands of happy
              renters later, our mission is the same: keep great gear working on
              great projects.
            </p>
          </Reveal>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-4 text-center">
          {[
            { v: 4.86, d: 2, s: "", label: "average rating" },
            { v: 875, d: 0, s: "+", label: "verified reviews" },
            { v: 200, d: 0, s: "+", label: "items for hire" },
          ].map((x, i) => (
            <Reveal key={x.label} delay={i * 80}>
              <div className="spot gradient-border rounded-2xl p-5">
                <div className="font-poster text-3xl text-accent-400">
                  <CountUp value={x.v} decimals={x.d} suffix={x.s} />
                </div>
                <div className="hud-label mt-2">{x.label}</div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-10">
          <Link href="/gear" className="btn-primary px-7 py-3">
            Browse the catalogue
            <IconArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>

        {/* Creative Collective */}
        <Reveal className="mt-14">
          <div className="spot gradient-border overflow-hidden rounded-2xl p-7 sm:p-9">
            <span className="hud-label !text-accent-400/90">Work with us</span>
            <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
              Join the <span className="serif-accent gradient-text text-[1.06em]">Creative Collective</span>
            </h2>
            <p className="mt-3 max-w-xl leading-relaxed text-white/55">
              Got pro gear sitting idle, or you&apos;re a cinematographer, editor or operator for hire? List your kit and
              earn 40% of every rental, or add your profile to our crew roster and get booked on London shoots. Every
              application is reviewed by hand.
            </p>
            <Link href="/join" className="btn-primary mt-6 px-7 py-3">
              Join the Collective
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
      </main>
    </>
  );
}
