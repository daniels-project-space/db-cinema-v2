"use client";

import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@cvx/_generated/api";
import { VerificationBar } from "./VerificationProgress";
import { useVerificationRefresh } from "./useVerificationRefresh";
import { rentalStageLabel } from "../../../shared/rentalReadiness";
import { verificationBookingOpen } from "../../../shared/verificationProgress";
import { ChatAperture } from "./ChatAperture";

const checkItems = [
  { key: "identity", label: "Photo ID" },
  { key: "selfie", label: "Selfie & face match" },
  { key: "address", label: "Proof of address" },
] as const;

const checkLabels: Record<string, string> = {
  waiting: "Waiting",
  processing: "Checking",
  approved: "Passed",
  review: "Review",
  requires_input: "Upload needed",
  rejected: "Failed",
  unknown: "Not recorded",
};

function VerificationChecks({
  checks,
  verificationStatus,
}: {
  checks?: Partial<Record<(typeof checkItems)[number]["key"], string>> | null;
  verificationStatus?: string;
}) {
  return (
    <div aria-label="Document checks" className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/20 px-3 shadow-[inset_0_1px_rgba(255,255,255,.04)] sm:px-4">
      {checkItems.map(({ key, label }) => {
        const state = checks?.[key] ?? (verificationStatus === "required" ? "waiting" : "unknown");
        const stateStyle = state === "approved"
          ? "border-amber-200/15 bg-amber-200/[.08] text-amber-100"
          : state === "rejected"
            ? "border-rose-200/15 bg-rose-200/[.06] text-rose-100"
            : state === "review" || state === "requires_input"
              ? "border-amber-200/15 bg-amber-200/[.06] text-amber-100"
              : "border-white/[.08] bg-white/[.025] text-white/70";

        return (
          <div key={key} className="flex min-w-0 items-center gap-3 border-b border-white/[.08] py-3 last:border-b-0">
            <span aria-hidden="true" className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${state === "approved" ? "border-amber-200/40 bg-amber-200/[.07] text-amber-200" : "border-white/15 bg-white/[.03] text-white/50"}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">{state === "approved" ? <path d="m5 12 4.5 4.5L19 7" /> : state === "rejected" ? <path d="m8 8 8 8M16 8l-8 8" /> : <><circle cx="12" cy="12" r="7" /><path d="M12 8v4l2.5 1.5" /></>}</svg>
            </span>
            <span data-testid="verification-check-label" className="min-w-0 flex-1 text-sm font-medium leading-5 text-white/90">{label}</span>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${stateStyle}`}>{checkLabels[state] ?? "Checking"}</span>
          </div>
        );
      })}
    </div>
  );
}

function DiditReviewCard({
  bookingId,
  token,
  reason,
  sessionId,
  decisionBlocked,
  decisionBlockedMessage,
}: {
  bookingId: string;
  token: string;
  reason?: string;
  sessionId?: string;
  decisionBlocked: boolean;
  decisionBlockedMessage: string;
}) {
  const refresh = useAction(api.didit.refreshProgress);
  const openLink = useAction(api.didit.adminVerificationLink);
  const review = useAction(api.didit.adminReview);
  const [checking, setChecking] = useState(false);
  const [decision, setDecision] = useState<"approve" | "resubmit" | "decline" | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [refreshMessage, setRefreshMessage] = useState("");
  const [decisionUncertain, setDecisionUncertain] = useState(false);
  const [caseIdCopied, setCaseIdCopied] = useState(false);
  const [openingLink, setOpeningLink] = useState(false);
  const [diditIssues, setDiditIssues] = useState<Array<{feature:string;risk:string;summary:string;detail:string}>>([]);
  const decisionUnavailable = decisionBlocked || !sessionId || decisionUncertain;
    const decisionGuidance = !sessionId
    ? "Didit case ID missing · decisions are locked. Check the rental’s provider session before proceeding."
    : decisionBlocked ? decisionBlockedMessage : decisionUncertain ? "Decision uncertain · refresh the Didit status first." : "Decision updates Didit first, then syncs this rental.";

  async function copyCaseId() {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      setCaseIdCopied(true);
    } catch {
      setCaseIdCopied(false);
      setRefreshMessage("Copy unavailable · select the case ID.");
    }
  }

  async function openDiditVerification() {
    if (!sessionId || openingLink || checking || decision !== null) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setRefreshMessage("Allow pop-ups to open the Didit verification.");
      return;
    }
    popup.opener = null;
    setOpeningLink(true);
    setRefreshMessage("");
    try {
      const result = await openLink({ bookingId: bookingId as any, token });
      popup.location.replace(result.url);
      setDiditIssues(result.issues ?? []);
      setRefreshMessage(result.issues?.length ? `Didit returned ${result.issues.length} finding${result.issues.length === 1 ? "" : "s"}.` : "Didit opened · no warning detail returned.");
    } catch (error) {
      popup.close();
      setRefreshMessage(error instanceof Error ? error.message : "Could not open the Didit verification.");
    } finally {
      setOpeningLink(false);
    }
  }

  async function refreshDecision() {
    setChecking(true);
    setRefreshMessage("");
    try {
      const result = await refresh({ bookingId: bookingId as any, accountToken: token, admin: true });
      setDecisionUncertain(current => result.status === "decision_uncertain" ? true : ["updated", "unchanged", "confirmation_retry_queued"].includes(result.status) ? false : current);
      setRefreshMessage(result.status === "updated"
        ? "Didit status checked · website sync updated."
        : result.status === "decision_uncertain"
          ? "Decision still uncertain · check the Didit case before taking further action."
        : result.status === "confirmation_retry_queued"
          ? "Didit passed · booking confirmation is retrying."
          : result.status === "late_approved"
            ? "Didit approved after cutoff · rental remains pending."
            : result.status === "late"
              ? "Verification deadline passed · rental remains pending."
              : result.status === "throttled"
                ? "Checked recently · try again shortly."
                : result.status === "closed"
                  ? "Rental closed · status refresh is unavailable."
                  : result.status === "not_started"
                    ? "No Didit session is linked to this rental."
                    : result.status === "unchanged"
                      ? "No change yet · try again shortly."
                      : "Status not confirmed · open Didit or refresh again.");
    } catch (error) {
      setRefreshMessage(error instanceof Error ? error.message : "Refresh uncertain · check Didit and the rental.");
    } finally {
      setChecking(false);
    }
  }

  async function submitDecision(next: "approve" | "resubmit" | "decline") {
    if (!sessionId) {
      setRefreshMessage("Didit case ID missing · no decision was sent.");
      return;
    }
    if (decisionBlocked) {
      setRefreshMessage("Allow this rental above before deciding.");
      return;
    }
    if (decisionUncertain) {
      setRefreshMessage("Decision uncertain · refresh the Didit status first.");
      return;
    }
    if (reviewReason.trim().length < 5) {
      setRefreshMessage("Add a short reason first.");
      return;
    }
    setDecision(next);
    setRefreshMessage("");
    try {
      const result = await review({
        bookingId: bookingId as any,
        token,
        decision: next,
        note: reviewReason.trim(),
        requestId: globalThis.crypto?.randomUUID?.() ?? `review-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      const expected = next === "approve"
        ? { status: "verified", providerStatus: "Approved" }
        : next === "resubmit"
          ? { status: "requires_input", providerStatus: "Resubmitted" }
          : { status: "rejected", providerStatus: "Declined" };
      if (result.status !== expected.status || result.providerStatus !== expected.providerStatus)
        throw new Error("Didit did not confirm this decision. Refresh the case before continuing.");
      setReviewReason("");
      setRefreshMessage(next === "approve" ? "Didit approved · website verification synced; booking confirmation may still be pending." : next === "resubmit" ? "Didit requested updated information · the renter can continue verification." : "Didit declined · rental remains unconfirmed; no bonus credit applies.");
    } catch (error) {
      setDecisionUncertain(true);
      setRefreshMessage(error instanceof Error ? error.message : "Decision not confirmed · refresh the case.");
    } finally {
      setDecision(null);
    }
  }

  return (
      <section aria-label="Didit review" data-testid="didit-review-card" className="mt-3 overflow-hidden rounded-2xl border border-[#d4a86b]/25 bg-gradient-to-br from-[#3a2b1c]/40 via-[#211d18]/75 to-[#171819]/90 text-xs leading-5 shadow-[0_14px_36px_rgba(0,0,0,.24)] backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-white/[.07] px-3 py-2.5">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#e4b77d]/20 bg-[#e4b77d]/[.08] text-[#e8bb84]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
            <path d="M12 3 4.5 6v5.5c0 4.4 2.8 7.7 7.5 9.5 4.7-1.8 7.5-5.1 7.5-9.5V6L12 3Z" />
            <path d="M12 8v4m0 3h.01" />
          </svg>
        </span>
        <p className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[.14em] text-[#ddb178]">Didit review</p>
        <span className="shrink-0 rounded-full border border-amber-100/15 bg-amber-100/[.07] px-2.5 py-1 text-[10px] font-semibold text-[#f2d1a8]">{decisionUnavailable ? "Decision unavailable" : "Action needed"}</span>
      </div>

      <div className="space-y-2.5 p-3 text-[#decdb9]">
        {reason && <p className="rounded-xl border border-white/[.08] bg-black/15 px-3 py-2 text-[11px] leading-4" aria-label="Didit review reason">{reason}</p>}
        {diditIssues.length > 0 && <section aria-label="Didit findings" className="rounded-xl border border-amber-100/10 bg-amber-100/[.035] p-3">
          <p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#e4c49b]">Didit findings · {diditIssues.length}</p>
          <ul className="mt-2 space-y-2">
            {diditIssues.map((issue, index) => <li key={`${issue.feature}-${issue.risk}-${index}`} className="rounded-lg border border-white/[.06] bg-black/10 px-2.5 py-2">
              <p className="text-[10px] font-medium text-[#f0d3ad]">{issue.feature || "Verification"}{issue.risk ? ` · ${issue.risk}` : ""}</p>
              {issue.summary && <p className="mt-0.5 text-[11px] leading-4 text-[#eadfce]">{issue.summary}</p>}
              {issue.detail && <details className="mt-1">
                <summary className="cursor-pointer text-[10px] text-[#c6b5a1]">More detail</summary>
                <p className="mt-1 text-[10px] leading-4 text-[#c6b5a1]">{issue.detail}</p>
              </details>}
            </li>)}
          </ul>
        </section>}
        <div className="rounded-xl border border-white/[.08] bg-black/15 px-3 py-2">
          <div className="flex items-center justify-between gap-2"><p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#bda991]">Didit session ID</p><button type="button" aria-label="Copy Didit session ID" disabled={!sessionId} onClick={() => void copyCaseId()} className="min-h-8 shrink-0 rounded-lg border border-white/10 px-2 text-[10px] font-medium text-[#edc89f] disabled:opacity-40">{caseIdCopied ? "Copied" : "Copy ID"}</button></div>
          <code className="mt-1 block break-all font-mono text-[10px] text-[#f0e2d1]">{sessionId || "Unavailable"}</code>
        </div>
        <p data-testid="didit-review-decision-guidance" className="text-[10px] text-[#c6b5a1]">{decisionGuidance}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-label="Open Didit verification" disabled={!sessionId || openingLink || checking || decision !== null} onClick={() => void openDiditVerification()} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#d5a474]/30 bg-white/[.025] px-3 font-semibold text-[#edc89f] transition hover:bg-white/[.06] disabled:opacity-50">{openingLink ? "Opening…" : "Open verification ↗"}</button>
          <button type="button" aria-label="Check Didit status" disabled={checking || decision !== null} className="min-h-10 rounded-xl bg-gradient-to-br from-[#e4bb8e] to-[#c89b6d] px-3 font-semibold text-[#21170e] shadow-[0_8px_18px_rgba(200,155,109,.14)] transition hover:brightness-105 disabled:opacity-50" onClick={() => void refreshDecision()}>{checking ? "Checking…" : "Check Didit status"}</button>
        </div>
        <label className="block text-[10px] font-medium text-[#e4c49b]" htmlFor={`didit-review-reason-${bookingId}`}>Reason for decision</label>
        <textarea
          id={`didit-review-reason-${bookingId}`}
          value={reviewReason}
          maxLength={400}
          rows={2}
          disabled={decisionUnavailable || decision !== null || checking}
          onChange={event => setReviewReason(event.target.value)}
          placeholder="Briefly explain the decision"
          className="min-h-[56px] w-full resize-y rounded-xl border border-white/[.1] bg-black/20 px-3 py-2 text-[11px] leading-4 text-white outline-none placeholder:text-white/35 focus:border-[#e4b77d]/45 disabled:opacity-50"
        />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-label="Approve Didit review" disabled={decisionUnavailable || decision !== null || checking} onClick={() => void submitDecision("approve")} className="min-h-10 rounded-xl border border-emerald-200/20 bg-emerald-200/[.08] px-2 text-[10px] font-semibold text-emerald-100 transition hover:bg-emerald-200/[.14] disabled:opacity-50">{decision === "approve" ? "Saving…" : "Approve in Didit"}</button>
          <button type="button" aria-label="Request Didit resubmission" disabled={decisionUnavailable || decision !== null || checking} onClick={() => void submitDecision("resubmit")} className="min-h-10 rounded-xl border border-[#e4b77d]/20 bg-[#e4b77d]/[.08] px-2 text-[10px] font-semibold text-[#f0d3ad] transition hover:bg-[#e4b77d]/[.14] disabled:opacity-50">{decision === "resubmit" ? "Sending…" : "Request updated checks"}</button>
          <button type="button" aria-label="Decline Didit review" disabled={decisionUnavailable || decision !== null || checking} onClick={() => void submitDecision("decline")} className="col-span-2 min-h-10 rounded-xl border border-rose-200/20 bg-rose-200/[.06] px-2 text-[10px] font-semibold text-rose-100 transition hover:bg-rose-200/[.12] disabled:opacity-50">{decision === "decline" ? "Saving…" : "Decline in Didit"}</button>
        </div>
        {refreshMessage && <p role="status" className="rounded-xl border border-white/[.08] bg-black/15 px-3 py-2 text-[10px]">{refreshMessage}</p>}
      </div>
    </section>
  );
}

export function RentalVerificationSummary({ bookingId, token, admin = false }: { bookingId: string; token: string; admin?: boolean }) {
  const owner = useQuery(api.rentalOperations.details, admin ? { token, bookingId: bookingId as any } : "skip");
  const renter = useQuery(api.bookings.verificationProgress, admin ? "skip" : { token, bookingId: bookingId as any });
  const booking = admin ? owner : renter;
  const confirmationRecoveryPending = !!booking && booking.status === "pending_verification" && booking.idVerifyStatus === "verified";
  const refreshError = useVerificationRefresh(bookingId, token, undefined, admin, !!booking && verificationBookingOpen(booking.status) && (booking.idVerifyStatus !== "verified" || confirmationRecoveryPending), !!booking?.verificationWindowClosed || confirmationRecoveryPending);
  const refresh = useAction(api.didit.refreshProgress);
  const allowLateVerification = useMutation(api.bookings.adminAllowLateVerification);
  const [checking, setChecking] = useState(false);
  const [allowingLate, setAllowingLate] = useState(false);
  const [checkMessage, setCheckMessage] = useState("");
  const [lateMessage, setLateMessage] = useState("");
  const [lateOverrideReason, setLateOverrideReason] = useState("");
  async function checkNow() {
    if (checking) return;
    setChecking(true); setCheckMessage("");
    try {
      const result = await refresh({bookingId:bookingId as any,accountToken:token,admin:true});
      setCheckMessage(result.status === "confirmation_retry_queued" ? "Didit is approved · paid booking confirmation and live stock are being retried." : result.status === "throttled" ? "A check was recently requested. Try again shortly." : result.status === "late_approved" ? "Didit approved after the cutoff. This rental remains pending unless an admin allows this rental specifically." : result.status === "late" ? "Didit has no approval recorded before the verification deadline. This rental remains pending." : result.status === "updated" || result.status === "unchanged" ? "Didit checked · the latest available stages are shown." : "Didit could not be checked for this rental.");
    } catch { setCheckMessage("Could not check Didit. The last confirmed stages are shown; try again."); }
    finally { setChecking(false); }
  }
  async function allowLate() {
    if (allowingLate) return;
    if (lateOverrideReason.trim().length < 5) {
      setLateMessage("Add a short reason first.");
      return;
    }
    setAllowingLate(true);
    setLateMessage("");
    try {
      const result = await allowLateVerification({ token, bookingId: bookingId as any, reason: lateOverrideReason.trim() });
      setLateMessage(result.alreadyAllowed ? "Already allowed for this rental · syncing Didit now." : "Allowed for this rental only · syncing Didit now.");
    } catch (error) {
      setLateMessage(error instanceof Error ? error.message : "Could not reopen verification. Refresh and try again.");
    } finally {
      setAllowingLate(false);
    }
  }

  if (!booking || !verificationBookingOpen(booking.status)) return null;

  const lateApprovalBlocked = admin
    ? owner?.verificationLateBlockedProviderStatus === "Approved" && !!owner?.verificationLateBlockedAt
    : !!renter?.lateVerificationApprovalBlocked;
  const needsDiditReview = admin && owner?.verificationProvider === "didit" && owner.idVerifyStatus === "manual_review" && !lateApprovalBlocked;
  const paidCheckoutRecorded = typeof owner?.checkoutPaidAt === "number" && Number.isSafeInteger(owner.checkoutPaidAt) && owner.checkoutPaidAt > 0;
  const lateOverrideAvailable = admin && !!owner?.verificationWindowClosed && paidCheckoutRecorded && owner?.status === "pending_verification" && owner.verificationProvider === "didit" && !!owner.diditSessionId && !owner.verificationLateOverrideAt && !owner.cancellationDecision && !owner.returnDecision;
  const lateOverrideActive = admin && owner?.status === "pending_verification" && owner.verificationProvider === "didit" && typeof owner.verificationLateOverrideAt === "number" && Number.isSafeInteger(owner.verificationLateOverrideAt) && owner.verificationLateOverrideAt > 0;
  const decisionBlockedMessage = lateOverrideAvailable
    ? "Window closed · use the one-rental override above to decide."
    : "Window closed · decisions are unavailable for this rental.";

  return (
    <section aria-label="Rental verification progress" className="mt-4 rounded-[26px] border border-white/20 bg-[radial-gradient(ellipse_at_100%_100%,rgba(169,111,49,.2),transparent_42%),linear-gradient(145deg,#292a2c,#17181b_48%,#1c1b1b)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_18px_48px_rgba(0,0,0,.22)] sm:p-6">
      {!admin && <div className="mb-3 text-center"><ChatAperture /><h3 className="mt-1 text-xl font-semibold tracking-tight text-white">Your verification</h3></div>}
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.14em] text-accent-200">{rentalStageLabel(booking)}</p>
      {lateOverrideActive && <div data-testid="late-verification-override-active" role="status" className="mb-3 rounded-2xl border border-emerald-200/20 bg-emerald-200/[.06] px-3 py-2.5 text-xs text-emerald-50/90">
        <p className="font-semibold">{owner?.verificationLateOverrideSource === "didit_manual_approval" ? "Manual Didit approval recorded for this rental" : "Verification reopened for this rental"}</p>
        <p className="mt-1 text-white/65">{owner?.verificationLateOverrideSource === "didit_manual_approval" ? "The reviewer’s approval is recorded as this rental’s late override. Payment, live stock, and other booking checks must still pass before confirmation." : "Didit must still pass. This does not approve the booking or change payment, stock, or other rentals."}</p>
        {admin && owner?.verificationLateOverrideReason && <p className="mt-1 text-white/65">Reason: {owner.verificationLateOverrideReason}</p>}
        {lateMessage && <p className="mt-2 text-white/70">{lateMessage}</p>}
      </div>}
      {admin && owner?.idVerifyStatus === "verified" && typeof owner?.diditManualApprovalAt === "number" && owner?.verificationLateOverrideSource !== "didit_manual_approval" && <p data-testid="didit-manual-approval-recorded" role="status" className="mb-3 rounded-xl border border-emerald-200/20 bg-emerald-200/[.06] px-3 py-2.5 text-xs text-emerald-50/90">Didit’s manual approval is recorded on this rental. The site will confirm it only after payment, live stock, and the remaining booking checks pass.</p>}
      {booking.verificationWindowClosed && <div role="status" className="mt-3 rounded-2xl border border-amber-200/20 bg-amber-200/[.06] px-3 py-2.5 text-xs text-amber-50/90">
        <p className="font-semibold">{lateApprovalBlocked ? "Didit approved after the cutoff" : "Verification window passed"}</p>
        <p className="mt-1 text-white/65">{lateApprovalBlocked ? "This rental remains unconfirmed. An admin can allow this rental only, then the site will sync Didit automatically." : "New checks are closed. We’ll still sync an on-time result from this rental’s existing Didit session."}</p>
        {lateOverrideAvailable && <div className="mt-2 grid gap-2">
          <label className="text-[10px] font-medium text-amber-50/75" htmlFor={`late-verification-reason-${bookingId}`}>Why allow this late check?</label>
          <textarea id={`late-verification-reason-${bookingId}`} data-testid="late-verification-reason" value={lateOverrideReason} maxLength={400} rows={2} disabled={allowingLate} onChange={event => setLateOverrideReason(event.target.value)} placeholder="Short internal reason · required" className="min-h-14 w-full resize-y rounded-xl border border-amber-100/15 bg-black/20 px-3 py-2 text-[11px] leading-4 text-white outline-none placeholder:text-white/35 focus:border-amber-100/35 disabled:opacity-50" />
          <button type="button" data-testid="allow-late-verification" disabled={allowingLate || lateOverrideReason.trim().length < 5} onClick={() => void allowLate()} className="justify-self-start rounded-full border border-amber-100/30 px-3 py-1.5 font-medium text-amber-50 hover:bg-amber-100/10 disabled:opacity-50">{allowingLate ? "Reopening…" : "Allow verification for this rental"}</button>
        </div>}
      </div>}
      {lateMessage && !lateOverrideActive && <p role="status" className="mt-2 text-xs text-white/70">{lateMessage}</p>}
      <VerificationBar booking={booking} compact={admin} />
      <VerificationChecks checks={booking.verificationChecks} verificationStatus={booking.idVerifyStatus} />
      {!admin && lateApprovalBlocked && <p role="status" className="mt-3 rounded-xl border border-amber-200/20 bg-amber-200/[.06] px-3 py-2.5 text-xs leading-relaxed text-amber-50/90">Didit approved your documents after this rental’s verification cutoff. This rental was not confirmed; the team can check whether it can still proceed. This does not affect future rentals.</p>}
      {needsDiditReview && <DiditReviewCard key={`${bookingId}:${owner.diditSessionId ?? "missing"}`} bookingId={bookingId} token={token} reason={owner.verificationNote} sessionId={owner.diditSessionId} decisionBlocked={!!booking.verificationWindowClosed} decisionBlockedMessage={decisionBlockedMessage} />}
      {booking.verificationUpdatedAt && <p className="mt-2 text-[10px] text-white/40">Result last changed {new Date(booking.verificationUpdatedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} · London</p>}
      {admin && !needsDiditReview && owner?.verificationProvider === "didit" && owner.diditSessionId && (owner.idVerifyStatus !== "verified" || confirmationRecoveryPending) && <div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" disabled={checking} onClick={() => void checkNow()} className="rounded-full border border-white/20 px-3 py-2 text-xs text-white hover:bg-white/10 disabled:opacity-50">{checking ? "Checking…" : confirmationRecoveryPending ? "Retry booking confirmation" : "Sync Didit status"}</button><span className="text-[10px] text-white/50">{confirmationRecoveryPending ? "Didit passed · retries payment confirmation and live stock." : owner.verificationWindowClosed ? "Checks this session only; it cannot reopen verification." : "Automatically syncs while the case is open."}</span></div>}
      {checkMessage && <p role="status" className="mt-2 text-xs text-white/70">{checkMessage}</p>}
      {refreshError && <p role="status" className="mt-2 text-xs text-amber-200">Refresh retrying · last confirmed result shown.</p>}
      {!admin && !booking.verificationWindowClosed && <Link href={`/account/verification/${bookingId}`} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#ffda90] to-[#c99452] px-4 py-2 text-center text-sm font-semibold text-[#17120d] shadow-[inset_0_1px_rgba(255,255,255,.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100">Open verification and uploads <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0"><path d="M4 12 12 4M5 4h7v7" /></svg></Link>}
    </section>
  );
}
