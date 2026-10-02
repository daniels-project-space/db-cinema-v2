"use client";
import type { MemberTier } from "@/lib/membership";
import { SubscriptionBenefitSymbol } from "./SubscriptionBenefitSymbol";

/** One benefits card for the public plans and signed-in account settings. */
export function MembershipPlanCard({
  tier,
  onSelect,
  disabled,
  label,
  compact = false,
}: {
  tier: MemberTier;
  onSelect: () => void;
  disabled?: boolean;
  label: string;
  compact?: boolean;
}) {
  const featured = tier.key === "pro";
  return (
    <article
      data-membership-plan={tier.key}
      className={`relative flex h-full min-w-0 flex-col overflow-hidden rounded-3xl ${compact ? "p-5" : "p-6"} ${featured ? "spot border-beam accent-glow-lg bg-white/[0.045] ring-1 ring-accent-400/30" : "spot"}`}
    >
      {featured && (
        <div
          className="pointer-events-none absolute -top-20 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full bg-accent-500/20 blur-[70px]"
          aria-hidden="true"
        />
      )}
      <p
        className={`mb-4 w-fit rounded-full px-3 py-1 font-mono text-[9px] uppercase tracking-[.15em] ${featured ? "bg-accent-500/20 text-accent-300" : "bg-white/5 text-white/45"}`}
      >
        {featured
          ? "Most popular"
          : tier.key === "studio"
            ? "For the bigger picture"
            : "Your next chapter"}
      </p>
      <h2 className="font-display text-2xl font-bold text-white">
        {tier.name}
      </h2>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-[.16em] text-white/40">
        Monthly subscription
      </p>
      <div className="mt-3 flex items-baseline gap-1">
        <span
          className={`font-poster gradient-text ${compact ? "text-4xl" : "text-5xl"}`}
        >
          £{tier.monthlyGbp}
        </span>
        <span className="text-sm text-white/40">/mo</span>
      </div>
      <div className="mt-3 rounded-xl border border-emerald-300/15 bg-emerald-300/[.04] px-3 py-3">
        <p className="font-display text-lg font-semibold text-emerald-200">
          £{tier.monthlyCredit.toFixed(2)} to spend
        </p>
        <p className="mt-1 text-[10px] leading-4 text-white/50">
          Each paid month · {tier.creditBonusPct}% extra credit
        </p>
      </div>
      <ul
        className={`mt-5 flex-1 space-y-3 ${compact ? "text-xs" : "text-sm"} leading-relaxed text-white/60`}
      >
        {tier.perks.slice(1).map((perk, index) => (
          <li key={perk} className="flex gap-2.5">
            <SubscriptionBenefitSymbol benefit={perk} index={index} />
            <span>{perk}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className={`mt-6 w-full py-3 text-xs disabled:opacity-40 ${featured ? "btn-primary" : "btn-ghost"}`}
      >
        {label}
      </button>
    </article>
  );
}
