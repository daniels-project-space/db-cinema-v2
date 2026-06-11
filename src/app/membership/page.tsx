"use client";

import { useState } from "react";
import { PageHero } from "@/components/PageHero";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { useAccount } from "@/components/account/AccountProvider";
import { TIERS, BENEFITS } from "@/lib/membership";
import { Reveal } from "@/components/Reveal";
import { Tilt } from "@/components/Tilt";
import { MemberOffers } from "@/components/MemberOffers";
import { IconCheck } from "@/components/icons";

export default function MembershipPage() {
  const account = useAccount();
  const start = useAction(api.checkout.startMembership);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const current = account.me?.membershipActive ? account.me.membershipTier : null;

  async function subscribe(key: string) {
    if (!account.token) {
      window.location.href = "/account";
      return;
    }
    setBusy(key);
    setErr(null);
    try {
      const { url } = await start({ token: account.token, tier: key, origin: window.location.origin });
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
          lead="Rent more,"
          accent="pay less"
          sub="Save on every rental, all year. Cancel anytime. Discounts stack on top of your multi-day rates and never below our floor."
        />

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {TIERS.map((t, i) => {
            const isCurrent = current === t.key;
            const featured = t.key === "pro";
            return (
              <Reveal key={t.key} delay={i * 80}>
                <Tilt max={featured ? 5 : 4} className="h-full">
                  <div
                    className={`relative flex h-full flex-col overflow-hidden rounded-3xl p-6 ${
                      featured
                        ? "spot gradient-border bg-white/[0.045] ring-1 ring-accent-400/30 shadow-[0_0_60px_-22px_rgba(56,189,248,0.45)]"
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
                    <div className="mt-1.5 text-sm font-medium text-emerald-300">{t.pct}% off every rental</div>
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
                      disabled={isCurrent || busy === t.key}
                      className={`mt-6 py-3 ${featured ? "btn-primary" : "btn-ghost"}`}
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

        <MemberOffers />

        <p className="mt-8 text-center font-mono text-[11px] uppercase tracking-[0.15em] text-white/30">
          Billed monthly via Stripe · cancel anytime · test mode — no real charge
        </p>
      </main>
    </>
  );
}
