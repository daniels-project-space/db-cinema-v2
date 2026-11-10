"use client";

import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@cvx/_generated/api";
import { VerificationBar } from "./VerificationProgress";
import { useVerificationRefresh } from "./useVerificationRefresh";
import { rentalStageLabel } from "../../../shared/rentalReadiness";
import { verificationBookingOpen } from "../../../shared/verificationProgress";

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
    <div aria-label="Document checks" className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))] gap-2">
      {checkItems.map(({ key, label }) => {
        const state = checks?.[key] ?? (verificationStatus === "required" ? "waiting" : "unknown");
        const stateStyle = state === "approved"
          ? "border-emerald-200/15 bg-emerald-200/[.06] text-emerald-100"
          : state === "rejected"
            ? "border-rose-200/15 bg-rose-200/[.06] text-rose-100"
            : state === "review" || state === "requires_input"
              ? "border-amber-200/15 bg-amber-200/[.06] text-amber-100"
              : "border-white/[.08] bg-white/[.025] text-white/70";

        return (
          <div key={key} className={`grid min-w-0 gap-0.5 rounded-2xl border px-3 py-2.5 ${stateStyle}`}>
            <span className="text-xs font-medium leading-4">{label}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide">{checkLabels[state] ?? "Checking"}</span>
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
}: {
  bookingId: string;
  token: string;
  reason?: string;
  sessionId?: string;
}) {
  const refresh = useAction(api.didit.refreshProgress);
  const openLink = useAction(api.didit.adminVerificationLink);
  const review = useAction(api.didit.adminReview);
  const [checking, setChecking] = useState(false);
  const [decision, setDecision] = useState<"approve" | "resubmit" | "decline" | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [refreshMessage, setRefreshMessage] = useState("");
  const [caseIdCopied, setCaseIdCopied] = useState(false);
  const [openingLink, setOpeningLink] = useState(false);
  const [diditIssues, setDiditIssues] = useState<Array<{feature:string;risk:string;summary:string;detail:string}>>([]);

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
      setRefreshMessage(result.status === "updated"
        ? "Didit decision refreshed."
        : result.status === "unchanged"
          ? "No change yet · try again shortly."
          : "Session unavailable · check rental.");
    } catch {
      setRefreshMessage("Refresh uncertain · check Didit and the rental.");
    } finally {
      setChecking(false);
    }
  }

  async function submitDecision(next: "approve" | "resubmit" | "decline") {
    if (reviewReason.trim().length < 5) {
      setRefreshMessage("Add a short decision reason first.");
      return;
    }
    setDecision(next);
    setRefreshMessage("");
    try {
      await review({
        bookingId: bookingId as any,
        token,
        decision: next,
        note: reviewReason.trim(),
        requestId: globalThis.crypto?.randomUUID?.() ?? `review-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      setReviewReason("");
      setRefreshMessage(next === "approve" ? "Approved · rental updated." : next === "resubmit" ? "Resubmission sent to the renter." : "Declined · rental updated.");
    } catch (error) {
      setRefreshMessage(error instanceof Error ? error.message : "Decision not confirmed · refresh the case.");
    } finally {
      setDecision(null);
    }
  }

  return (
    <section aria-label="Didit review" className="mt-3 overflow-hidden rounded-2xl border border-[#d4a86b]/25 bg-gradient-to-br from-[#3a2b1c]/40 via-[#211d18]/75 to-[#171819]/90 text-xs leading-5 shadow-[0_14px_36px_rgba(0,0,0,.24)] backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-white/[.07] px-3 py-2.5">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#e4b77d]/20 bg-[#e4b77d]/[.08] text-[#e8bb84]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
            <path d="M12 3 4.5 6v5.5c0 4.4 2.8 7.7 7.5 9.5 4.7-1.8 7.5-5.1 7.5-9.5V6L12 3Z" />
            <path d="M12 8v4m0 3h.01" />
          </svg>
        </span>
        <p className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[.14em] text-[#ddb178]">Didit review</p>
        <span className="shrink-0 rounded-full border border-amber-100/15 bg-amber-100/[.07] px-2.5 py-1 text-[10px] font-semibold text-[#f2d1a8]">Action needed</span>
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
          <div className="flex items-center justify-between gap-2"><p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#bda991]">Case ID</p><button type="button" aria-label="Copy Didit case ID" disabled={!sessionId} onClick={() => void copyCaseId()} className="min-h-8 shrink-0 rounded-lg border border-white/10 px-2 text-[10px] font-medium text-[#edc89f] disabled:opacity-40">{caseIdCopied ? "Copied" : "Copy ID"}</button></div>
          <code className="mt-1 block break-all font-mono text-[10px] text-[#f0e2d1]">{sessionId || "Unavailable"}</code>
        </div>
        <p className="text-[10px] text-[#c6b5a1]">Search this ID in Didit.</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-label="Open Didit verification" disabled={!sessionId || openingLink || checking || decision !== null} onClick={() => void openDiditVerification()} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#d5a474]/30 bg-white/[.025] px-3 font-semibold text-[#edc89f] transition hover:bg-white/[.06] disabled:opacity-50">{openingLink ? "Opening…" : "Open verification ↗"}</button>
          <button type="button" aria-label="Refresh Didit decision" disabled={checking || decision !== null} className="min-h-10 rounded-xl bg-gradient-to-br from-[#e4bb8e] to-[#c89b6d] px-3 font-semibold text-[#21170e] shadow-[0_8px_18px_rgba(200,155,109,.14)] transition hover:brightness-105 disabled:opacity-50" onClick={() => void refreshDecision()}>{checking ? "Refreshing…" : "Refresh status"}</button>
        </div>
        <label className="block text-[10px] font-medium text-[#e4c49b]" htmlFor={`didit-review-reason-${bookingId}`}>Decision reason</label>
        <textarea
          id={`didit-review-reason-${bookingId}`}
          value={reviewReason}
          maxLength={400}
          rows={2}
          disabled={decision !== null || checking}
          onChange={event => setReviewReason(event.target.value)}
          placeholder="Short reason for this decision"
          className="min-h-[56px] w-full resize-y rounded-xl border border-white/[.1] bg-black/20 px-3 py-2 text-[11px] leading-4 text-white outline-none placeholder:text-white/35 focus:border-[#e4b77d]/45 disabled:opacity-50"
        />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-label="Approve Didit review" disabled={decision !== null || checking} onClick={() => void submitDecision("approve")} className="min-h-10 rounded-xl border border-emerald-200/20 bg-emerald-200/[.08] px-2 text-[10px] font-semibold text-emerald-100 transition hover:bg-emerald-200/[.14] disabled:opacity-50">{decision === "approve" ? "Saving…" : "Approve"}</button>
          <button type="button" aria-label="Request Didit resubmission" disabled={decision !== null || checking} onClick={() => void submitDecision("resubmit")} className="min-h-10 rounded-xl border border-[#e4b77d]/20 bg-[#e4b77d]/[.08] px-2 text-[10px] font-semibold text-[#f0d3ad] transition hover:bg-[#e4b77d]/[.14] disabled:opacity-50">{decision === "resubmit" ? "Sending…" : "Request resubmission"}</button>
          <button type="button" aria-label="Decline Didit review" disabled={decision !== null || checking} onClick={() => void submitDecision("decline")} className="col-span-2 min-h-10 rounded-xl border border-rose-200/20 bg-rose-200/[.06] px-2 text-[10px] font-semibold text-rose-100 transition hover:bg-rose-200/[.12] disabled:opacity-50">{decision === "decline" ? "Saving…" : "Decline"}</button>
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
  const refreshError = useVerificationRefresh(bookingId, token, undefined, admin, !!booking && verificationBookingOpen(booking.status) && booking.idVerifyStatus !== "verified");

  if (!booking || !verificationBookingOpen(booking.status)) return null;

  const needsDiditReview = admin && owner?.verificationProvider === "didit" && owner.idVerifyStatus === "manual_review";

  return (
    <section aria-label="Rental verification progress" className="mt-4 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[.07] via-[#171819]/95 to-amber-950/10 p-4 shadow-[0_18px_48px_rgba(0,0,0,.22)] backdrop-blur-2xl">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.14em] text-accent-200">{rentalStageLabel(booking)}</p>
      <VerificationBar booking={booking} compact={admin} />
      <VerificationChecks checks={booking.verificationChecks} verificationStatus={booking.idVerifyStatus} />
      {needsDiditReview && <DiditReviewCard bookingId={bookingId} token={token} reason={owner.verificationNote} sessionId={owner.diditSessionId} />}
      {booking.verificationUpdatedAt && <p className="mt-2 text-[10px] text-white/40">Updated {new Date(booking.verificationUpdatedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} · London</p>}
      {refreshError && <p role="status" className="mt-2 text-xs text-amber-200">Refresh retrying · last confirmed result shown.</p>}
      {!admin && <Link href={`/account/verification/${bookingId}`} className="mt-3 inline-block text-xs text-accent-300 hover:underline">Open verification and uploads ↗</Link>}
    </section>
  );
}
