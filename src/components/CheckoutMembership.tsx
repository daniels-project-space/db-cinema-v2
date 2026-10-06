"use client";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
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
  compact: compactLayout = false,
  loading = false,
}: {
  variant?: "basket" | "checkout";
  compact?: boolean;
  loading?: boolean;
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
    membershipOffer?: {
      tier: string;
      netSaving: number;
      state: "join" | "selected" | "current";
    } | null;
    securityWaiverReason?: string;
  };
}) {
  const { me } = useAccount(),
    [open, setOpen] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consentId = useId();
  const card = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const lastCard = useRef<{tier: string; height: number} | null>(null);
  useEffect(
    () => () => {
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!selected?.termsAccepted) {
      setCelebrating(false);
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    }
  }, [selected?.termsAccepted, selected]);
  const quotedOffer = appliedSavings?.membershipOffer;
  const current =
      appliedSavings && "membershipOffer" in appliedSavings
        ? quotedOffer?.state === "current"
          ? TIERS.find((t) => t.key === quotedOffer.tier)
          : undefined
        : me?.membershipActive
          ? TIERS.find((t) => t.key === me.membershipTier)
          : undefined,
    chosen = selected ? TIERS.find((t) => t.key === selected.tier) : undefined,
    recommend = suggestions?.find((offer) => offer.netSaving > 0),
    recommendedTier = TIERS.find((t) => t.key === recommend?.tier) ?? TIERS[0],
    tier = chosen ?? current;
  const quotedTier = TIERS.find((t) => t.key === quotedOffer?.tier);
  // Callers fence quotes by the full basket/account request key. A finished
  // quote owns its offer and amount; monthly fees are not a quote identifier.
  const appliedNetSaving = appliedSavings
    ? appliedSavings.membershipNetSaving
    : selected
      ? suggestions?.find((offer) => offer.tier === selected.tier)?.netSaving ?? 0
      : 0;
  const potentialNetSaving = recommend
    ? Math.round(recommend.netSaving * 100) / 100
    : 0;
  const saving = quotedOffer
    ? quotedOffer.netSaving
    : tier
      ? appliedNetSaving
      : potentialNetSaving;
  const pending = loading && !appliedSavings && !recommend && !!lastCard.current;
  const showMembershipCard =
    pending || !!selected || saving > 0 || (!!current && !appliedSavings);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open && !removeOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setRemoveOpen(false);
      }
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
  }, [open, removeOpen]);
  const displayTier = quotedTier ?? tier ?? recommendedTier;
  useEffect(() => {
    if (loading || !showMembershipCard || !card.current) return;
    if (lastCard.current && lastCard.current.tier !== displayTier.key &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const transition = content.current?.animate(
        [{opacity: 0.3, transform: 'translateY(4px)'}, {opacity: 1, transform: 'translateY(0)'}],
        {duration: 240, easing: 'cubic-bezier(0.16,1,0.3,1)'},
      );
      lastCard.current = {tier: displayTier.key, height: card.current.getBoundingClientRect().height};
      return () => transition?.cancel();
    }
    lastCard.current = {tier: displayTier.key, height: card.current.getBoundingClientRect().height};
  }, [loading, showMembershipCard, displayTier.key]);
  const savingsHook =
    saving > 0 ? `Subscribe to save £${saving.toFixed(2)}` : null;
  const confirmed = !!selected?.termsAccepted;
  const confirmSelection = () => {
    if (current || confirmed) return;
    onChange({
      tier: selected?.tier ?? recommendedTier.key,
      intro: "none",
      termsAccepted: true,
    });
    setCelebrating(true);
    if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    celebrationTimer.current = setTimeout(() => setCelebrating(false), 2200);
  };
  const compact = compactLayout || variant === "checkout";
  const removeSelection = () => {
    if (variant === "checkout") setRemoveOpen(true);
    else onChange(null);
  };
  const benefits = [
    `Pay £${displayTier.monthlyGbp}/month → £${displayTier.monthlyCredit.toFixed(2)} credit to spend`,
    "Credit stacks monthly · valid for one year",
    ...(displayTier.weekend
      ? [
          "Subscription-exclusive weekends · 2-for-1 / 3-for-2 · £100 saving cap",
        ]
      : []),
    displayTier.key === "studio"
      ? "One London delivery included each month"
      : `${displayTier.deliveryPct}% off future delivery`,
    "Future rentals: no upfront deposit · applicable card hold remains",
    displayTier.filmFund
      ? "Film Fund entry included when applications open"
      : "Film Fund entry £15/project when applications open",
  ];
  return (
    <>
    {showMembershipCard && <section
      ref={card}
      data-testid="membership-upsell"
      aria-busy={pending || undefined}
      style={pending ? {minHeight: lastCard.current?.height} : undefined}
      data-membership-compact={compact || undefined}
      aria-label="Subscription for your rental"
      data-membership-selected={confirmed || undefined}
      data-membership-celebrating={celebrating || undefined}
      className={`membership-pitch relative my-3 rounded-2xl border border-white/15 ${compact ? "p-2.5" : "p-4"}`}
    >
      <div className="membership-pitch-rim" aria-hidden="true" />
      {!current && !pending && (
        <button
          type="button"
          data-testid={!selected ? "add-membership" : "confirm-membership-card"}
          className="membership-card-select absolute inset-0 z-[1] rounded-2xl"
          aria-label={
            confirmed
              ? `${displayTier.name} subscription selected`
              : saving > 0
                ? savingsHook!
                : `Confirm ${displayTier.name} subscription at £${displayTier.monthlyGbp} per month`
          }
          aria-pressed={confirmed}
          aria-describedby={consentId}
          onClick={confirmSelection}
        />
      )}
      {celebrating && (
        <div
          className="membership-celebration absolute inset-0 z-[3] overflow-hidden rounded-2xl"
          aria-hidden="true"
          data-testid="membership-celebration"
        >
          <div className="membership-selection-wave" />
          <div className="membership-selection-shimmer" />
          {Array.from({ length: 36 }, (_, i) => {
            const angle = (i * Math.PI * 2) / 36;
            return (
              <i
                key={i}
                className={`membership-confetti ${i % 3 === 0 ? "membership-confetti-star" : ""}`}
                style={
                  {
                    "--confetti-x": `${Math.cos(angle) * (70 + (i % 6) * 16)}px`,
                    "--confetti-y": `${Math.sin(angle) * (100 + (i % 5) * 25) - 45}px`,
                    "--confetti-spin": `${(i % 2 ? 1 : -1) * (160 + i * 19)}deg`,
                    "--confetti-delay": `${(i % 6) * 24}ms`,
                    background: ["#ffe59a", "#a8f0b8", "#fff8e7", "#68e6c6"][
                      i % 4
                    ],
                  } as CSSProperties
                }
              />
            );
          })}
        </div>
      )}
      <div ref={content} className="membership-pitch-content pointer-events-none relative z-[2]">
        {pending ? <div role="status" className="py-2">
          <div aria-hidden="true" className="h-8 w-4/5 rounded-lg bg-white/5 motion-safe:animate-pulse" />
          <p className="mt-3 text-[10px] text-white/45">Updating rental savings…</p>
        </div> : <>
        {savingsHook ? (
          <h3
            data-testid={
              tier
                ? "applied-membership-savings"
                : "potential-membership-savings"
            }
            className="font-display text-3xl font-semibold leading-tight tracking-tight text-white"
          >
            {savingsHook}
          </h3>
        ) : !appliedSavings ? (
          <div
            role="status"
            aria-label="Calculating savings"
            className="h-14 rounded-lg bg-white/5 motion-safe:animate-pulse"
          />
        ) : null}
        <div className={`${compact ? "mt-1" : "mt-2"} flex items-center justify-between gap-2`}>
          <p className="font-mono text-[9px] uppercase tracking-[.15em] text-white/50">
            {displayTier.name} subscription · £{displayTier.monthlyGbp}/month
          </p>
          {compact && selected && <button type="button" data-testid="remove-membership" onClick={removeSelection} className="shrink-0 text-[10px] text-white/45 underline">Remove membership</button>}
        </div>
        {compact ? (
          <>
            {!current && <label className="mt-1 flex cursor-pointer items-start gap-2 text-[9px] leading-[14px] text-white/55">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#acd17c]"
                checked={confirmed}
                onChange={(e) => {
                  if (e.target.checked) confirmSelection();
                  else if (selected) removeSelection();
                }}
              />
              <span id={consentId}>
              Selecting this card confirms the{" "}
              <Link
                href="/legal/membership"
                target="_blank"
                className="underline"
              >
                subscription terms
              </Link>{" "}
              and £{displayTier.monthlyGbp}/month renewal. Cancel in account settings.
              </span>
            </label>}
            {selected && <span role="status" className="sr-only">
                {confirmed ? "Membership added · consent confirmed" : "Membership added · confirm terms"}
              </span>}
          </>
        ) : (
          <>
            {savingsHook && (
              <p className="mt-1 text-[10px] text-white/45">
                Net saving includes today’s membership fee.
              </p>
            )}
            {!current && (
              <ul
                aria-label="Future subscription benefits"
                className="mt-3 grid gap-1.5 text-[11px] text-white/70"
              >
                {benefits.map((benefit, index) => (
                  <li key={benefit} className="flex items-center gap-2">
                    <SubscriptionBenefitSymbol
                      benefit={benefit}
                      index={index}
                    />
                    <span
                      className={
                        index === 0 ? "font-medium text-white/90" : undefined
                      }
                    >
                      {benefit}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!current && (
              <p
                id={consentId}
                className="mt-2 text-[10px] leading-4 text-white/55"
              >
                {confirmed ? "Selected · " : "Tap anywhere to add. "}Selecting
                this card confirms the{" "}
                <Link
                  href="/legal/membership"
                  target="_blank"
                  className="underline"
                >
                  membership terms
                </Link>{" "}
                and £{displayTier.monthlyGbp}/month renewal. Cancel in account
                settings.
              </p>
            )}
            {!current && !selected && (
              <button
                type="button"
                onClick={confirmSelection}
                className="btn-primary mt-3 w-full py-2.5 text-xs"
              >
                Start my membership now
              </button>
            )}
            {selected && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span role="status" className="text-[10px] text-emerald-300">
                    {selected.termsAccepted
                      ? "Membership added · consent confirmed"
                      : "Membership added · confirm terms"}
                  </span>
                  <button
                    type="button"
                    data-testid="remove-membership"
                    onClick={removeSelection}
                    className="text-[10px] text-white/45 underline"
                  >
                    Remove membership
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {!current && (
          <p className={compact ? "mt-1 text-[9px] leading-3 text-white/45" : "mt-2 text-[10px] leading-4 text-white/45"}>
            {compact
              ? "First rental: normal verification & refundable security. Other perks start next booking."
              : "This first rental still requires verification and normal upfront refundable security. Other perks start on future bookings."}
          </p>
        )}
        {variant !== "checkout" && <button
          type="button"
          data-testid="membership-benefits"
          onClick={() => setOpen(true)}
          className="mt-2 text-[10px] text-white/55 underline underline-offset-4"
        >
          See the subscription benefits
        </button>}
        </>}
      </div>
    </section>}
      {removeOpen && createPortal(
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 p-5 backdrop-blur-lg" onClick={() => setRemoveOpen(false)}>
          <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${consentId}-remove-title`} aria-describedby={`${consentId}-remove-copy`} data-testid="membership-remove-dialog" onClick={e => e.stopPropagation()} className="w-full max-w-sm rounded-3xl border border-accent-300/25 bg-[#151a17] p-6 shadow-[0_0_70px_#acd17c12]">
            <h2 id={`${consentId}-remove-title`} className="font-display text-3xl text-white">Are you sure?</h2>
            <p id={`${consentId}-remove-copy`} className="mt-3 text-sm leading-6 text-white/65">
              {saving > 0 ? <>If you remove the subscription, you’ll lose <strong className="text-accent-200">£{saving.toFixed(2)} in savings on this booking</strong> and the other great membership benefits.</> : <>Removing the subscription also removes its credit and future membership benefits.</>}
            </p>
            <div className="mt-5 grid gap-2">
              <button type="button" data-testid="keep-membership" onClick={() => setRemoveOpen(false)} className="btn-primary w-full py-3 text-sm">{saving > 0 ? "Keep my savings" : "Keep my membership"}</button>
              <button type="button" data-testid="confirm-remove-membership" onClick={() => {setRemoveOpen(false);onChange(null);}} className="w-full rounded-xl border border-white/10 py-3 text-xs text-white/55">Remove membership</button>
            </div>
          </div>
        </div>, document.body
      )}
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
                {savingsHook ?? `${displayTier.name} subscription`}
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/50">
                Your £{displayTier.monthlyGbp} monthly fee becomes £{displayTier.monthlyCredit.toFixed(2)} in rental credit,
                stacking for a year.
              </p>
              <div className="mt-6">
                {[displayTier].map((t) => {
                  return (
                  <div
                    key={t.key}
                    data-testid={`membership-benefit-${t.key}`}
                    className={`rounded-2xl border p-4 ${t.key === recommend?.tier ? "border-accent-300/40 bg-accent-300/[.05]" : "border-white/10"}`}
                  >
                    <p className="text-lg text-white">{t.name}</p>
                    <p className="mt-1 text-[10px] text-white/40">
                      Monthly subscription
                    </p>
                    <p className="mt-2 text-2xl text-accent-200">
                      £{t.monthlyGbp}
                      <span className="text-xs text-white/40"> / month</span>
                    </p>
                    <p className="mt-1 text-xs text-white/70">
                      £{t.monthlyCredit.toFixed(2)} monthly credit
                    </p>
                    <ul className="mt-4 space-y-2 text-[11px] leading-5 text-white/45">
                      {t.perks.slice(2).map((p, index) => (
                        <li key={p} className="flex items-start gap-2">
                          <SubscriptionBenefitSymbol
                            benefit={p}
                            index={index}
                          />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                    {!current && (
                      <>
                      <p className="mt-4 text-[10px] leading-4 text-white/55">
                        Selecting confirms the <Link href="/legal/membership" target="_blank" className="underline">membership terms</Link> and £{t.monthlyGbp}/month renewal. Cancel in account settings.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          confirmSelection();
                          setOpen(false);
                        }}
                        className="btn-ghost mt-4 w-full py-2 text-xs"
                      >
                        {confirmed ? "Membership selected" : "Start my membership now"}
                      </button>
                      </>
                    )}
                  </div>
                );})}
              </div>
              <p className="mt-5 text-xs text-white/40">
                Paid monthly membership. This first rental still requires
                verification and normal refundable security. Cancel renewal in
                account settings.
              </p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
