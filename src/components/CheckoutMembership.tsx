"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { TIERS } from "@/lib/membership";
import { useAccount } from "./account/AccountProvider";
import { SubscriptionBenefitSymbol } from "./SubscriptionBenefitSymbol";
type Suggestion = {
  intro: "trial" | "none";
  membershipCreditApplied: number;
  membershipSignupOfferSaving: number;
  tier: string;
  name: string;
  monthlyFee: number;
  monthlyCredit: number;
  rentalSaving: number;
  deliverySaving: number;
  initialFee: number;
  netSaving: number;
  depositWaived: boolean;
};
import type { MembershipSelection } from "../../shared/membershipSelection";
export type { MembershipSelection } from "../../shared/membershipSelection";
export function CheckoutMembership({
  suggestions,
  selected,
  onChange,
  appliedSavings,
  variant = "basket",
}: {
  variant?: "basket" | "checkout";
  suggestions?: Suggestion[];
  selected: MembershipSelection | null;
  onChange: (s: MembershipSelection | null) => void;
  appliedSavings?: {
    weekendSaving: number;
    rentalSaving: number;
    deliveryReduction: number;
    membershipFee: number;
    membershipCreditApplied: number;
    membershipSignupOfferSaving?: number;
    membershipNetSaving: number;
    securityWaiverReason?: string;
  };
}) {
  const { me } = useAccount(),
    [open, setOpen] = useState(false);
  const current = me?.membershipActive
      ? TIERS.find((t) => t.key === me.membershipTier)
      : undefined,
    chosen = selected ? TIERS.find((t) => t.key === selected.tier) : undefined,
    recommend = suggestions?.[0],
    recommendedTier = TIERS.find((t) => t.key === recommend?.tier) ?? TIERS[0],
    tier = chosen ?? current;
  // Only credit actually used in this checkout counts as an immediate saving.
  const appliedNetSaving = appliedSavings?.membershipNetSaving ?? 0;
  const potentialNetSaving = recommend
    ? Math.round(recommend.netSaving * 100) / 100
    : 0;
  const showMembershipCard = !!tier || potentialNetSaving > 0;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMembershipCard) setOpen(false);
  }, [showMembershipCard]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab") {
        const nodes = dialog.current?.querySelectorAll<HTMLElement>(
          'button, a[href], input, [tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.body.style.overflow = scroll;
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [open]);
  if (!showMembershipCard) return null;
  const displayTier = tier ?? recommendedTier;
  const saving = tier ? appliedNetSaving : potentialNetSaving;
  const welcome = selected ? appliedSavings?.membershipSignupOfferSaving ?? 0 : recommend?.membershipSignupOfferSaving ?? 0;
  const add = (accepted = false) => onChange({ tier: recommendedTier.key, intro: "none", termsAccepted: accepted });
  const compact = variant === "checkout" && !selected && !current;
  const benefits = [
    `£${displayTier.monthlyCredit.toFixed(2)} monthly credit · stacks for a year`,
    displayTier.key === "studio" ? "One London delivery / month" : `${displayTier.deliveryPct}% off future delivery`,
    displayTier.weekend ? "Future weekend deals · up to £100 saved" : "Future rentals · no upfront security",
  ];
  return (
    <section data-testid="membership-upsell" data-membership-compact={compact || undefined} aria-label="Subscription for your rental"
      className={`membership-pitch relative my-3 rounded-2xl border border-white/15 ${compact ? "p-3" : "p-4"}`}>
      <div className="membership-pitch-rim" aria-hidden="true" />
      <div className="relative z-[1]">
        <p className="font-mono text-[9px] uppercase tracking-[.15em] text-white/50">{displayTier.name} subscription · £{displayTier.monthlyGbp}/month</p>
        {compact ? <>
          <label className="mt-2 flex cursor-pointer items-start gap-3 text-white">
            <input data-testid="add-membership" type="checkbox" className="mt-1 h-4 w-4 accent-[#acd17c]" checked={false} onChange={e=>{if(e.target.checked)add(true);}} />
            <span data-testid="potential-membership-savings" className="font-display text-base font-semibold">Subscribe and save £{potentialNetSaving.toFixed(2)} on this rental now</span>
          </label>
          <p className="mt-2 text-[10px] leading-4 text-white/45">Ticking confirms the <Link href="/legal/membership" target="_blank" className="underline">subscription terms</Link> and monthly renewal. Cancel in account settings.</p>
        </> : <>
          <h3 data-testid={saving > 0 ? (tier ? "applied-membership-savings" : "potential-membership-savings") : undefined} className="mt-2 font-display text-2xl font-semibold leading-tight text-white">{saving > 0 ? `Save £${saving.toFixed(2)} on this rental now!` : `£${displayTier.monthlyCredit.toFixed(2)} credit every paid month`}</h3>
          <p className="mt-1 text-[10px] text-white/45">{saving>0 ? "Net saving includes today’s membership fee." : "Your membership is reflected in the price below."}{welcome>0 ? ` Includes £${welcome} one-time joining credit.` : ""}</p>
          {!current && <ul aria-label="Future subscription benefits" className="mt-3 grid gap-1.5 text-[11px] text-white/70">{benefits.map((benefit,index)=><li key={benefit} className="flex items-center gap-2"><SubscriptionBenefitSymbol benefit={benefit} index={index}/><span>{benefit}</span></li>)}</ul>}
          {!current && !selected && <button data-testid="add-membership" onClick={()=>add()} className="btn-primary mt-3 w-full py-2.5 text-xs">Start my membership now</button>}
          {selected && <div className="mt-3 space-y-2">
            <label className="flex items-start gap-2 text-[11px] leading-5 text-white/65"><input type="checkbox" className="mt-1 accent-[#acd17c]" checked={selected.termsAccepted} onChange={e=>onChange({...selected,intro:"none",termsAccepted:e.target.checked})}/><span>I accept the <Link href="/legal/membership" target="_blank" className="text-accent-300 underline">membership terms</Link> and £{displayTier.monthlyGbp} monthly renewal. Cancel in account settings.</span></label>
            <div className="flex items-center justify-between gap-2"><span className="text-[10px] text-emerald-300">{selected.termsAccepted ? "Membership added · consent confirmed" : "Membership added · confirm terms"}</span><button onClick={()=>onChange(null)} className="text-[10px] text-white/45 underline">Remove membership</button></div>
          </div>}
        </>}
        {!current && <p className="mt-2 text-[10px] leading-4 text-white/45">{compact ? "First rental: normal verification & refundable security. Other perks start next booking." : "This first rental still requires verification and normal upfront refundable security. Other perks start on future bookings. The one-time joining credit stacks with your best single saving."}</p>}
        <button onClick={()=>setOpen(true)} className="mt-2 text-[10px] text-white/55 underline underline-offset-4">See the subscription benefits</button>
      </div>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xl"
            onClick={() => setOpen(false)}
          >
            <div
              ref={dialog}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label="Subscription benefits"
              className="relative max-h-[85vh] w-full max-w-3xl overflow-auto rounded-3xl border border-accent-300/20 bg-[#151a17] p-6 sm:p-9"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setOpen(false)}
                className="absolute right-5 top-4 text-sm text-white/55"
                aria-label="Close subscription benefits"
              >
                ✕
              </button>
              <p className="text-[10px] uppercase tracking-[.2em] text-accent-300">
                Monthly subscriptions · keep the momentum
              </p>
              <h2 className="mt-3 font-display text-3xl text-white">
                More kit. More possibility.
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/50">
                Your paid fee becomes rental credit with 10% extra on Starter,
                20% on Pro or 30% on Studio, stacking for a year. Pro and Studio
                include Film Fund application entry when it opens. One project,
                one entry.
              </p>
              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {TIERS.map((t) => (
                  <div
                    key={t.key}
                    className={`rounded-2xl border p-4 ${t.key === recommend?.tier ? "border-accent-300/40 bg-accent-300/[.05]" : "border-white/10"}`}
                  >
                    <h3 className="text-lg text-white">{t.name}</h3>
                    <p className="mt-1 text-[10px] text-white/40">Monthly subscription</p>
                    <p className="mt-2 text-2xl text-accent-200">
                      £{t.monthlyGbp}
                      <span className="text-xs text-white/40"> / month</span>
                    </p>
                    <p className="mt-1 text-xs text-white/70">
                      £{t.monthlyCredit.toFixed(2)} monthly credit
                    </p>
                    <ul className="mt-4 space-y-2 text-[11px] leading-5 text-white/45">
                      {t.perks.slice(2).map((p, index) => (
                        <li key={p} className="flex items-start gap-2"><SubscriptionBenefitSymbol benefit={p} index={index} /><span>{p}</span></li>
                      ))}
                    </ul>
                    {!current && (
                      <button
                        onClick={() => {
                          onChange({
                            tier: t.key,
                            intro: "none",
                            termsAccepted: false,
                          });
                          setOpen(false);
                        }}
                        className="btn-ghost mt-4 w-full py-2 text-xs"
                      >
                        Choose {t.name}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-5 text-xs text-white/40">
                Paid monthly membership. This first rental still requires verification and normal refundable security. Cancel renewal in account settings.
              </p>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
