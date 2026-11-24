"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function ReferralPanel({ token }: { token: string }) {
  const data = useQuery(api.referrals.mine, { token });
  const [copied, setCopied] = useState(false);

  if (data === undefined) return <section className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-sky-200/15 bg-[radial-gradient(ellipse_at_100%_0%,rgba(140,198,215,.12),transparent_58%),linear-gradient(145deg,rgba(140,198,215,.05),rgba(18,20,20,.96)_68%)] p-3" aria-label="Referral reward" data-testid="renter-referral-tile"><div className="flex items-center gap-2 text-sky-100/70"><PeopleMark/><p className="text-[11px] font-medium uppercase tracking-[.15em]">Pass the camera on</p></div><p className="mt-3 text-xs text-white/65">Preparing your invite code…</p></section>;
  if (!data) return <section className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-sky-200/15 bg-[radial-gradient(ellipse_at_100%_0%,rgba(140,198,215,.12),transparent_58%),linear-gradient(145deg,rgba(140,198,215,.05),rgba(18,20,20,.96)_68%)] p-3" aria-label="Referral reward" data-testid="renter-referral-tile"><div className="flex items-center gap-2 text-sky-100/70"><PeopleMark/><p className="text-[11px] font-medium uppercase tracking-[.15em]">Pass the camera on</p></div><p className="mt-3 text-[11px] leading-4 text-white/65">Your friend gets £10 off their first rental. Earn 40% off your next after their paid, verified return.</p><a href="/legal/referrals" className="mt-auto inline-flex min-h-8 items-end pt-3 text-xs text-sky-100/75 underline decoration-sky-100/25 underline-offset-4">Referral terms <span aria-hidden="true" className="ml-1">↗</span></a></section>;
  const referral = data;

  async function copy() {
    if (!referral.code) return;
    try {
      await navigator.clipboard.writeText(referral.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  const rewardStatus = referral.reward
    ? `40% reward ready · expires ${new Date(referral.reward.expiresAt).toLocaleDateString("en-GB")}`
    : referral.rewardUsed
      ? "Reward used"
      : referral.rewardGranted
        ? "Reward expired"
        : referral.waiting
          ? "Reward unlocks after their return"
          : null;

  return <section className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-sky-200/15 bg-[radial-gradient(ellipse_at_100%_0%,rgba(140,198,215,.12),transparent_58%),linear-gradient(145deg,rgba(140,198,215,.05),rgba(18,20,20,.96)_68%)] p-3 transition hover:border-sky-100/25" aria-label="Referral reward" data-testid="renter-referral-tile">
    <div className="flex items-center gap-2 text-sky-100/70"><PeopleMark/><p className="text-[11px] font-medium uppercase tracking-[.15em]">Pass the camera on</p></div>
    <h3 className="mt-2 font-display text-sm leading-tight text-white">Their first film. Your next one.</h3>
    <p data-testid="referral-benefit-summary" className="mt-1 text-[11px] leading-4 text-white/55">Your friend gets £10 off their first rental. Earn 40% off your next after their paid, verified return.</p>
    <button type="button" onClick={copy} disabled={!referral.code} data-testid="copy-referral-code" aria-label={`Copy referral code ${referral.code ?? ""}`} className="mt-2 flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-sky-200/20 bg-sky-100/[.04] px-3 py-1.5 text-xs transition hover:border-sky-100/35 hover:bg-sky-100/[.08] disabled:opacity-60"><span className="min-w-0 truncate font-mono text-sm tracking-wide text-sky-100">{referral.code ?? "Creating code…"}</span><span className="shrink-0 text-white/65" aria-live="polite">{copied ? "Copied ✓" : "Copy code"}</span></button>
    {rewardStatus && <p className="mt-2 truncate text-[11px] leading-4 text-emerald-100/75" role="status">{rewardStatus}</p>}
    <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[10px] leading-4 text-white/45"><span className="min-w-0 truncate">One per account · one use · 3 months</span><a href="/legal/referrals" title="Rental charges only; one price benefit per checkout; security terms stay unchanged; no self-referrals." className="shrink-0 text-sky-100/70 underline decoration-sky-100/25 underline-offset-4">Terms <span aria-hidden="true">↗</span></a></div>
  </section>;
}

function PeopleMark() {
  return <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true"><circle cx="15" cy="15" r="5"/><circle cx="33" cy="15" r="5"/><path d="M4 36c0-14 22-14 22 0M22 36c0-14 22-14 22 0M20 13h8M19 39l5 4 5-4"/></svg>;
}
