"use client";
import chatStyles from "@/components/rentals/RentalConversation.module.css";
import { useRef, useState, useEffect } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { ReturnRentalForm } from "./ReturnRentalForm";
import { ReturnInspectionHistory } from "./ReturnInspectionHistory";
import { RentalManagerDelivery } from "./RentalManagerDelivery";
import { SmartImage } from "@/components/SmartImage";
import { rentalTitle } from "@/lib/rentalPresentation";
import { formatGbp } from "@/lib/pricing";
import { rentalHandoverLabel } from "../../../shared/rentalHandover";
import { rentalDate } from "@/lib/rentalPresentation";
import { RentalRequestHistory } from "@/components/rentals/RentalRequestHistory";

export function RentalOrderTools({
  token,
  bookingId,
  showReturn = true,
  initialMode,
}: {
  token: string;
  bookingId: string;
  /** Return settlement belongs in the rental conversation, where the customer record is visible. */
  showReturn?: boolean;
  initialMode?:"reschedule"|"refund"|"add";
}) {
  const b = useQuery(api.rentalOperations.details, {
    token,
    bookingId: bookingId as any,
  });
  const cancellation = useQuery(api.cancellationRecovery.ownerStatus, { token, bookingId: bookingId as any });
  const additions =
    useQuery(api.rentalAdditionState.list, {
      token,
      bookingId: bookingId as any,
    }) ?? [];
  const [lookup, setLookup] = useState(""),
    [listingId, setListingId] = useState(""),
    [quantity, setQuantity] = useState(1),
    [complimentary, setComplimentary] = useState(false);
  const add = useAction(api.rentalAdditions.start),
    withdraw = useAction(api.rentalAdditions.withdrawByOwner);
  const setStatus = useMutation(api.bookings.adminSetStatus);
  const [returnOpen, setReturnOpen] = useState(false);
  const reschedule = useMutation(api.rentalOperations.reschedule),
    remove = useMutation(api.rentalOperations.removeItem),
    cancel = useAction(api.checkout.cancelByAdmin),
    refund = useAction(api.checkout.refundRental);
  const [mode, setMode] = useState<
      "reschedule" | "cancel" | "refund" | "add" | "remove" | null
    >(initialMode??null),
    [date, setDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [reason, setReason] = useState(""),
    [amount, setAmount] = useState("");
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const [keepAgreedPrice, setKeepAgreedPrice] = useState(false);
  const removeSelection = useRef<{ lineIndex: number; listingId: any; expectedQty: number; expectedStart: number; expectedEnd: number } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const request = useRef<string | null>(null);
  useEffect(() => {
    if (b?.activeAdditionId && mode === "add" && !busy) setMode(null);
  }, [b?.activeAdditionId, mode, busy]);
  const catalog = useQuery(
    api.catalog.listListings,
    mode === "add" ? { search: lookup } : "skip",
  );
  if (!b) return null;
  const processing = b.rentalRefunds.find(
    (r) => r.status === "prepared" || r.status === "pending",
  );
  async function submit() {
    if (!b || busy) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      if (mode === "remove") {
        if (!removeSelection.current) throw Error("Choose an item to remove.");
        request.current ??= crypto.randomUUID();
        await remove({ token, bookingId: bookingId as any, requestId: request.current, ...removeSelection.current, reason });
        setResult("Item removed and inventory released. Agreed charges and security are unchanged. Use the refund control for any eligible rental refund.");
        request.current = null;
      }
      if (mode === "add") {
        request.current ??= crypto.randomUUID();
        const r = await add({
          token,
          bookingId: bookingId as any,
          requestId: request.current,
          listingId: listingId as any,
          qty: quantity,
          reason,
          complimentary,
        });
        setResult(
          r.applied
            ? "Complimentary item added to the rental."
            : "Secure payment link saved in this rental conversation. The order updates after payment and any bank hold approval.",
        );
        request.current = null;
      }
      if (mode === "reschedule") {
        await reschedule({
          token,
          bookingId: bookingId as any,
          start: Date.parse(`${date}T00:00:00Z`),
          end: endDate ? Date.parse(`${endDate}T00:00:00Z`) : undefined,
          keepAgreedPrice,
          reason,
        });
        setResult(
          "Rental dates updated. The customer will receive confirmation.",
        );
      }
      if (mode === "cancel") {
        const r = await cancel({ token, bookingId: bookingId as any, reason });
        setResult(
          `Cancelled. Card refund ${formatGbp(r.refundAmount)}${r.creditAmount ? ` · account credit ${formatGbp(r.creditAmount)}` : ""}.`,
        );
      }
      if (mode === "refund") {
        request.current ??= crypto.randomUUID();
        const r = await refund({
          token,
          bookingId: bookingId as any,
          requestId: request.current,
          amountPence: amount ? Math.round(Number(amount) * 100) : undefined,
          reason,
        });
        setResult(`${formatGbp(r.amount)} rental refund: ${r.status}.`);
        if (r.status !== "pending") request.current = null;
      }
      setMode(null);
      setReason("");
    } catch (e: any) {
      setError(e.data?.message ?? e.message ?? "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    if (!processing) return;
    setBusy(true);
    setError("");
    try {
      const r = await refund({
        token,
        bookingId: bookingId as any,
        requestId: processing.requestId,
        reason: processing.reason,
      });
      setResult(`${formatGbp(r.amount)} refund: ${r.status}.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function resumeAddition(r: any) {
    setBusy(true);
    setError("");
    try {
      const result = await add({
        token,
        bookingId: bookingId as any,
        requestId: r.requestId,
        listingId: r.listingId,
        qty: r.qty,
        reason: r.reason,
        start: r.start,
        end: r.end,
        complimentary: r.complimentary,
      });
      setResult(
        result.applied
          ? "Complimentary item added."
          : "Payment link is ready in this conversation.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function withdrawAddition(id: string) {
    setBusy(true);
    setError("");
    try {
      const result = await withdraw({ token, id: id as any });
      setResult(
        result.needsAttention ? "Withdrawal saved. The refund needs attention; the rental remains locked until it is resolved." : result.pending ? "Withdrawal saved. The refund is still processing; the rental remains locked until the bank confirms it." : "The item proposal is closed. Any captured proposal payment has been refunded.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-testid="owner-rental-tools">
      <RentalRequestHistory token={token} bookingId={bookingId} admin />
      <section className={chatStyles.bookingFacts} aria-label="Booked equipment and handover">
        <div className={chatStyles.factsIdentity}><SmartImage src={b.lineItems[0]?.heroImage} fallbackSources={b.lineItems[0]?.imageSources} alt={b.lineItems[0]?.title ?? "Rental kit"} className={chatStyles.factsPhoto} /><div><h5>{rentalTitle(b.lineItems[0]?.title ?? "Rental kit")}</h5><p>DBC-{bookingId.slice(-8).toUpperCase()} · {b.lineItems.length} listings</p></div></div>
        <dl><div><dt>Rental dates</dt><dd>{b.lineItems.length ? rentalDate(Math.min(...b.lineItems.map(l => l.start)), Math.max(...b.lineItems.map(l => l.end))) : "Dates need review"}</dd></div><div><dt>{b.fulfilment === "delivery" ? "Delivery" : "Collection"}</dt><dd>{rentalHandoverLabel(b,"pickup")}</dd></div><div><dt>Return</dt><dd>{rentalHandoverLabel(b,"return")}</dd></div><div><dt>Customer</dt><dd>{b.guestName || b.guestEmail}</dd></div><div><dt>Verification</dt><dd data-verified={b.idVerifyStatus === "verified"}>{b.idVerifyStatus === "verified" ? "✓ Verified" : (b.idVerifyStatus ?? "Required").replaceAll("_", " ")}</dd></div></dl>
      </section>
      <dl className={chatStyles.paymentSummary} aria-label="Booking financial summary">
        <div><dt>Booking total</dt><dd>{formatGbp(b.total)}</dd></div>
        <div><dt>Refundable deposit</dt><dd>{formatGbp(b.depositAmount ?? 0)}</dd></div>
        <div><dt>Card authorisation</dt><dd>{formatGbp(b.depositHoldAmount ?? 0)}</dd></div>
      </dl>
      <p className="mb-2 text-[10px] uppercase tracking-[.16em] text-white/35">Manage rental · owner only</p>
      {cancellation && cancellation.status !== "succeeded" && <div role="status" className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-100">
        <p>{cancellation.status === "attention" ? "Cancellation needs payment review. The existing refund was not completed." : "Cancellation settlement is processing. The rental remains reserved until refunds and security release are confirmed."}</p>
        {cancellation.refunds.map((r, i) => <p key={i} className="mt-2">{formatGbp(r.amount)} · {r.status.replaceAll("_", " ")}{r.approvalUrl && r.status === "awaiting_approval" && <a className="ml-2 underline" href={r.approvalUrl} target="_blank" rel="noopener noreferrer">Review in Stripe</a>}</p>)}
      </div>}
      <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Owner rental controls">
        {b.status === "confirmed" && <button disabled={busy || !!processing || !!(b.activeAdditionId || b.activeExtensionId) || !!b.cancellationDecision || !!b.returnDecision} onClick={async () => {
          setBusy(true); setError(""); setResult("");
          try { await setStatus({ token, bookingId: bookingId as any, status: "active" }); setResult("Pickup recorded. Rental is now out."); }
          catch (e: any) { setError(e.message ?? "Pickup could not be recorded."); }
          finally { setBusy(false); }
        }} className="rounded-full border border-accent-300/30 bg-accent-300/10 px-3 py-2 text-accent-200 disabled:opacity-35">Mark picked up</button>}
        {showReturn && (b.status === "active" || !!b.returnDecision && b.status !== "returned") && <button disabled={busy || !!processing || !!(b.activeAdditionId || b.activeExtensionId) || !!b.cancellationDecision} onClick={() => setReturnOpen(v => !v)} className="rounded-full border border-accent-300/30 bg-accent-300/10 px-3 py-2 text-accent-200 disabled:opacity-35">{b.returnDecision ? "Resume return settlement" : "Record return"}</button>}

        {b.status === "confirmed" && <button disabled={busy || !!processing || !!(b.activeAdditionId || b.activeExtensionId) || !!b.cancellationDecision} onClick={() => { setMode("remove"); setRemoveIndex(null); removeSelection.current = null; request.current = null; setError(""); }} className="rounded-full border border-white/10 px-3 py-2 text-white/65 disabled:opacity-35">Remove items</button>}
        {["pending_payment", "confirmed", "active"].includes(b.status) && (
          <button
            disabled={
              busy ||
              !!b.returnDecision ||
              !!processing ||
              !!(b.activeAdditionId || b.activeExtensionId) ||
              !!b.cancellationDecision
            }
            onClick={() => {
              request.current = null;
              setMode("add");
              setError("");
            }}
            className="rounded-full border border-white/10 px-3 py-2 text-white/65 disabled:opacity-35"
          >
            Add items
          </button>
        )}
        {b.status === "confirmed" && (
          <button
            disabled={
              busy ||
              !!b.returnDecision ||
              !!processing ||
              !!b.cancellationDecision ||
              !!(b.activeAdditionId || b.activeExtensionId)
            }
            onClick={() => {
              setDate(new Date(Math.min(...b.lineItems.map(l => l.start))).toISOString().slice(0, 10));
              setEndDate("");
              setKeepAgreedPrice(false);
              setMode("reschedule");
              setError("");
            }}
            className="rounded-full border border-white/10 px-3 py-2 text-white/65 disabled:opacity-35"
          >
            Change dates / reschedule
          </button>
        )}
        {["confirmed", "pending_payment"].includes(b.status) && (
          <button
            disabled={busy || !!b.returnDecision || !!processing || !!(b.activeAdditionId || b.activeExtensionId)}
            onClick={() => {
              setMode("cancel");
              setError("");
            }}
            className="rounded-full border border-white/10 px-3 py-2 text-white/65 disabled:opacity-35"
          >
            {b.cancellationDecision ? "Resume cancellation" : "Cancel rental"}
          </button>
        )}
        {b.status === "confirmed" &&
          b.cancellationKind === "full_refund" &&
          b.stripePaymentIntentId && (
            <button
              disabled={
                busy ||
                !!processing ||
                !!b.cancellationDecision ||
                !!(b.activeAdditionId || b.activeExtensionId)
              }
              onClick={() => {
                setMode("refund");
                setError("");
              }}
              className="rounded-full border border-white/10 px-3 py-2 text-white/65 disabled:opacity-35"
            >
              Partial / full rental refund
            </button>
          )}
      </div>
      {showReturn && returnOpen && <ReturnRentalForm booking={b} token={token} onClose={() => setReturnOpen(false)} />}
      {showReturn && (b.returnDecision || b.status === "returned") && <ReturnInspectionHistory token={token} bookingId={bookingId} />}
      <RentalManagerDelivery token={token} bookingId={bookingId} />
      {additions
        .filter(
          (r) =>
            !["applied", "applied_draft", "expired", "refunded"].includes(
              r.status,
            ),
        )
        .map((r) => (
          <div
            key={r._id}
            className="mt-3 rounded-xl bg-white/[0.035] p-3 text-xs text-white/60"
          >
            <p>
              {r.qty}× {rentalTitle(r.title)} · £
              {(r.lineTotal + r.securityCharge).toFixed(2)} ·{" "}
              {r.status.replaceAll("_", " ")}
            </p>
            <div className="mt-2 flex gap-3">
              {!r.paymentUrl && (
                <button
                  disabled={busy}
                  onClick={() => resumeAddition(r)}
                  className="text-accent-300"
                >
                  Resume proposal
                </button>
              )}
              {r.paymentUrl && (
                <a
                  target="_blank"
                  rel="noopener noreferrer"
                  href={r.paymentUrl}
                  className="text-accent-300"
                >
                  Open payment link
                </a>
              )}
              <button
                disabled={busy}
                onClick={() => withdrawAddition(r._id)}
                className="text-rose-300"
              >
                Withdraw proposal
              </button>
            </div>
            <p className="mt-2 text-white/35">
              Finish or withdraw this proposal before a refund, return,
              reschedule or cancellation.
            </p>
          </div>
        ))}
      {processing && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-amber-200">
          <span>
            {formatGbp(processing.amountPence / 100)} refund awaiting
            settlement.
          </span>
          <button disabled={busy} onClick={retry} className="underline">
            Check or resume this refund
          </button>
        </div>
      )}
      {mode && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="mt-4 rounded-2xl bg-white/[0.035] p-4"
        >
          <div className="flex justify-between">
            <h4 className="text-sm font-semibold text-white">
              {mode === "cancel"
                ? "Cancel this rental"
                : mode === "reschedule"
                  ? "Move rental dates"
                  : mode === "remove"
                    ? "Remove kit from this rental"
                  : mode === "add"
                    ? "Add items to the rental"
                    : "Refund rental payment"}
            </h4>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode(null)}
              className="text-xs text-white/40"
            >
              Close
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-white/45">
            {mode === "cancel"
              ? b.cancellationKind === "full_refund"
                ? "Within the refund window: remaining card payment is refunded and previously used account credit is restored."
                : "Outside the refund window: rental cash refund is 0%. Remaining rental payment becomes one-year account credit. Refundable security is returned separately."
              : mode === "remove"
                ? "Remove the selected item and release its stock. This does not change the agreed payment or security: use the separate refund control within the refund window. The original charge remains itemised on the receipt. To remove all kit, cancel the rental."
              : mode === "add"
                ? "Choose real catalogue items. We check stock and calculate the rental charge and any security increase, then send a secure checkout link in this conversation. Items are confirmed after payment and bank approval."
                : mode === "reschedule"
                  ? "Move the rental or set a new return date. Agreed charges and security stay the same: extra days are complimentary. Any eligible refund uses the separate refund control. Stock is checked before saving."
                  : "Refund all remaining rental payment, or specify a smaller amount. Security payment is handled separately on return or cancellation."}
          </p>
          {mode === "remove" && <div className="mt-3 grid gap-2">{b.lineItems.map((line, i) => <button type="button" key={i} onClick={() => { setRemoveIndex(i); removeSelection.current = { lineIndex: i, listingId: line.listingId, expectedQty: line.qty, expectedStart: line.start, expectedEnd: line.end }; request.current = null; }} className={`rounded-xl border p-3 text-left text-xs ${removeIndex === i ? "border-rose-400/60 text-white" : "border-white/10 text-white/60"}`}>{line.qty}× {rentalTitle(line.title)} · {formatGbp(line.lineTotal)}</button>)}</div>}
          {mode === "add" && (
            <div className="mt-3">
              <input
                aria-label="Search items to add"
                placeholder="Search kit"
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                className="w-full rounded-xl bg-[#151515] p-3 text-sm text-white"
              />
              <div className="mt-2 grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2">
                {catalog
                  ?.filter((l) => !l.displayOnly)
                  .slice(0, 10)
                  .map((l) => (
                    <button
                      type="button"
                      key={l._id}
                      onClick={() => setListingId(l._id)}
                      title={l.title}
                      className={`flex items-center gap-2 rounded-xl border p-2 text-left ${listingId === l._id ? "border-accent-400/60" : "border-white/10"}`}
                    >
                      <SmartImage
                        src={l.heroImage}
                        alt=""
                        className="h-9 w-9 shrink-0 overflow-hidden rounded-lg"
                      />
                      <span className="text-xs text-white/70">
                        {rentalTitle(l.title)}
                      </span>
                    </button>
                  ))}
              </div>
              <label className="mt-3 block text-xs text-white/55">
                Quantity
                <input
                  type="number"
                  min={1}
                  max={20}
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="ml-3 w-20 rounded-lg bg-[#151515] p-2 text-white"
                />
              </label>
              <label className="mt-3 flex items-center gap-2 text-xs text-white/55">
                <input
                  type="checkbox"
                  checked={complimentary}
                  onChange={(e) => setComplimentary(e.target.checked)}
                />{" "}
                No rental charge · any required refundable security still
                applies
              </label>
            </div>
          )}
          {mode === "reschedule" && (
            <div className="grid gap-3 sm:grid-cols-2"><label className="mt-3 block text-xs text-white/55">
              New start date
              <input
                required
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block rounded-xl border border-white/10 bg-[#151515] p-3 text-white [color-scheme:dark]"
              />
            </label>
            <label className="mt-3 block text-xs text-white/55">New return date · optional
              <input type="date" min={date || undefined} value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-1 block max-w-full rounded-xl border border-white/10 bg-[#151515] p-3 text-white [color-scheme:dark]" />
              <span className="mt-1 block text-white/35">Leave blank to keep the same duration.</span>
            </label></div>
          )}
          {mode === "reschedule" && endDate && <label className="mt-3 flex items-start gap-2 text-xs text-white/60"><input type="checkbox" required checked={keepAgreedPrice} onChange={e => setKeepAgreedPrice(e.target.checked)} className="mt-0.5" />Keep the agreed rental charge for these dates. I approve any extra days as complimentary; any eligible refund is handled separately.</label>}
          {mode === "refund" && (
            <label className="mt-3 block text-xs text-white/55">
              Amount in £ · leave blank for full remaining rental payment
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  request.current = null;
                }}
                className="mt-1 w-full rounded-xl bg-[#151515] p-3 text-white"
              />
            </label>
          )}
          <label className="mt-3 block text-xs text-white/55">
            Reason · shared with the customer
            <textarea
              required
              minLength={5}
              maxLength={400}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-xl bg-[#151515] p-3 text-sm text-white"
            />
          </label>
          <button
            disabled={busy || (mode === "add" && !listingId) || (mode === "remove" && removeIndex === null)}
            className={`mt-3 rounded-full px-4 py-2 text-xs font-semibold text-white ${mode === "cancel" ? "bg-rose-600" : "bg-accent-500"}`}
          >
            {busy
              ? "Processing…"
              : mode === "cancel"
                ? "Confirm cancellation"
                : mode === "reschedule"
                  ? "Save new dates"
                  : mode === "remove"
                    ? "Confirm item removal"
                  : mode === "add"
                    ? "Create payment link"
                    : "Confirm refund"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-rose-300">
          {error}
        </p>
      )}
      {result && (
        <p role="status" className="mt-3 text-xs text-emerald-300">
          {result}
        </p>
      )}
    </div>
  );
}
