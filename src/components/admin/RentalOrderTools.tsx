"use client";
import chatStyles from "@/components/rentals/RentalConversation.module.css";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalRefundRecovery } from "./RentalRefundRecovery";
import { ReturnRentalForm } from "./ReturnRentalForm";
import { ReturnInspectionHistory } from "./ReturnInspectionHistory";
import { RentalManagerDelivery } from "./RentalManagerDelivery";
import { SmartImage } from "@/components/SmartImage";
import { rentalTitle } from "@/lib/rentalPresentation";
import { formatGbp } from "@/lib/pricing";
import { rentalHandoverLabel } from "../../../shared/rentalHandover";
import { rentalDate } from "@/lib/rentalPresentation";
import { RentalRequestApply } from "@/components/rentals/RentalRequestApply";
import { RentalKitProposalStatus } from "./RentalKitProposalStatus";
import { RentalKitProposal } from "./RentalKitProposal";
import { RentalRequestHistory } from "@/components/rentals/RentalRequestHistory";

export function RentalOrderTools(props:{token:string;bookingId:string;showReturn?:boolean;initialMode?:"reschedule"|"refund"|"add"}) {
  return <OrderTools key={JSON.stringify([props.token,props.bookingId,props.showReturn??true,props.initialMode])} {...props}/>;
}

