"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { useAccount } from "@/components/account/AccountProvider";
import { TIERS, BENEFITS } from "@/lib/membership";
import { Reveal } from "@/components/Reveal";
import { MemberOffers } from "@/components/MemberOffers";

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
        <div className="text-center">
          <div className="mb-2 text-xs uppercase tracking-widest text-accent-400">Membership</div>
          <h1 className="font-display text-4xl font-bold text-white/90">
            Rent more, <span className="gradient-text">pay less</span>
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-white/40">
            Save on every rental, all year. Cancel anytime. Discounts stack on top of
            your multi-day rates and never below our floor.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {TIERS.map((t, i) => {
            const isCurrent = current === t.key;
            const featured = t.key === "pro";
            return (
              <Reveal key={t.key} delay={i * 70}>
                <div
                  className={`lift flex h-full flex-col rounded-3xl p-6 ${
                    featured
                      ? "gradient-border bg-white/[0.04] ring-1 ring-accent-400/30"
                      : "glass"
                  }`}
                >
                  {featured && (
                    <div className="mb-3 w-fit rounded-full bg-accent-500/20 px-3 py-0.5 text-[11px] font-medium text-accent-300">
                      Most popular
                    </div>
                  )}
                  <h2 className="font-display text-2xl font-bold text-white/90">{t.name}</h2>
                  <div className="mt-2">
                    <span className="font-display text-4xl font-bold gradient-text">£{t.monthlyGbp}</span>
                    <span className="text-sm text-white/40">/mo</span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-emerald-300">{t.pct}% off every rental</div>
                  <ul className="mt-5 flex-1 space-y-2 text-sm text-white/55">
                    {t.perks.map((p) => (
                      <li key={p} className="flex gap-2">
                        <span className="text-accent-400">✓</span> {p}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => subscribe(t.key)}
                    disabled={isCurrent || busy === t.key}
                    className="press mt-6 rounded-full bg-accent-500 py-3 font-medium text-white transition-colors hover:bg-accent-600 disabled:opacity-40"
                  >
                    {isCurrent ? "Your plan" : busy === t.key ? "…" : `Get ${t.name}`}
                  </button>
                </div>
              </Reveal>
            );
          })}
        </div>
        {err && <div className="mt-4 text-center text-sm text-red-300">{err}</div>}

        {/* benefit comparison chart */}
        <div className="mt-16 overflow-x-auto">
          <h2 className="font-display text-2xl font-bold text-white/90">What's included</h2>
          <table className="mt-5 w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="py-3 text-left font-medium text-white/40">Benefit</th>
                {TIERS.map((t) => (
                  <th key={t.key} className="px-3 py-3 text-center font-display font-semibold text-white/85">
                    {t.name}
                    <div className="text-[11px] font-normal text-white/35">£{t.monthlyGbp}/mo</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BENEFITS.map((b) => (
                <tr key={b.label} className="border-b border-white/5">
                  <td className="py-3 text-white/60">{b.label}</td>
                  {TIERS.map((t) => {
                    const v = b.get(t);
                    return (
                      <td key={t.key} className="px-3 py-3 text-center">
                        {v === true ? (
                          <span className="text-emerald-400">✓</span>
                        ) : v === false ? (
                          <span className="text-white/15">—</span>
                        ) : (
                          <span className="font-medium text-white/85">{v}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <MemberOffers />

        <p className="mt-8 text-center text-xs text-white/30">
          Billed monthly via Stripe · cancel anytime from your account · TEST MODE — no real charge.
        </p>
      </main>
    </>
  );
}
