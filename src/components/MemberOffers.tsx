"use client";

import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { useAccount } from "@/components/account/AccountProvider";

/** Member-only deals, shown in a distinct gold frame (vs the blue regular offers). */
export function MemberOffers() {
  const offers = useQuery(api.promo.memberOffers, {}) ?? [];
  const account = useAccount();
  const isMember = !!account.me?.membershipActive;
  if (offers.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-xl font-semibold text-amber-200">Member-only offers</h2>
        <span className="rounded-full border border-amber-400/30 bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
          ✦ exclusive
        </span>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {offers.map((o: any) => (
          <div
            key={o._id}
            className="relative overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/[0.12] to-amber-300/[0.02] p-5 shadow-[0_0_45px_-22px_rgba(251,191,36,0.6)]"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display font-semibold text-white/90">{o.title}</h3>
              <span className="shrink-0 rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold text-black">
                {o.badge}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white/55">{o.blurb}</p>
            {isMember ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-amber-400/40 bg-black/30 px-3 py-1.5 font-mono text-sm tracking-wide text-amber-200">
                  {String(o.code).toUpperCase()}
                </span>
                <span className="text-xs text-white/40">apply at checkout</span>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-3">
                <span className="select-none rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-sm text-white/30 blur-[3px]">
                  MEMBERS
                </span>
                <Link href="/membership" className="text-xs font-medium text-amber-300 hover:underline">
                  Join to unlock →
                </Link>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
