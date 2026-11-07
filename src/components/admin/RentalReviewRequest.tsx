"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

const labels: Record<string, string> = {
  sent: "A review request is already in this rental conversation.",
  reviewed: "This rental already has a review.",
  not_settled: "The rental and security settlement must be complete before requesting a review.",
  check_required: "The latest security settlement must be checked before requesting a review.",
  no_account: "A linked customer account is needed for the review form.",
  not_found: "This rental could not be found.",
};

export function RentalReviewRequest({ token, bookingId }: { token: string; bookingId: string }) {
  return <RentalReviewRequestForm key={JSON.stringify([token, bookingId])} token={token} bookingId={bookingId} />;
}

function RentalReviewRequestForm({ token, bookingId }: { token: string; bookingId: string }) {
  const status = useQuery(api.reviewInvitations.adminStatus, { token, bookingId: bookingId as any });
  const send = useMutation(api.reviewInvitations.sendByAdmin);
  const scope = JSON.stringify([token, bookingId]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [message, setMessage] = useState<{ scope: string; text: string } | null>(null);
  const pending = useRef(new Set<string>());
  useEffect(() => {
    if (status && status.state !== "ready" && status.state !== "resend_ready") {
      setFinished(false);
      setMessage(null);
    }
  }, [status?.state]);
  const waitingForUpdate = finished && (status?.state === "ready" || status?.state === "resend_ready");
  async function submit() {
    if (confirm !== scope || pending.current.has(scope) || (status?.state !== "ready" && status?.state !== "resend_ready")) return;
    pending.current.add(scope);
    setBusy(scope);
    setMessage(null);
    try {
      const result = await send({ token, bookingId: bookingId as any });
      setConfirm(current => current === scope ? null : current);
      setFinished(true);
      setMessage({ scope, text: result.state === "reviewed" ? "This rental already has a review." : "A review request is in this rental conversation." });
    } catch {
      setMessage({ scope, text: "The request could not be sent. Check the rental settlement and try again." });
    } finally {
      pending.current.delete(scope);
      setBusy(current => current === scope ? null : current);
    }
  }
  return <details className="group mt-3 overflow-hidden rounded-2xl border border-[#d0a16c]/25 bg-[#1b1a19]/90 text-sm shadow-[0_12px_36px_#0003] backdrop-blur-xl" data-testid="admin-review-request">
    <summary className="flex min-h-16 cursor-pointer items-center gap-3 bg-gradient-to-r from-[#c8986512] to-transparent px-4 py-3 [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#d5a474]/25 bg-[#d5a474]/10 text-[#e8bb84]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5"><path d="M2.5 12s3.5-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/></svg></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-[.15em] text-[#d8a66f]">Renter feedback</span><span className="mt-1 block font-semibold text-[#f5eadc]">Request a review</span></span><span aria-hidden="true" className="text-lg text-[#d8a66f] transition-transform group-open:rotate-45">＋</span></summary>
    <div className="space-y-3 border-t border-white/10 p-4">
    {!waitingForUpdate && confirm !== scope && <p className="text-xs leading-5 text-[#c8baaa]">{status === undefined ? "Checking rental eligibility…" : status === null ? "Admin access required." : status.state === "ready" ? "Send an interactive star-rating and review form in this rental conversation." : status.state === "resend_ready" ? "A previous request was sent more than 24 hours ago. Send the interactive form again?" : labels[status.state] ?? "This request is unavailable."}</p>}
    {!finished && (status?.state === "ready" || status?.state === "resend_ready") && (confirm === scope ? <div role="group" aria-label="Review request confirmation" className="rounded-xl border border-[#d5a474]/25 bg-gradient-to-br from-[#c8986510] to-black/10 p-3"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#d8a66f]">Confirm before sending</p><p className="mt-2 text-xs leading-5 text-[#eadbcb]">{status.state === "resend_ready" ? "The renter will receive the review form again in this rental chat." : "The renter will receive the review form in this rental chat."}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy === scope} onClick={() => void submit()} className="min-h-11 rounded-lg bg-[#c89b6d] px-4 text-xs font-semibold text-[#21170e] disabled:opacity-50">{busy === scope ? "Sending…" : "Confirm and send"}</button><button type="button" disabled={busy === scope} onClick={() => setConfirm(null)} className="min-h-11 rounded-lg border border-white/20 px-4 text-xs text-white/75 disabled:opacity-50">Cancel</button></div></div> : <button type="button" onClick={() => setConfirm(scope)} className="min-h-11 rounded-lg border border-[#d5a474]/35 bg-[#d5a474]/10 px-4 text-xs font-semibold text-[#edc89f]">{status.state === "resend_ready" ? "Resend review request" : "Send review request"}</button>)}
    {message?.scope === scope && (waitingForUpdate || !finished) && <p role="status" className="text-xs leading-5 text-[#ead3b5]">{message.text}</p>}
    </div>
  </details>;
}
