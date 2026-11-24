"use client";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalKit } from "@/components/rentals/RentalKit";
import { RentalOrderTools } from "./RentalOrderTools";
import {
  rentalTitle,
  rentalDate,
  RENTAL_STAGE_LABELS,
} from "@/lib/rentalPresentation";
import { formatGbp } from "@/lib/pricing";
import { AdminDroneLicence } from "@/components/rentals/DroneLicence";
import { RentalVerificationSummary } from "@/components/rentals/RentalVerificationSummary";
import { rentalStageLabel } from "../../../shared/rentalReadiness";
import { AccountDocuments } from "./AccountDocuments";
import { rentalWorkspaceTabs } from "../../../shared/diditReviewTab";
export function RentalWorkspace({
  token,
  bookingId,
  onClose,
  onChat,
  initialAction,
}: {
  token: string;
  bookingId: string;
  onClose: () => void;
  onChat: () => void;
  initialAction?:"change"|"dates"|"discount"|"refund";
}) {
  const b = useQuery(api.rentalOperations.details, {
    token,
    bookingId: bookingId as any,
  });
  const setStatus = useMutation(api.bookings.adminSetStatus),
    setIdentity = useMutation(api.bookings.adminSetIdStatus),
    reverify = useMutation(api.bookings.adminRequireReverification),
    suspendReuse = useMutation(api.bookings.adminSuspendVerificationReuse);
  const [section, setSection] = useState("order"),
    [note, setNote] = useState(""),
    [reuseReason, setReuseReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const tabs = rentalWorkspaceTabs(b);
  const showDiditReviewTab = tabs.length > 1;
  useEffect(() => {
    if (showDiditReviewTab) setSection("verification");
    else setSection((current) => current === "verification" ? "order" : current);
  }, [bookingId, showDiditReviewTab]);
  async function execute(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
      setNote("");
    } catch (e: any) {
      setError(e.message ?? "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  if (b === undefined)
    return (
      <div
        role="status"
        className="mt-6 rounded-3xl border border-white/10 p-8 text-white/50"
      >
        Loading rental…
      </div>
    );
  if (!b) return <p className="mt-6 text-white/50">Rental unavailable.</p>;
  const start = Math.min(...b.lineItems.map((x) => x.start)),
    end = Math.max(...b.lineItems.map((x) => x.end));
  const verificationTools = (
    <div className="mt-6">
      {b.documentAccountId ? <div className="mb-8"><h3 className="mb-4 text-sm font-semibold text-white">Saved verification documents</h3><AccountDocuments token={token} accountId={b.documentAccountId} verified={b.idVerifyStatus === "verified"} verificationExpiresAt={b.verificationExpiresAt ?? null} embedded /></div> : <p className="mb-4 text-sm text-amber-200">No customer account is linked to these documents. Check the account before importing.</p>}
      <AdminDroneLicence token={token} bookingId={bookingId} />
      <h3 className="text-sm font-medium text-white">Identity & address · {b.idVerifyStatus ?? "required"}</h3>
      <p className="mt-2 text-sm text-white/50">{b.verificationNote ?? "The renter completes the verification steps in their account."}</p>
      {b.diditSessionId && <a href="https://business.didit.me" target="_blank" rel="noreferrer" aria-label="Open Didit Business Console" className="mt-4 inline-flex max-w-full flex-col gap-1 rounded-xl border border-white/10 bg-white/[.025] px-3 py-2 text-xs text-accent-300 transition hover:border-white/20 hover:bg-white/[.045]"><span>Open Didit console ↗</span><span className="text-[11px] text-white/45">Identity verification → User verifications · search this ID</span><span className="break-all font-mono text-white/70">Session ID · {b.diditSessionId}</span></a>}
      {b.diditSessionId && <details className="mt-4 rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-xs font-medium text-white/70">Verification controls</summary><label className="mt-3 block text-xs text-white/50">Reason to stop using this verification<textarea value={reuseReason} onChange={event=>setReuseReason(event.target.value)} rows={2} className="input mt-2 w-full" /></label><button disabled={busy || reuseReason.trim().length<10} onClick={()=>void execute(()=>suspendReuse({token,bookingId:b._id,reason:reuseReason}))} className="mt-3 rounded-full border border-amber-300/20 px-4 py-2 text-xs text-amber-200 disabled:opacity-30">Suspend verification reuse</button><p className="mt-2 text-xs text-white/40">Stops reuse for future rentals; it does not delete saved documents.</p></details>}
      {b.status === "confirmed" && b.idVerifyStatus === "verified" && <div className="mt-4 rounded-xl border border-white/10 p-3"><p className="text-xs text-white/45">{b.verificationExpiresAt ? `Valid until ${new Date(b.verificationExpiresAt).toLocaleDateString("en-GB")}` : "Booking-specific approval"}{b.verificationReusedFrom ? " · reused automatic check" : ""}</p><label className="mt-3 block text-xs text-white/50">Reason for a new check<textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} className="input mt-2 w-full" /></label><button disabled={busy || note.trim().length < 10} onClick={()=>void execute(()=>reverify({token,bookingId:b._id,note}))} className="mt-3 rounded-full border border-amber-300/20 px-4 py-2 text-xs text-amber-200 disabled:opacity-30">Require fresh verification</button></div>}
      {b.idVerifyStatus !== "verified" && b.verificationProvider !== "didit" && <><label className="mt-5 block text-xs text-white/50">Evidence and decision reason<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input mt-2 w-full" /></label><button disabled={busy || note.trim().length < 10} onClick={() => void execute(() => setIdentity({token, bookingId:b._id, status:"verified", note}))} className="mt-3 rounded-full border border-white/10 px-4 py-2 text-xs text-white/70 disabled:opacity-30">Approve with evidence</button></>}
    </div>
  );
  return (
    <section
      className="mt-6 rounded-3xl border border-white/[0.08] bg-[#141414] p-5 sm:p-7"
      aria-label="Rental workspace"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-accent-300">
            {rentalStageLabel(b)}
          </p>
          <h2 className="mt-2 font-display text-xl font-semibold text-white">
            {rentalTitle(b.lineItems[0]?.title ?? "Rental")}
          </h2>
          <p className="mt-2 break-all text-sm text-white/50">{b.guestEmail}</p>
          <p className="mt-1 text-xs text-white/40">
            {rentalDate(start, end)} · {formatGbp(b.total)}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={onChat}
            className="rounded-full bg-white px-4 py-2 text-xs font-medium text-black"
          >
            Conversation →
          </button>
          <button
            onClick={onClose}
            aria-label="Close rental workspace"
            className="text-white/45"
          >
            ✕
          </button>
        </div>
      </header>
      {!showDiditReviewTab && <RentalVerificationSummary key={bookingId} bookingId={bookingId} token={token} admin/>}
      {b.identityRiskNotice && <p role="alert" className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">Didit approved this identity. Team notice: {b.identityRiskNotice}</p>}
      <nav aria-label="Rental workspace sections" className="mt-6 flex gap-2 overflow-x-auto border-b border-white/[0.06] pb-4">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            aria-current={key === section ? "page" : undefined}
            aria-label={showDiditReviewTab && key === "verification" ? "Verification review needed" : label}
            onClick={() => {
              setSection(key);
              setError(null);
            }}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-xs ${key === section ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}`}
          >
            <span className="inline-flex items-center gap-2">
              {showDiditReviewTab && key === "verification" && <span aria-hidden="true" className="relative inline-flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300" /></span>}
              {label}
            </span>
          </button>
        ))}
      </nav>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200"
        >
          {error}
        </p>
      )}
      {section === "order" && (
        <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div>
            <RentalKit items={b.lineItems} prices allPhotos />
            <dl className="mt-5 grid grid-cols-2 gap-4 rounded-2xl bg-white/[0.025] p-4 text-xs">
              <div>
                <dt className="text-white/35">Refundable security</dt>
                <dd className="mt-1 text-white/75">
                  {formatGbp(b.depositAmount)}
                  {b.depositRefunded
                    ? ` · refunded ${formatGbp(b.depositRefundAmount ?? 0)}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt className="text-white/35">Card hold</dt>
                <dd className="mt-1 text-white/75">
                  {formatGbp(b.depositHoldAmount ?? 0)} ·{" "}
                  {b.depositHoldStatus ?? "Unavailable"}
                </dd>
              </div>
              <div>
                <dt className="text-white/35">Fulfilment</dt>
                <dd className="mt-1 text-white/75">{b.fulfilment}</dd>
              </div>
              <div>
                <dt className="text-white/35">Agreement</dt>
                <dd className="mt-1 text-white/75">
                  {b.agreementName ? "Signed" : "Awaiting signature"}
                </dd>
              </div>
            </dl>
            {b.status === "confirmed" && (
              <button
                disabled={
                  busy || !!b.activeAdditionId || !!b.cancellationDecision || rentalStageLabel(b) !== "Verification approved"
                }
                onClick={() =>
                  void execute(() =>
                    setStatus({ token, bookingId: b._id, status: "active" }),
                  )
                }
                className="mt-5 rounded-full border border-emerald-400/20 px-4 py-2 text-xs text-emerald-200 disabled:opacity-40"
              >
                Record handover
              </button>
            )}
          </div>
          <div>
            <RentalOrderTools token={token} bookingId={bookingId} showReturn={false} showPriceTools initialMode={initialAction==="change"?"add":initialAction==="dates"?"reschedule":initialAction?"refund":undefined} />
          </div>
          {!showDiditReviewTab && <div className="lg:col-span-2">
            <details className="rounded-2xl border border-white/[.08] bg-white/[.02] px-4 py-3">
              <summary className="cursor-pointer text-xs font-medium text-white/70">Verification files & controls</summary>
              {verificationTools}
            </details>
          </div>}
        </div>
      )}
      {section === "verification" && showDiditReviewTab && <div className="mt-6"><RentalVerificationSummary key={bookingId} bookingId={bookingId} token={token} admin/>{verificationTools}</div>}
    </section>
  );
}
