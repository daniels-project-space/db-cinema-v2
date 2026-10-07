"use client";
import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
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
export function RentalWorkspace({
  token,
  bookingId,
  onClose,
  onChat,
}: {
  token: string;
  bookingId: string;
  onClose: () => void;
  onChat: () => void;
}) {
  const b = useQuery(api.rentalOperations.details, {
    token,
    bookingId: bookingId as any,
  });
  const setStatus = useMutation(api.bookings.adminSetStatus),
    setIdentity = useMutation(api.bookings.adminSetIdStatus),
    review = useAction(api.didit.adminReview),
    reverify = useMutation(api.bookings.adminRequireReverification);
  const [section, setSection] = useState("order"),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
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
  return (
    <section
      className="mt-6 rounded-3xl border border-white/[0.08] bg-[#141414] p-5 sm:p-7"
      aria-label="Rental workspace"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-accent-300">
            {RENTAL_STAGE_LABELS[b.status]}
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
      <nav className="mt-6 flex gap-2 overflow-x-auto border-b border-white/[0.06] pb-4">
        {[
          ["order", "Order & payments"],
          ["verification", "Verification"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setSection(key);
              setError(null);
            }}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-xs ${key === section ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}`}
          >
            {label}
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
            <RentalKit items={b.lineItems} prices />
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
                  busy || !!b.activeAdditionId || !!b.cancellationDecision
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
            <RentalOrderTools token={token} bookingId={bookingId} showReturn={false} />
          </div>
        </div>
      )}
      {section === "verification" && (
        <div className="mt-6 max-w-xl">
          <AdminDroneLicence token={token} bookingId={bookingId} />
          <h3 className="text-sm font-medium text-white">
            Identity & address · {b.idVerifyStatus ?? "required"}
          </h3>
          <p className="mt-2 text-sm text-white/50">
            {b.verificationNote ??
              "The renter completes the verification steps in their account."}
          </p>
          {b.diditSessionId && (
            <a
              href="https://business.didit.me"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block text-xs text-accent-300"
            >
              Review case in Didit ↗
              <span className="mt-1 block break-all font-mono text-white/35">
                {b.diditSessionId}
              </span>
            </a>
          )}
          {b.status === "confirmed" && b.idVerifyStatus === "verified" && <div className="mt-4">
            <p className="text-xs text-white/45">{b.verificationExpiresAt ? `Valid until ${new Date(b.verificationExpiresAt).toLocaleDateString("en-GB")}` : "Booking-specific approval"}{b.verificationReusedFrom ? " · reused automatic check" : ""}</p>
            <label className="mt-3 block text-xs text-white/50">Reason for a new check<textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} className="input mt-2 w-full" /></label>
            <button disabled={busy || note.trim().length < 10} onClick={()=>void execute(()=>reverify({token,bookingId:b._id,note}))} className="mt-3 rounded-full border border-amber-300/20 px-4 py-2 text-xs text-amber-200 disabled:opacity-30">Require fresh verification</button>
          </div>}
          {b.idVerifyStatus !== "verified" && (
            <>
              <label className="mt-5 block text-xs text-white/50">
                Evidence and decision reason
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="input mt-2 w-full"
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                {b.verificationProvider === "didit" ? (
                  (["manual_review", "rejected"].includes(
                    b.idVerifyStatus ?? "",
                  )
                    ? (["approve", "resubmit", "decline"] as const)
                    : []
                  ).map((decision) => (
                    <button
                      key={decision}
                      disabled={busy || note.trim().length < 10}
                      onClick={() =>
                        void execute(() =>
                          review({ token, bookingId: b._id, decision, note }),
                        )
                      }
                      className="rounded-full border border-white/10 px-4 py-2 text-xs capitalize text-white/70 disabled:opacity-30"
                    >
                      {decision === "resubmit"
                        ? "Request resubmission"
                        : decision}
                    </button>
                  ))
                ) : (
                  <button
                    disabled={busy || note.trim().length < 10}
                    onClick={() =>
                      void execute(() =>
                        setIdentity({
                          token,
                          bookingId: b._id,
                          status: "verified",
                          note,
                        }),
                      )
                    }
                    className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/70 disabled:opacity-30"
                  >
                    Approve with evidence
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