function CardAuthorisation({booking}:{booking:{depositHoldAmount?:number;depositHoldStatus?:string;depositHoldExpiresAt?:number;depositHoldCapturedForDamage?:number}}) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{
    const expires=booking.depositHoldExpiresAt;
    if(booking.depositHoldStatus!=="held"||expires==null||expires<=Date.now())return;
    const timer=setTimeout(()=>setNow(Date.now()),Math.min(expires-Date.now()+1,2147483647));
    return()=>clearTimeout(timer);
  },[booking.depositHoldStatus,booking.depositHoldExpiresAt,now]);
  const amount=booking.depositHoldAmount??0;
  const expired=booking.depositHoldStatus==="held"&&booking.depositHoldExpiresAt!=null&&booking.depositHoldExpiresAt<=Math.max(now,Date.now());
  const status=amount===0?"Not required":expired?"Expired · needs review":({scheduled:"Scheduled for collection",awaiting_payment:"Waiting for payment",processing:"Authorisation processing",requires_action:"Bank approval required",held:booking.depositHoldExpiresAt==null?"Held · expiry unconfirmed":"Held · not charged",released:"Released",captured:"Captured",failed:"Authorisation failed",expired:"Expired · needs review"} as Record<string,string>)[booking.depositHoldStatus??""]??"Status needs review";
  return <>
    <div data-testid="owner-card-authorisation"><dt>Card authorisation target</dt><dd>{formatGbp(amount)}<small className={chatStyles.securityStatus} data-status={expired?"expired":booking.depositHoldStatus??"unknown"}>{status}</small></dd></div>
    {(booking.depositHoldCapturedForDamage??0)>0&&<div><dt>Captured for damage</dt><dd>{formatGbp(booking.depositHoldCapturedForDamage!)}</dd></div>}
  </>;
}
function OrderTools({
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
  const [kitOpen,setKitOpen]=useState(initialMode === "add");
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
  const add = useAction(api.rentalAdditions.start),
    checkAddition=useAction(api.rentalAdditions.resumeByOwner),
    withdraw = useAction(api.rentalAdditions.withdrawByOwner);
  const setStatus = useMutation(api.bookings.adminSetStatus);
  const [returnOpen, setReturnOpen] = useState(false);
  const remove = useMutation(api.rentalOperations.removeItem),
    refund = useAction(api.checkout.refundRental);
  const [mode, setMode] = useState<
      "refund" | "remove" | null
    >(initialMode === "refund" ? "refund" : null),
    [reason, setReason] = useState(""),
    [amount, setAmount] = useState("");
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const removeSelection = useRef<{ lineIndex: number; listingId: any; expectedQty: number; expectedStart: number; expectedEnd: number } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const request = useRef<string | null>(null);
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
  async function retry(saved: {requestId:string;reason:string} | undefined = processing) {
    if (!saved) return;
    setBusy(true);
    setError("");
    try {
      const r = await refund({
        token,
        bookingId: bookingId as any,
        requestId: saved.requestId,
        reason: saved.reason,
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
        changeRequestId:r.changeRequestId,
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
  async function checkSavedAddition(r:any){
    if(busy)return;setBusy(true);setError("");
    try{const outcome=await checkAddition({token,bookingId:bookingId as any,id:r._id});
      setResult(outcome.status==="requires_action"?"Payment received. The renter must complete bank approval in their account.":outcome.status==="awaiting_payment"?"Payment is still outstanding. The saved link remains available.":["held","scheduled","applied","applied_draft","draft_applied"].includes(outcome.status)?"The paid proposal has been processed. Check the updated rental kit.":`Proposal status: ${outcome.status.replaceAll("_"," ")}.`);
    }catch(e:any){setError(e.data?.message??"The proposal could not be checked. Retry its saved payment status.");}
    finally{setBusy(false);}
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
      <section className={chatStyles.bookingFacts} aria-label="Booked equipment and handover">
        <div className={chatStyles.factsIdentity}><SmartImage src={b.lineItems[0]?.heroImage} fallbackSources={b.lineItems[0]?.imageSources} alt={b.lineItems[0]?.title ?? "Rental kit"} className={chatStyles.factsPhoto} /><div><h5>{rentalTitle(b.lineItems[0]?.title ?? "Rental kit")}</h5><p>DBC-{bookingId.slice(-8).toUpperCase()} · {b.lineItems.length} listings</p></div></div>
        <dl><div><dt>Rental dates</dt><dd>{b.lineItems.length ? rentalDate(Math.min(...b.lineItems.map(l => l.start)), Math.max(...b.lineItems.map(l => l.end))) : "Dates need review"}</dd></div><div><dt>{b.fulfilment === "delivery" ? "Delivery" : "Collection"}</dt><dd>{rentalHandoverLabel(b,"pickup")}</dd></div><div><dt>Return</dt><dd>{rentalHandoverLabel(b,"return")}</dd></div><div data-testid="owner-current-customer"><dt>Customer</dt><dd>{b.customer ? b.customer.name || b.customer.email : b.accountId ? "Account needs review" : b.guestName || "Guest renter"}</dd></div>{(b.customer?.email || !b.accountId && b.guestEmail) && <div data-testid="owner-current-email"><dt>{b.customer ? "Account email" : "Booking email"}</dt><dd>{b.customer?.email || b.guestEmail}</dd></div>}{b.customer?.phone&&<div><dt>Phone</dt><dd>{b.customer.phone}</dd></div>}<div><dt>Verification</dt><dd data-verified={b.idVerifyStatus === "verified"}>{b.idVerifyStatus === "verified" ? "✓ Verified" : (b.idVerifyStatus ?? "Required").replaceAll("_", " ")}</dd></div></dl>
      </section>
      <dl className={chatStyles.paymentSummary} aria-label="Booking financial summary">
        <div><dt>Booking total</dt><dd>{formatGbp(b.total)}</dd></div>
        <div><dt>Refundable deposit</dt><dd>{formatGbp(b.depositAmount ?? 0)}</dd></div>
        <CardAuthorisation booking={b}/>
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
        {showReturn && (b.status === "active" || !!b.returnDecision && (b.status !== "returned" || !b.returnStatement || b.depositAmount > 0 && !b.depositRefunded)) && <button disabled={busy || !!processing || !!(b.activeAdditionId || b.activeExtensionId) || !!b.cancellationDecision} onClick={() => setReturnOpen(v => !v)} className="rounded-full border border-accent-300/30 bg-accent-300/10 px-3 py-2 text-accent-200 disabled:opacity-35">{b.returnDecision ? "Resume return settlement" : "Record return"}</button>}

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
              setKitOpen(true);
              setError("");
            }}
            className="rounded-full border border-white/10 px-3 py-2 text-white/65 disabled:opacity-35"
          >
            Add items
          </button>
        )}
        {b.status === "confirmed" && <RentalRequestApply token={token} bookingId={bookingId} kind="dates" initialOpen={initialMode === "reschedule"} label="Change dates / reschedule" decisionNote="Update the agreed rental dates." disabled={busy || !!b.returnDecision || !!processing || !!b.cancellationDecision || !!(b.activeAdditionId || b.activeExtensionId)} />}
        {["confirmed", "pending_payment"].includes(b.status) && <RentalRequestApply token={token} bookingId={bookingId} kind="cancel" label={b.cancellationDecision ? "Resume cancellation" : "Cancel rental"} decisionNote="Cancel the rental under the agreed terms." disabled={busy || !!b.returnDecision || !!processing || !!(b.activeAdditionId || b.activeExtensionId)} />}
        {["confirmed", "active"].includes(b.status) &&
          b.stripePaymentIntentId && (
            <button
              disabled={
                busy ||
                !!processing ||
                !!b.cancellationDecision ||
                !!b.returnDecision ||
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
      {kitOpen&&<RentalKitProposal token={token} bookingId={bookingId} onClose={()=>setKitOpen(false)}/>}
      <RentalManagerDelivery token={token} bookingId={bookingId} />
      {additions
        .filter(
          (r) =>
            !["applied", "applied_draft", "expired", "refunded"].includes(
              r.status,
            ),
        )
        .map((r) => <RentalKitProposalStatus key={r._id} proposal={r} busy={busy} onResume={()=>void resumeAddition(r)} onCheck={()=>void checkSavedAddition(r)} onWithdraw={()=>void withdrawAddition(r._id)} />)}
      <RentalRefundRecovery token={token} bookingId={bookingId} refunds={b.rentalRefunds} onResume={retry} busy={busy}/>
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
              {mode === "remove" ? "Remove kit from this rental" : "Refund rental payment"}
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
            {mode === "remove" ? "Remove the selected item and release its stock. Agreed payment and security stay unchanged; use the refund control for an eligible rental refund. To remove all kit, cancel the rental." : "Refund all remaining rental payment, or specify a smaller amount. Security payment is handled separately on return or cancellation."}
          </p>
          {mode === "remove" && <div className="mt-3 grid gap-2">{b.lineItems.map((line, i) => <button type="button" key={i} onClick={() => { setRemoveIndex(i); removeSelection.current = { lineIndex: i, listingId: line.listingId, expectedQty: line.qty, expectedStart: line.start, expectedEnd: line.end }; request.current = null; }} className={`rounded-xl border p-3 text-left text-xs ${removeIndex === i ? "border-rose-400/60 text-white" : "border-white/10 text-white/60"}`}>{line.qty}× {rentalTitle(line.title)} · {formatGbp(line.lineTotal)}</button>)}</div>}
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
            disabled={busy || (mode === "remove" && removeIndex === null)}
            className="mt-3 rounded-full bg-accent-500 px-4 py-2 text-xs font-semibold text-white"
          >
            {busy ? "Processing…" : mode === "remove" ? "Confirm item removal" : "Confirm refund"}
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
      <div className={chatStyles.requestHistory}><RentalRequestHistory token={token} bookingId={bookingId} admin /></div>
    </div>
  );
}
