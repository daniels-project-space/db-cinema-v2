"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { TIERS } from "@/lib/membership";
import { useAccount } from "./account/AccountProvider";
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
}: {
  suggestions?: Suggestion[];
  selected: MembershipSelection | null;
  onChange: (s: MembershipSelection | null) => void;
  appliedSavings?: {
    weekendSaving: number;
    rentalSaving: number;
    deliveryReduction: number;
    membershipFee: number;
    membershipCreditApplied: number;
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
  return (
    <section
      data-testid="membership-upsell"
      aria-label="Membership for your rental"
      className={`relative my-5 overflow-hidden rounded-2xl border p-5 ${tier ? "border-accent-300/30 bg-gradient-to-br from-accent-300/10 via-white/[.035] to-transparent shadow-[0_0_40px_#acd17c0d]" : "border-white/15 bg-gradient-to-br from-white/[.07] to-white/[.015] shadow-[0_0_30px_#ffffff05]"}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-white/[.06] blur-3xl"
      />
      <div className="relative">
        <p className="font-mono text-[9px] uppercase tracking-[.2em] text-white/40">
          {tier
            ? `${tier.name} · your creative edge`
            : "Make this rental go further"}
        </p>
        <h3 className="mt-2 text-lg font-medium text-white">
          {tier
            ? `£${tier.monthlyCredit.toFixed(2)} credit every paid month`
            : "Get more from the kit you love."}
        </h3>
        {tier && appliedSavings && appliedNetSaving > 0 && (
          <div
            data-testid="applied-membership-savings"
            className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-accent-300/15 bg-black/10 p-4"
          >
            <div>
              <p className="font-poster text-3xl text-accent-200">
                £{appliedNetSaving.toFixed(2)}
              </p>
              <p className="mt-1 text-[10px] text-white/45">
                {appliedSavings.membershipFee > 0
                  ? "Net savings after today’s membership fee"
                  : "Lower rental / delivery charges"}
              </p>
            </div>
            <div className="space-y-2 text-[11px] text-white/60">
              {appliedSavings.membershipCreditApplied > 0 && <p>First-month credit used · £{appliedSavings.membershipCreditApplied.toFixed(2)}</p>}

              {tier.weekend && appliedSavings.weekendSaving > 0 && (
                <p>
                  Weekend savings · £{appliedSavings.weekendSaving.toFixed(2)}
                </p>
              )}
              {appliedSavings.deliveryReduction > 0 && (
                <p>
                  Delivery benefit · £
                  {appliedSavings.deliveryReduction.toFixed(2)}
                </p>
              )}
            </div>
          </div>
        )}
        {tier && appliedSavings?.securityWaiverReason && (
          <p className="mt-3 text-xs text-accent-200">
            £0 upfront security · full hold remains
          </p>
        )}
        {!tier && recommend && potentialNetSaving > 0 && (
          <div
            data-testid="potential-membership-savings"
            className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-white/15 bg-white/[.035] p-4"
          >
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/45">
                Your basket could save
              </p>
              <p className="mt-1 font-poster text-3xl text-white">
                £{potentialNetSaving.toFixed(2)}
              </p>
              <p className="text-[10px] text-white/40">
                {recommend.initialFee > 0
                  ? "Includes today’s membership fee"
                  : `Rental + delivery with ${recommend.name}`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-white/80">
                £{(recommend.membershipCreditApplied || recommend.monthlyCredit).toFixed(2)}
              </p>
              <p className="text-[10px] text-white/45">{recommend.membershipCreditApplied > 0 ? "credit used on this rental" : "credit / paid month"}</p>
            </div>
          </div>
        )}
        {!tier && !!recommend?.membershipSignupOfferSaving && <p className="mt-3 text-xs text-accent-200">Includes a one-time £{recommend.membershipSignupOfferSaving} {recommend.name} welcome discount.</p>}
        {current ? (
          <p className="mt-2 text-xs leading-6 text-white/55">
            Your membership perks are included in the confirmed price below.
            Full card hold still applies.
            {me?.membershipStatus === "trialing"
              ? " The free week alone does not waive the upfront security payment."
              : ""}
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs leading-6 text-white/55">
              {chosen
                ? `${chosen.name} is included in this checkout. Pay £${chosen.monthlyGbp}/month and receive £${chosen.monthlyCredit.toFixed(2)} credit each paid month.${selected?.intro === "trial" ? " The free week earns no monthly credit." : " Your first paid month’s credit is applied to this rental."}`
                : recommend && potentialNetSaving > 0
                  ? `${recommend.name} is recommended for today’s basket: save £${potentialNetSaving.toFixed(2)} on this order${recommend.initialFee > 0 ? " after today’s membership fee" : " with the free first week"}. Then £${recommend.monthlyFee}/month, earning £${recommend.monthlyCredit.toFixed(2)} credit each paid month.`
                  : `From £${recommendedTier.monthlyGbp}/month. Earn £${recommendedTier.monthlyCredit.toFixed(2)} rental credit every paid month. Choose a plan now; your basket savings update automatically.`}
            </p>
            {!selected && (
              <button
                data-testid="add-membership"
                onClick={() =>
                  onChange({
                    tier: recommendedTier.key,
                    intro: recommend?.intro ?? "none",
                    termsAccepted: false,
                  })
                }
                className="mt-4 inline-flex min-h-11 items-center gap-3 rounded-full border border-white/25 bg-white/10 px-5 py-2.5 text-sm font-medium text-white transition hover:border-accent-300/50 hover:bg-accent-300/10"
              >
                Add {recommendedTier.name} · one checkout
              </button>
            )}
            {selected && chosen && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-accent-200">
                    {selected.intro === "trial"
                      ? `7 days free, then £${chosen.monthlyGbp}/month`
                      : `£${chosen.monthlyGbp} today, then monthly`}
                  </p>
                  <button
                    onClick={() => onChange(null)}
                    className="text-[11px] text-white/45 underline"
                  >
                    Remove membership
                  </button>
                </div>
                {!me?.membershipIntroUsed && (
                  <div className="flex flex-wrap gap-2">
                    {(["trial", "none"] as const).map((intro) => (
                      <button
                        key={intro}
                        aria-pressed={selected.intro === intro}
                        onClick={() =>
                          onChange({ ...selected, intro, termsAccepted: false })
                        }
                        className={`rounded-lg border px-3 py-2 text-[11px] ${selected.intro === intro ? "border-accent-300/40 text-accent-200" : "border-white/10 text-white/40"}`}
                      >
                        {intro === "trial"
                          ? "First week free"
                          : "Start paid membership now"}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[11px] leading-5 text-white/45">
                  {selected.intro === "trial"
                    ? "The free week alone does not waive the upfront security payment."
                    : "This first rental still requires verification and the upfront refundable security payment."}{" "}
                  Full card hold still applies. {selected.intro === "trial"
                    ? "The free week earns no monthly credit."
                    : `£${(appliedSavings?.membershipCreditApplied ?? 0).toFixed(2)} of your first-month credit is used on this rental. Any unused balance is issued after successful payment, lasts one year and stacks with future monthly credit.`}
                </p>
                <label className="flex items-start gap-2 text-[11px] text-white/55">
                  <input
                    type="checkbox"
                    checked={selected.termsAccepted}
                    onChange={(e) =>
                      onChange({ ...selected, termsAccepted: e.target.checked })
                    }
                  />
                  <span>
                    I accept the{" "}
                    <Link
                      href="/legal/membership"
                      className="text-accent-300 underline"
                    >
                      membership terms
                    </Link>
                    , selected offer and monthly renewal. Cancel in account
                    settings.
                  </span>
                </label>
              </div>
            )}
          </>
        )}
        {!current && <>
          <ul className="mt-3 grid gap-1.5 text-[11px] text-white/55" aria-label="Future membership benefits">
            <li>✦ Monthly rental credit · stacks for one year</li>
            <li>✦ Future paid-member rentals · no upfront security payment</li>
            <li>✦ {(chosen ?? recommendedTier).key === "studio" ? "One London delivery each month" : `${(chosen ?? recommendedTier).deliveryPct}% off future delivery`}</li>
            {(chosen ?? recommendedTier).weekend && <li>✦ Future weekend deals · save up to £100</li>}
            {(chosen ?? recommendedTier).filmFund && <li>✦ Film Fund entry included · coming soon</li>}
          </ul>
          <p className="mt-3 text-[10px] leading-5 text-white/40">This checkout applies the best single saving: credit or an eligible offer. Verification, the upfront refundable security payment and the full card hold still apply. Other perks start after this booking is confirmed, for future rentals.</p>
        </>}
        <button
          onClick={() => setOpen(true)}
          className="mt-3 text-[11px] text-white/55 underline underline-offset-4"
        >
          See the membership benefits
        </button>
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
              aria-label="Membership benefits"
              className="relative max-h-[85vh] w-full max-w-3xl overflow-auto rounded-3xl border border-accent-300/20 bg-[#151a17] p-6 sm:p-9"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setOpen(false)}
                className="absolute right-5 top-4 text-sm text-white/55"
                aria-label="Close membership benefits"
              >
                ✕
              </button>
              <p className="text-[10px] uppercase tracking-[.2em] text-accent-300">
                Keep the momentum
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
                    <p className="mt-2 text-2xl text-accent-200">
                      £{t.monthlyGbp}
                      <span className="text-xs text-white/40"> / month</span>
                    </p>
                    <p className="mt-1 text-xs text-white/70">
                      £{t.monthlyCredit.toFixed(2)} monthly credit
                    </p>
                    <ul className="mt-4 space-y-2 text-[11px] leading-5 text-white/45">
                      {t.perks.slice(2).map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                    {!current && (
                      <button
                        onClick={() => {
                          onChange({
                            tier: t.key,
                            intro: me?.membershipIntroUsed
                              ? "none"
                              : (selected?.intro ?? recommend?.intro ?? "none"),
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
                Free week: security payment still applies; no monthly credit
                until a fee is paid. Cancel renewal in account settings.
              </p>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
