"use client";

import { useState, useRef } from "react";
import { PageHero } from "@/components/PageHero";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { useAccount } from "@/components/account/AccountProvider";
import { TIERS, BENEFITS, MEMBERSHIP_TERMS_VERSION, type IntroOffer } from "@/lib/membership";
import { Reveal } from "@/components/Reveal";
import { Tilt } from "@/components/Tilt";
import Link from "next/link";
import { IconCheck } from "@/components/icons";

export default function MembershipPage() {
  const account = useAccount();
  const start = useAction(api.checkout.startMembership);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [intro, setIntro] = useState<IntroOffer>("trial");
  const [accepted, setAccepted] = useState(false);
  const request = useRef<Record<string, string>>({});

  const current = account.me?.membershipActive ? account.me.membershipTier : null;

  async function subscribe(key: string) {
    if (!account.token) {
      window.location.href = "/account";
      return;
    }
    setBusy(key);
    setErr(null);
    try {
      if (!accepted) throw Error("Please accept the membership terms.");
      const offer = account.me?.membershipIntroUsed ? "none" : intro;
      const requestKey = `${key}:${offer}`;
      request.current[requestKey] ??= crypto.randomUUID();
      const { url } = await start({ token: account.token, tier: key, origin: window.location.origin, intro: offer, termsVersion: MEMBERSHIP_TERMS_VERSION, requestId: request.current[requestKey] });
      window.location.href = url;
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't start checkout");
      setBusy(null);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-5xl px-6 py-14">
        <PageHero
          center
          eyebrow="Membership"
          lead="Keep creating."
          accent="We’ll back you."
          sub="Turn every paid month into 30% more rental credit. Build your next kit, keep your momentum, and make the films you’ve been waiting to make."
        />

        <div className="relative mx-auto mt-8 max-w-2xl overflow-hidden rounded-3xl border border-accent-300/20 bg-gradient-to-r from-accent-300/[.07] via-white/[.03] to-transparent px-6 py-5">
          <div aria-hidden className="absolute -right-8 -top-12 h-40 w-40 rounded-full bg-accent-300/10 blur-3xl" />
          <p className="font-mono text-[10px] uppercase tracking-[.2em] text-accent-300">More than a membership</p>
          <p className="mt-2 text-lg font-medium text-white">Your monthly fee stays in your creative toolkit.</p>
          <p className="mt-2 text-sm leading-relaxed text-white/55">£19 becomes £24.70. £49 becomes £63.70. £99 becomes £128.70. Credits arrive after each paid invoice, stack each month and last a year. A separate card hold protects the gear.</p>
        </div>
        {!current && <section className="mx-auto mt-8 max-w-2xl" aria-label="Choose your welcome offer">
          {!account.me?.membershipIntroUsed && <><p className="mb-3 text-center text-sm text-white/60">Choose your first chapter</p><div className="grid gap-3 sm:grid-cols-2">
            {[{ key: "trial" as const, title: "Your first week, on us", detail: "£0 membership fee for 7 days, then your plan renews monthly. The upfront security payment still applies during the free week." }, { key: "credit" as const, title: "£20 to your next production", detail: "Pay your first month today. Get a one-time £20 rental credit bonus, plus your normal 130% monthly credit." }].map(o => <button key={o.key} onClick={() => setIntro(o.key)} aria-pressed={intro === o.key} className={`rounded-2xl border p-4 text-left transition ${intro === o.key ? "border-accent-300/50 bg-accent-300/[.07] shadow-[0_0_35px_#acd17c0b]" : "border-white/10 bg-white/[.02]"}`}><span className="block text-sm font-medium text-white">{o.title}</span><span className="mt-2 block text-xs leading-relaxed text-white/45">{o.detail}</span></button>)}
          </div></>}
          <label className="mt-5 flex items-start justify-center gap-2 text-xs text-white/55"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-0.5 accent-[#acd17c]"/><span>I agree to the <Link href="/legal/membership" className="text-accent-300 underline">membership terms</Link>, monthly renewal and selected welcome offer. Cancel in account settings.</span></label>
        </section>}
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {TIERS.map((t, i) => {
            const isCurrent = current === t.key;
            const featured = t.key === "pro";
            return (
              <Reveal key={t.key} delay={i * 80}>
                <Tilt max={featured ? 5 : 4} className="h-full">
                  <div
                    className={`relative flex h-full flex-col overflow-hidden rounded-3xl p-6 ${
                      featured
                        ? "spot border-beam accent-glow-lg bg-white/[0.045] ring-1 ring-accent-400/30"
                        : "spot"
                    }`}
                  >
                    {featured && (
                      <div
                        className="pointer-events-none absolute -top-20 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full bg-accent-500/20 blur-[70px]"
                        aria-hidden
                      />
                    )}
                    {featured && (
                      <div className="mb-3 w-fit rounded-full bg-accent-500/20 px-3 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-accent-300">
                        Most popular
                      </div>
                    )}
                    <h2 className="font-display text-2xl font-bold text-white">{t.name}</h2>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="font-poster gradient-text text-5xl">£{t.monthlyGbp}</span>
                      <span className="text-sm text-white/40">/mo</span>
                    </div>
                    <div className="mt-1.5 text-sm font-medium text-emerald-300">£{t.monthlyCredit.toFixed(2)} credit every paid month</div>
                    <ul className="mt-5 flex-1 space-y-2.5 text-sm text-white/55">
                      {t.perks.map((p) => (
                        <li key={p} className="flex gap-2.5">
                          <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-accent-400">
                            <IconCheck className="h-3 w-3" />
                          </span>
                          {p}
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => subscribe(t.key)}
                      disabled={!!current || busy !== null || !accepted}
                      className={`mt-6 w-full py-3 ${featured ? "btn-primary" : "btn-ghost"}`}
                    >
                      {isCurrent ? "Your plan" : busy === t.key ? "…" : `Get ${t.name}`}
                    </button>
                  </div>
                </Tilt>
              </Reveal>
            );
          })}
        </div>
        {err && <div className="mt-4 text-center text-sm text-red-300">{err}</div>}

        {/* benefit comparison chart */}
        <Reveal className="mt-16">
          <div className="overflow-x-auto">
            <h2 className="font-display text-2xl font-bold text-white">
              What&apos;s <span className="serif-accent gradient-text text-[1.06em]">included</span>
            </h2>
            <table className="mt-5 w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="py-3 text-left font-medium text-white/40">Benefit</th>
                  {TIERS.map((t) => (
                    <th key={t.key} className="px-3 py-3 text-center font-display font-semibold text-white/85">
                      {t.name}
                      <div className="font-mono text-[11px] font-normal text-white/35">£{t.monthlyGbp}/mo</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BENEFITS.map((b) => (
                  <tr key={b.label} className="border-b border-white/5 transition-colors hover:bg-white/[0.02]">
                    <td className="py-3 text-white/60">{b.label}</td>
                    {TIERS.map((t) => {
                      const v = b.get(t);
                      return (
                        <td key={t.key} className="px-3 py-3 text-center">
                          {v === true ? (
                            <IconCheck className="mx-auto h-4 w-4 text-emerald-400" />
                          ) : v === false ? (
                            <span className="text-white/15">—</span>
                          ) : (
                            <span className="font-mono font-medium text-white/85">{v}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <div className="mt-12 rounded-3xl border border-white/10 bg-white/[.02] p-6 text-center"><p className="font-mono text-[10px] uppercase tracking-[.2em] text-white/40">DB Cinema Film Fund · coming soon</p><h2 className="mt-2 font-display text-2xl text-white">Your story deserves a set.</h2><p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/50">Two judged rounds a year. Seven days of gear for the selected project, two for the runner-up. Pro and Studio include application entry; other entries are £15, once per project. No purchases or applications are open yet.</p><Link href="/film-fund" className="mt-4 inline-block text-sm text-accent-300">Meet the Film Fund →</Link></div>
        {current && <p className="mt-6 text-center text-sm text-white/60">Your membership is active. <Link href="/account?tab=membership" className="text-accent-300 underline">Manage or cancel in account settings</Link>.</p>}

        <p className="mt-8 text-center font-mono text-[11px] uppercase tracking-[0.15em] text-white/30">
          Monthly renewal · cancel before renewal in account settings · credit is not cash
        </p>
      </main>
    </>
  );
}
