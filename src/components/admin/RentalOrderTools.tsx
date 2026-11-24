"use client";
import chatStyles from "@/components/rentals/RentalConversation.module.css";
import { useCallback, useRef, useState, useEffect } from "react";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { ReturnRentalForm } from "./ReturnRentalForm";
import { DepositRefundStatus } from "./DepositRefundStatus";
import { ReturnInspectionHistory } from "./ReturnInspectionHistory";
import { RentalManagerDelivery } from "./RentalManagerDelivery";
import { SmartImage } from "@/components/SmartImage";
import { rentalTitle } from "@/lib/rentalPresentation";
import { formatGbp } from "@/lib/pricing";
import { rentalHandoverLabel } from "../../../shared/rentalHandover";
import { rentalDate } from "@/lib/rentalPresentation";
import { cancellationTimingBasis, isNoRefundWithin48HoursCancellationVersion } from "@/lib/cancellationPolicy";
import { RentalRequestHistory } from "@/components/rentals/RentalRequestHistory";
import { SavedCardCharges } from "@/components/rentals/SavedCardCharges";
import {OperatorCancellationStatus} from "./OperatorCancellationStatus";
import { RentalDeliveryQuotePanel } from "./RentalDeliveryQuotePanel";
import { RentalReviewRequest } from "./RentalReviewRequest";
import { RentalPricePanel } from "@/components/rentals/RentalPricePanel";
import { RentalCasePanel } from "./RentalCasePanel";
import { RentalSwapRecovery } from "./RentalSwapRecovery";
import { RentalSwapStockReview } from "./RentalSwapStockReview";
import { RentalSwapProposal } from "./RentalSwapProposal";
import { InventoryConflictRefund } from "./InventoryConflictRefund";
import { CompactRentalImages } from "./CompactRentalImages";
import { AdminHandoverSummary } from "./AdminHandoverSummary";
import { RENTAL_TIME_SLOTS } from "../../../shared/rentalWindow";
import { hasCashDepositPolicy } from "../../../shared/rentalSecurity";
import { confirmedRentalRefundPence, rentalRefundSummary } from "../../../shared/rentalRefundSummary";

const stripeApprovalUrlPattern = /^https:\/\/dashboard\.stripe\.com\/(?:acct_[A-Za-z0-9]+\/)?settings\/approvals\/requests\/apreq_[A-Za-z0-9]+$/;
function safeStripeApprovalUrl(value: unknown): string | undefined {
  return typeof value === "string" && stripeApprovalUrlPattern.test(value) ? value : undefined;
}

function cancellationAdminHint(booking: { cancellationKind?: string; cancellationTermsVersion?: string }) {
  const timingBasis = cancellationTimingBasis(
    booking.cancellationKind as "full_refund" | "store_credit" | "no_refund" | undefined,
    booking.cancellationTermsVersion,
  );
  if (timingBasis) {
    if (booking.cancellationKind === "full_refund") return `${timingBasis}: record whether the renter chose a full refund or 100% account credit.`;
    if (booking.cancellationKind === "store_credit") return `${timingBasis}: account credit only; no rental cash refund.`;
    return `${timingBasis}: no rental refund or account credit. Any separately refundable security is settled separately.`;
  }
  if (booking.cancellationKind === "full_refund") {
    return isNoRefundWithin48HoursCancellationVersion(booking.cancellationTermsVersion)
      ? "More than seven days before pickup: the renter may choose a full refund or 100% account credit. Record their explicit choice."
      : "Within the refund window: remaining card payment is refunded and previously used account credit is restored.";
  }
  if (booking.cancellationKind === "no_refund") return "Within 48 hours of pickup: no rental refund or account credit. Any separately refundable security is settled separately.";
  return "Outside the refund window: rental cash refund is 0%. Remaining rental payment becomes one-year account credit. Refundable security is returned separately.";
}

export function RentalOrderTools({
  token,
  bookingId,
  showReturn = true,
  showSavedCardTools = true,
  compactControls = false,
  showPriceTools = false,
  initialMode,
}: {
  token: string;
  bookingId: string;
  /** Return settlement belongs in the rental conversation, where the customer record is visible. */
  showReturn?: boolean;
  /** AccountAdmin has one dedicated Payments section; keep the rental action panel focused. */
  showSavedCardTools?: boolean;
  /** Group the account-rail actions into short, discoverable rows. */
  compactControls?: boolean;
  /** Show the existing renter-accepted price-change path beside rental payments. */
  showPriceTools?: boolean;
  /** The exact extension request already shown by the adjacent live extension panel. */
  initialMode?:"reschedule"|"refund"|"add";
}) {
  const requestScope = `${token}:${bookingId}`;
  const [itemQuoteRequest, setItemQuoteRequest] = useState<{ requestId: string; lineIndexes: number[] } | null>(null);
  const prepareItemChangeQuote = useCallback((request: { requestId: string; lineIndexes: number[] }) => setItemQuoteRequest(request), []);
  const clearItemChangeQuote = useCallback(() => setItemQuoteRequest(null), []);
  const [blockingRequests, setBlockingRequests] = useState<{ scope: string; loaded: boolean; any: boolean; dates: boolean; cancel: boolean; handover: boolean }>({ scope: "", loaded: false, any: false, dates: false, cancel: false, handover: false });
  const publishBlockingRequests = useCallback((pending: { any: boolean; dates: boolean; cancel: boolean; handover: boolean }, ready: boolean) => {
    setBlockingRequests(previous => previous.scope === requestScope && previous.loaded === ready && previous.any === pending.any && previous.dates === pending.dates && previous.cancel === pending.cancel && previous.handover === pending.handover
      ? previous
      : { scope: requestScope, loaded: ready, ...pending });
  }, [requestScope]);
  const blockingRequestStateReady = blockingRequests.scope === requestScope && blockingRequests.loaded;
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
  const [debouncedLookup, setDebouncedLookup] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedLookup(lookup), 250);
    return () => window.clearTimeout(timer);
  }, [lookup]);
  const add = useAction(api.rentalAdditions.start),
    withdraw = useAction(api.rentalAdditions.withdrawByOwner),
    recoverAdditionPayment = useAction(api.rentalAdditions.recoverPayment);
  const setStatus = useMutation(api.bookings.adminSetStatus);
  const [returnOpen, setReturnOpen] = useState(false);
  const reschedule = useMutation(api.rentalOperations.reschedule),
    changeHandoverTimes = useMutation(api.rentalOperations.changeHandoverTimes),
    cancel = useAction(api.checkout.cancelByAdmin),
    refund = useAction(api.checkout.refundRental);
  const [mode, setMode] = useState<
      "reschedule" | "pickup-time" | "return-time" | "cancel" | "refund" | "add" | null
    >(initialMode??null),
    [date, setDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [reason, setReason] = useState(""),
    [amount, setAmount] = useState(""),
    [refundLineIndex, setRefundLineIndex] = useState("");
  const [keepAgreedPrice, setKeepAgreedPrice] = useState(false);
  const [rescheduleSnapshot, setRescheduleSnapshot] = useState<string | undefined>();
  const [handoverLines, setHandoverLines] = useState<number[]>([]), [handoverTime, setHandoverTime] = useState(""), [handoverSnapshot, setHandoverSnapshot] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const [refundApproval, setRefundApproval] = useState<{ requestId: string; url: string } | null>(null);
  const refundRows = b?.rentalRefunds;
  useEffect(() => {
    if (!refundApproval || !refundRows) return;
    const saved = refundRows.find((refund) => refund.requestId === refundApproval.requestId);
    if (saved && (!["prepared", "pending"].includes(saved.status) || !saved.refundReceipts?.some(receipt => receipt.status === "awaiting_approval"))) {
      setRefundApproval(null);
    }
  }, [refundApproval, refundRows]);
  const request = useRef<string | null>(null);
  useEffect(() => {
    if (b?.activeAdditionId && mode === "add" && !busy) setMode(null);
  }, [b?.activeAdditionId, mode, busy]);
  const catalog = usePaginatedQuery(
    api.catalog.adminListListings,
    mode === "add" ? { token, search: debouncedLookup } : "skip",
    { initialNumItems: 40 },
  );
  if (!b) return null;
  const processing = b.rentalRefunds.find(
    (r) => r.status === "prepared" || r.status === "pending",
  );
  const hasActiveRentalChange = Boolean(
    b.activeAdditionId || b.activeDeliveryQuoteId || b.activeItemSwapId ||
    b.activeExtensionId || b.activePriceAdjustmentId,
  );
  const diditDeclinedPending = b.status === "pending_verification" && b.verificationProvider === "didit" && b.idVerifyStatus === "rejected";
  const refundSummary = rentalRefundSummary(b.total, b.depositAmount ?? 0, b.rentalRefunds ?? []);
  const hasUnitemizedConfirmedRefund = b.rentalRefunds.some((refund: any) => !refund.lineAllocation && confirmedRentalRefundPence(refund) > 0 && !(b.itemPaymentLedgerVersion===1 && b.itemPaymentLedger && b.itemPaymentLedgerRefundIds?.some(id=>String(id)===String(refund._id))));
  const refundItemOptions = b.lineItems.map((line: any, index: number) => {
    const funding = b.checkoutLineFunding?.[index];
    const additionCardPence = b.addedItemCardPence?.[index];
    const fundingMatches = funding && String(funding.listingId) === String(line.listingId) && funding.qty === line.qty && Number.isFinite(funding.card) && funding.card >= 0 || Number.isSafeInteger(additionCardPence) && additionCardPence! > 0;
    const recorded = b.itemPaymentLedgerVersion === 1 && b.itemPaymentLedger?.length === b.lineItems.length ? b.itemPaymentLedger[index] : null;
    const recordedSourcesValid = !!(recorded && funding && String(recorded.listingId) === String(line.listingId) && recorded.qty === line.qty && String(funding.listingId) === String(line.listingId) && funding.qty === line.qty && recorded.sources.every(source => !!source.paymentIntentId && Number.isSafeInteger(source.amountPence) && source.amountPence > 0) && new Set(recorded.sources.map(source => source.paymentIntentId)).size === recorded.sources.length && recorded.sources.reduce((sum,source) => sum + source.amountPence,0) === Math.round(funding.card * 100));
    const sourceUncertain = !!b.itemRefundSourceUncertain && !recordedSourcesValid;
    const itemRefunded = b.rentalRefunds.reduce((total: number, refund: any) => {
      const allocation = refund.lineAllocation;
      return allocation && allocation.lineIndex === index && String(allocation.listingId) === String(line.listingId) && allocation.qty === line.qty
        ? total + confirmedRentalRefundPence(refund)
        : total;
    }, 0);
    const maxPence = fundingMatches ? Math.min(refundSummary.remainingRefundCapPence, Math.max(0, (funding ? Math.round(funding.card * 100) : additionCardPence!) - itemRefunded)) : 0;
    return { line, index, maxPence, sourceUncertain, selectable: !!fundingMatches && maxPence > 0 && !hasUnitemizedConfirmedRefund && !sourceUncertain };
  });
  const selectedRefundLine = refundLineIndex === "" ? undefined : refundItemOptions[Number(refundLineIndex)];
  const savedApprovalUrl = safeStripeApprovalUrl(processing?.refundReceipts?.find(receipt => receipt.status === "awaiting_approval")?.approvalUrl);
  const processingApprovalUrl = savedApprovalUrl ?? (refundApproval && processing?.requestId === refundApproval.requestId ? safeStripeApprovalUrl(refundApproval.url) : undefined);
  async function submit() {
    if (!b || busy) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
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
          expectedSnapshot: rescheduleSnapshot,
        });
        setResult(
          "Rental dates updated. The customer will receive confirmation.",
        );
      }
      if (mode === "pickup-time" || mode === "return-time") {
        request.current ??= crypto.randomUUID();
        const changed = await changeHandoverTimes({token,bookingId:bookingId as any,requestId:request.current,lineIndexes:handoverLines,kind:mode === "pickup-time" ? "pickup" : "return",time:handoverTime,expectedSnapshot:handoverSnapshot,reason});
        setResult(`${changed.detail} The conversation is updated and confirmation email is queued.`);
        request.current = null;
      }
      if (mode === "cancel") {
        const r = await cancel({ token, bookingId: bookingId as any, reason });
        setResult(
          r.mode==="waiting"?"Rental cancelled. Settlement waits one hour for the account decision, then the renter receives their refund or credit options.":`Cancelled. Card refund ${formatGbp(r.refundAmount)}${r.creditAmount ? ` · account credit ${formatGbp(r.creditAmount)}` : ""}.`,
        );
      }
      if (mode === "refund") {
        request.current ??= crypto.randomUUID();
        const requestId = request.current;
        const refundReason = selectedRefundLine ? `${reason.trim()} — ${rentalTitle(selectedRefundLine.line.title)}` : reason;
        const r = await refund({
          token,
          bookingId: bookingId as any,
          requestId,
          amountPence: amount ? Math.round(Number(amount) * 100) : undefined,
          ...(selectedRefundLine ? { lineIndex: selectedRefundLine.index } : {}),
          reason: refundReason,
          expectedSnapshot: b.controlsSnapshot,
        });
        setResult(r.status === "awaiting_approval" ? `${formatGbp(r.amount)} rental refund is awaiting Stripe approval.` : `${formatGbp(r.amount)} rental refund: ${r.status}.`);
        const approvalUrl = safeStripeApprovalUrl(r.approvalUrl);
        setRefundApproval(r.status === "awaiting_approval" && approvalUrl ? { requestId, url: approvalUrl } : null);
        if (!["pending", "awaiting_approval"].includes(r.status)) request.current = null;
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
        ...(processing.lineAllocation ? { lineIndex: processing.lineAllocation.lineIndex } : {}),
        reason: processing.reason,
      });
      setResult(r.status === "awaiting_approval" ? `${formatGbp(r.amount)} rental refund is awaiting Stripe approval.` : `${formatGbp(r.amount)} refund: ${r.status}.`);
      const approvalUrl = safeStripeApprovalUrl(r.approvalUrl);
      setRefundApproval(r.status === "awaiting_approval" && approvalUrl ? { requestId: processing.requestId, url: approvalUrl } : null);
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
  async function recoverAddition(id: string) {
    setBusy(true); setError(""); setResult("");
    try {
      const result = await recoverAdditionPayment({ token, id: id as any });
      setResult(result.status === "paid" ? "Payment confirmed. Item added." : result.status === "closed" ? "Proposal closed. Check account credit." : result.status === "processing" ? "Payment is still processing." : "No unique payment found. Review Stripe.");
    } catch (e: any) { setError(e.message ?? "Payment check failed. The rental remains protected."); }
    finally { setBusy(false); }
  }
  const compactButton = (base: string) => `${compactControls ? "w-full justify-start rounded-xl text-left" : "rounded-full"} ${base}`;
  const changeButtons = <>
    {["pending_payment", "confirmed", "active"].includes(b.status) && <button data-testid="rental-action-add-item" disabled={busy || !!b.returnDecision || !!processing || hasActiveRentalChange || !!b.cancellationDecision} onClick={() => { request.current = null; setMode("add"); setError(""); }} className={compactButton("border border-white/10 px-3 py-2 text-white/65 disabled:opacity-35")}>Add item</button>}
    {b.status === "confirmed" && blockingRequestStateReady && !blockingRequests.any && <button data-testid="rental-action-reschedule" disabled={busy || !!b.returnDecision || !!processing || !!b.cancellationDecision || hasActiveRentalChange} onClick={() => { setDate(new Date(Math.min(...b.lineItems.map(l => l.start))).toISOString().slice(0, 10)); setEndDate(""); setKeepAgreedPrice(false); setRescheduleSnapshot(b.controlsSnapshot); setMode("reschedule"); setError(""); }} className={compactButton("border border-white/10 px-3 py-2 text-white/65 disabled:opacity-35")}>Change dates</button>}
    {blockingRequestStateReady && !blockingRequests.any
      ? (["pickup-time", "return-time"] as const)
        .filter(kind => b.status === "confirmed" || b.status === "active" && kind === "return-time")
        .map(kind => (
          <button data-testid={`rental-action-${kind}`} key={kind} type="button" disabled={busy || !!b.returnDecision || !!processing || !!b.cancellationDecision || hasActiveRentalChange} onClick={() => { setHandoverLines(b.lineItems.map((_, index) => index)); setHandoverTime(""); setHandoverSnapshot(b.controlsSnapshot); request.current = null; setMode(kind); setError(""); }} className={compactButton("border border-white/10 px-3 py-2 text-white/65 disabled:opacity-35")}>
            Change {kind === "pickup-time" ? "pickup" : "return"} time
          </button>
        ))
      : null}
  </>;
  const handoverButtons = <>
    {b.status === "confirmed" && <button data-testid="rental-action-pickup" disabled={!blockingRequestStateReady || blockingRequests.any || busy || !!processing || !!(b.activeAdditionId || b.activeDeliveryQuoteId || b.activeExtensionId) || !!b.cancellationDecision || !!b.returnDecision} onClick={async () => { setBusy(true); setError(""); setResult(""); try { await setStatus({ token, bookingId: bookingId as any, status: "active" }); setResult("Pickup recorded. Rental is now out."); } catch (e: any) { setError(e.message ?? "Pickup could not be recorded."); } finally { setBusy(false); } }} className={compactButton("border border-accent-300/30 bg-accent-300/10 px-3 py-2 text-accent-200 disabled:opacity-35")}>Mark picked up</button>}
    {showReturn && (b.status === "active" || !!b.returnDecision && b.status !== "returned") && <button data-testid="rental-action-return" aria-label={b.returnDecision ? "Continue recording this rental return" : "Mark this rental as returned"} disabled={busy || !!processing || hasActiveRentalChange || !!b.cancellationDecision} onClick={() => setReturnOpen(v => !v)} className={compactButton("border border-accent-300/30 bg-accent-300/10 px-3 py-2 text-accent-200 disabled:opacity-35")}>{b.returnDecision ? "Continue return" : "Mark returned"}</button>}
  </>;
  const paymentButtons = <>
    {(["confirmed", "pending_payment"].includes(b.status) || diditDeclinedPending) && blockingRequestStateReady && !blockingRequests.cancel && <button data-testid="rental-action-cancel" disabled={busy || blockingRequests.any || !!b.returnDecision || !!processing || hasActiveRentalChange} title={blockingRequests.any ? "Resolve the renter’s open request first" : undefined} onClick={() => { setMode("cancel"); setError(""); }} className={compactButton("border border-white/10 px-3 py-2 text-white/65 disabled:opacity-35")}>{b.cancellationDecision ? "Resume cancellation" : diditDeclinedPending ? "Retry settlement" : "Cancel rental"}</button>}
    {["confirmed", "active"].includes(b.status) && (b.hasRefundablePayment || b.stripePaymentIntentId) && <button data-testid="rental-action-refund" disabled={busy || !!processing || !!b.returnDecision || !!b.cancellationDecision || hasActiveRentalChange} onClick={() => { request.current = null; setAmount(""); setRefundLineIndex(""); setReason(""); setMode("refund"); setError(""); }} className={compactButton("border border-white/10 px-3 py-2 text-white/65 disabled:opacity-35")}>Refund rental charge</button>}
  </>;
  const hasChangeActions = ["pending_payment", "confirmed", "active"].includes(b.status);
  const hasHandoverActions = b.status === "confirmed" || showReturn && (b.status === "active" || !!b.returnDecision && b.status !== "returned");
  const hasPaymentActions = ["confirmed", "pending_payment"].includes(b.status) || ["confirmed", "active"].includes(b.status) && !!(b.hasRefundablePayment || b.stripePaymentIntentId) || diditDeclinedPending;
  return (
    <div data-testid="owner-rental-tools">
      {(b.verificationConfirmationIssue === "inventory_unavailable" || b.verificationConfirmationIssue === "manager_capacity_conflict") && <div role="alert" className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-100">
        <p className="font-semibold">Checkout completed · {b.verificationConfirmationIssue === "manager_capacity_conflict" ? "Manager could not reserve stock" : "equipment needs review"}</p>
        <p className="mt-1">This booking is not confirmed. Recheck live availability and payment, and contact the renter before offering alternatives. If it cannot be fulfilled, resolve the original payment through the approved settlement process. Do not mark it confirmed without an acknowledged stock reservation.</p>
      </div>}
      {diditDeclinedPending && <div role="alert" data-testid="didit-declined-rental-notice" className="mb-3 rounded-xl border border-rose-300/20 bg-rose-300/[.05] px-3 py-2.5 text-xs text-rose-100"><p className="font-medium">Didit declined · rental needs resolution</p><p className="mt-1 text-rose-100/70">{b.cancellationDecision ? "Retry the saved settlement." : "Cancel to begin settlement under the accepted terms."} No 130% bonus applies.</p></div>}
      <section className={chatStyles.bookingFacts} aria-label="Booked equipment and handover">
        {b.lineItems.length > 0 && <div className="mb-3"><CompactRentalImages items={b.lineItems} /></div>}
        <div className={chatStyles.factsIdentity}><div className="min-w-0"><h5>{rentalTitle(b.lineItems[0]?.title ?? "Rental kit")}</h5><p>DBC-{bookingId.slice(-8).toUpperCase()} · {b.lineItems.length} listings</p></div></div>
        <dl><div><dt>Rental dates</dt><dd>{b.lineItems.length ? rentalDate(Math.min(...b.lineItems.map(l => l.start)), Math.max(...b.lineItems.map(l => l.end))) : "Dates need review"}</dd></div><div><dt>Customer</dt><dd>{b.guestName || b.guestEmail}</dd></div><div><dt>Verification</dt><dd data-verified={b.idVerifyStatus === "verified"}>{b.idVerifyStatus === "verified" ? "✓ Verified" : (b.idVerifyStatus ?? "Required").replaceAll("_", " ")}</dd></div></dl>
      </section>
      <AdminHandoverSummary booking={b} />
      <InventoryConflictRefund key={`inventory-conflict:${token}:${bookingId}`} token={token} bookingId={bookingId}/>
      <RentalRequestHistory token={token} bookingId={bookingId} admin onBlockingRequests={publishBlockingRequests} onPrepareItemChange={prepareItemChangeQuote} />
      <RentalSwapRecovery key={`swap-recovery:${token}:${bookingId}`} token={token} bookingId={bookingId} />
      <RentalSwapStockReview key={`swap-stock-review:${token}:${bookingId}`} token={token} bookingId={bookingId} />
      {b.status === "confirmed" && <RentalSwapProposal key={`swap-proposal:${token}:${bookingId}`} token={token} bookingId={bookingId} items={b.lineItems} itemChangeRequest={itemQuoteRequest} onItemChangeQuoteSent={clearItemChangeQuote} />}
      <OperatorCancellationStatus key={`cancellation-status:${bookingId}`} token={token} bookingId={bookingId}/>
      <dl className={chatStyles.paymentSummary} aria-label="Booking financial summary" data-testid="rental-financial-summary">
        <div><dt>Rental charge · security excluded</dt><dd>{formatGbp(refundSummary.rentalAmountPence / 100)}</dd></div>
        <div><dt>Rental refunds confirmed</dt><dd>{formatGbp(refundSummary.confirmedRefundedPence / 100)}</dd></div>
        {refundSummary.pendingRefundPence > 0 && <div><dt>Refund in progress</dt><dd>{formatGbp(refundSummary.pendingRefundPence / 100)}</dd></div>}
        <div><dt>Refund cap left after pending</dt><dd>{formatGbp(refundSummary.remainingRefundCapPence / 100)}</dd></div>
        <div><dt>Refundable deposit</dt><dd>{formatGbp(b.depositAmount ?? 0)}</dd></div>
        <div><dt>Card authorisation</dt><dd>{formatGbp(b.depositHoldAmount ?? 0)}</dd></div>
      </dl>
      <p className="mt-1 text-[10px] leading-4 text-white/40">In-progress refunds temporarily reduce the cap; failed refunds restore it. Security is separate, and Stripe checks the actual card balance.</p>
      <RentalDeliveryQuotePanel token={token} booking={b} />
      <RentalReviewRequest key={`review-request:${token}:${bookingId}`} token={token} bookingId={bookingId} />
      {["confirmed", "active", "returned"].includes(b.status) && <RentalCasePanel key={`rental-case:${token}:${bookingId}`} token={token} bookingId={bookingId} />}
      <p className="mb-2 text-[10px] uppercase tracking-[.16em] text-white/35">Rental actions</p>
      {cancellation && cancellation.status !== "succeeded" && <div role="status" className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-100">
        <p>{cancellation.status === "attention" ? "Cancellation needs payment review. The existing refund was not completed." : b.status === "pending_verification" ? "Refund settlement is processing. This booking remains unconfirmed until the provider settlement is complete." : "Cancellation settlement is processing. The rental remains reserved until refunds and security release are confirmed."}</p>
        {cancellation.refunds.map((r, i) => <p key={i} className="mt-2">{formatGbp(r.amount)} · {r.status.replaceAll("_", " ")}{r.approvalUrl && r.status === "awaiting_approval" && <a className="ml-2 underline" href={r.approvalUrl} target="_blank" rel="noopener noreferrer">Review in Stripe</a>}</p>)}
      </div>}
      {compactControls ? <div data-testid="compact-rental-action-groups" className="mb-3 grid gap-2" aria-label="Rental controls">
        {hasChangeActions && <details data-testid="rental-action-group-change" className="group rounded-xl border border-white/10 bg-white/[.025]"><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-white/80 [&::-webkit-details-marker]:hidden"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-accent-200" aria-hidden="true">↗</span><span className="min-w-0 flex-1">Items & dates</span><span className="text-white/35 transition-transform group-open:rotate-45" aria-hidden="true">＋</span></summary><div className="grid gap-2 border-t border-white/[.07] p-2.5">{changeButtons}</div></details>}
        {hasHandoverActions && <details data-testid="rental-action-group-handover" className="group rounded-xl border border-white/10 bg-white/[.025]"><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-white/80 [&::-webkit-details-marker]:hidden"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-emerald-200" aria-hidden="true">↔</span><span className="min-w-0 flex-1">Pickup & return</span><span className="text-white/35 transition-transform group-open:rotate-45" aria-hidden="true">＋</span></summary><div className="grid gap-2 border-t border-white/[.07] p-2.5">{handoverButtons}</div></details>}
        {hasPaymentActions && <details data-testid="rental-action-group-payment" className="group rounded-xl border border-white/10 bg-white/[.025]"><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-white/80 [&::-webkit-details-marker]:hidden"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-amber-200" aria-hidden="true">£</span><span className="min-w-0 flex-1">{b.status === "active" ? "Payments" : "Cancel & refund"}</span><span className="text-white/35 transition-transform group-open:rotate-45" aria-hidden="true">＋</span></summary><div className="grid gap-2 border-t border-white/[.07] p-2.5">{paymentButtons}</div></details>}
      </div> : <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Owner rental controls">{handoverButtons}{changeButtons}{paymentButtons}</div>}
      {showReturn && returnOpen && <ReturnRentalForm booking={b} token={token} onClose={() => setReturnOpen(false)} />}
      {showReturn && !returnOpen && b.status === "returned" && !!b.returnDecision && hasCashDepositPolicy(b.securityPolicyVersion) && <DepositRefundStatus token={token} bookingId={bookingId} />}
      <ReturnInspectionHistory token={token} bookingId={bookingId} />
      <RentalManagerDelivery token={token} bookingId={bookingId} />
      {showPriceTools && <details id="rental-price-adjustment" data-testid="rental-price-adjustment-tools" className="mt-3 rounded-xl border border-white/10 bg-white/[.025] p-3"><summary className="cursor-pointer text-xs font-medium text-white/75">Add or reduce a rental amount</summary><p className="mt-2 text-[11px] leading-4 text-white/45">Extra charges go through the existing price proposal. The renter must accept and pay before the rental total changes.</p><RentalPricePanel token={token} bookingId={bookingId} admin /></details>}
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
            data-testid="rental-addition-recovery"
            className="mt-3 rounded-xl bg-white/[0.035] p-3 text-xs text-white/60"
          >
            <p>
              {r.qty}× {rentalTitle(r.title)} · £
              {(r.lineTotal + r.securityCharge).toFixed(2)} ·{" "}
              {r.status.replaceAll("_", " ")}
            </p>
            <div className="mt-2 flex gap-3">
              {r.recoveryNeedsReview ? <button disabled={busy} onClick={() => void recoverAddition(r._id)} className="rounded-full border border-amber-200/30 px-3 py-1.5 text-amber-100 disabled:opacity-40">Check Stripe</button> : !r.paymentUrl && (
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
              {!r.recoveryNeedsReview && <button
                disabled={busy}
                onClick={() => withdrawAddition(r._id)}
                className="text-rose-300"
              >
                Withdraw proposal
              </button>}
            </div>
            {r.recoveryNeedsReview && <p role="status" className="mt-2 text-amber-100">Payment needs checking. The rental and credit remain protected.</p>}
            {!r.recoveryNeedsReview && <p className="mt-2 text-white/35">
              Finish or withdraw this proposal before a refund, return,
              reschedule or cancellation.
            </p>}
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
          {processingApprovalUrl && <a aria-label="Review rental refund in Stripe" className="font-semibold underline" href={processingApprovalUrl} target="_blank" rel="noopener noreferrer">Review in Stripe</a>}
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
                  : mode === "pickup-time"
                    ? "Change pickup time"
                  : mode === "return-time"
                    ? "Change return time"
                  : mode === "add"
                    ? "Add another item"
                    : "Refund rental charge"}
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
              ? cancellationAdminHint(b)
              : mode === "add"
                ? "Keeps the current kit. We check stock and show the full price before sending a payment link in chat."
                : mode === "reschedule"
                  ? "Move the rental or set a new return date. Agreed charges and security stay the same: extra days are complimentary. Any eligible refund uses the separate refund control. Stock is checked before saving."
                  : mode === "pickup-time" || mode === "return-time"
                    ? "Choose all items or select the affected items. Other items keep their times. We recheck availability before saving and notify the renter in chat and by email. Times are London local time."
                  : "Choose an item or the rental total. Security is separate."}
          </p>
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
                {catalog.results
                  .filter((l) => !l.displayOnly)
                  .map((l) => (
                    <button
                      type="button"
                      key={l._id}
                      onClick={() => setListingId(l._id)}
                      title={l.title}
                      className={`flex items-center gap-2 rounded-xl border p-2 text-left ${listingId === l._id ? "border-accent-400/60" : "border-white/10"}`}
                    >
                      <SmartImage fit="contain"
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
              {catalog.status === "CanLoadMore" && <button type="button" onClick={() => catalog.loadMore(40)} className="mt-2 text-xs text-white/70 underline">Load more items</button>}
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
                data-testid="rental-reschedule-start"
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
          {(mode === "pickup-time" || mode === "return-time") && <div className="mt-3 grid gap-3"><fieldset className="grid gap-2"><legend className="text-xs text-white/55">Items affected</legend><label className="mt-2 flex items-center gap-2 text-xs text-white/80"><input type="checkbox" checked={handoverLines.length === b.lineItems.length} onChange={event=>{setHandoverLines(event.target.checked?b.lineItems.map((_,index)=>index):[]);request.current=null;}}/>All items</label>{b.lineItems.map((line,index)=><label key={index} className="flex items-center gap-2 rounded-xl border border-white/10 p-3 text-xs text-white/70"><input type="checkbox" checked={handoverLines.includes(index)} onChange={event=>{setHandoverLines(current=>event.target.checked?[...current,index]:current.filter(value=>value!==index));request.current=null;}}/>{line.qty}× {rentalTitle(line.title)} · {mode === "pickup-time" ? line.pickupTime ?? "pickup time not set" : line.returnTime ?? "return time not set"}</label>)}</fieldset><label className="text-xs text-white/55">New {mode === "pickup-time" ? "pickup" : "return"} time<select data-testid="rental-handover-time" aria-label={`New ${mode === "pickup-time" ? "pickup" : "return"} time`} required value={handoverTime} onChange={event=>{setHandoverTime(event.target.value);request.current=null;}} className="mt-1 block w-full rounded-xl border border-white/10 bg-[#151515] p-3 text-white"><option value="">Choose a time</option>{RENTAL_TIME_SLOTS.map(time=><option key={time} value={time}>{time}</option>)}</select></label></div>}
          {mode === "reschedule" && endDate && <label className="mt-3 flex items-start gap-2 text-xs text-white/60"><input type="checkbox" required checked={keepAgreedPrice} onChange={e => setKeepAgreedPrice(e.target.checked)} className="mt-0.5" />Keep the agreed rental charge for these dates. I approve any extra days as complimentary; any eligible refund is handled separately.</label>}
          {mode === "refund" && (
            <>
            <div className="mt-3 rounded-xl border border-white/10 bg-black/15 p-3" data-testid="refund-summary-card">
              <div className="flex justify-between gap-3 text-xs"><span className="text-white/55">Rental amount</span><strong>{formatGbp(refundSummary.rentalAmountPence / 100)}</strong></div>
              <div className="mt-2 flex justify-between gap-3 text-xs"><span className="text-white/55">Confirmed refunds</span><strong>{formatGbp(refundSummary.confirmedRefundedPence / 100)}</strong></div>
              {refundSummary.pendingRefundPence > 0 && <div className="mt-2 flex justify-between gap-3 text-xs text-amber-100"><span>In progress</span><strong>{formatGbp(refundSummary.pendingRefundPence / 100)}</strong></div>}
              <div className="mt-2 flex justify-between gap-3 border-t border-white/10 pt-2 text-xs"><span className="text-white/65">Available</span><strong className="text-emerald-100">{formatGbp(refundSummary.remainingRefundCapPence / 100)}</strong></div>
              <p className="mt-2 text-[10px] leading-4 text-white/40">Stripe checks the payment. Security is separate.</p>
            </div>
            <label className="mt-3 block text-xs text-white/55">Refund scope
              <select data-testid="refund-item-choice" value={refundLineIndex} disabled={busy || !!processing} onChange={event=>{const value=event.target.value;setRefundLineIndex(value);request.current=null;setAmount(value===""?"":((refundItemOptions[Number(value)]?.maxPence??0)/100).toFixed(2));}} className="mt-1 w-full rounded-xl border border-white/10 bg-[#151515] p-3 text-white">
                <option value="">Entire rental</option>
                {refundItemOptions.map(({line,index,selectable,sourceUncertain})=><option key={`${line.listingId}-${index}`} value={index} disabled={!selectable}>{line.qty}× {rentalTitle(line.title)}{selectable?"":sourceUncertain?" · payment needs review":hasUnitemizedConfirmedRefund?" · refund needs review":" · no card payment"}</option>)}
              </select>
            </label>
            {hasUnitemizedConfirmedRefund && <p role="status" className="mt-2 rounded-lg border border-amber-200/15 bg-amber-100/[.04] p-2 text-[11px] leading-4 text-amber-100/80">An earlier refund has no item record. Review the refund history before targeting an individual item; the overall refund option remains available.</p>}
            {refundItemOptions.some(item=>item.sourceUncertain) && <p role="status" className="mt-2 rounded-lg border border-amber-200/15 bg-amber-100/[.04] p-2 text-[11px] leading-4 text-amber-100/80">Some item payment sources need review. You can use a rental-total refund.</p>}
            {selectedRefundLine && <p className="mt-2 text-[11px] leading-4 text-sky-100/70">Item card payment: up to {formatGbp(selectedRefundLine.maxPence/100)}. Delivery and security are separate.</p>}
            <label className="mt-3 block text-xs text-white/55">
              Amount (£)
              <input
                type="number"
                min="0.01"
                max={selectedRefundLine?selectedRefundLine.maxPence/100:undefined}
                required={!!selectedRefundLine}
                step="0.01"
                placeholder={selectedRefundLine ? `Up to ${formatGbp(selectedRefundLine.maxPence/100)}` : "Blank = full amount"}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  request.current = null;
                }}
                className="mt-1 w-full rounded-xl bg-[#151515] p-3 text-white"
              />
            </label>
            </>
          )}
          <label className="mt-3 block text-xs text-white/55">
            {mode==="cancel"?"Note (optional)":mode==="refund"?"Reason (sent to renter)":"Reason · shared with the customer"}
            <textarea
              data-testid="rental-operation-reason"
              aria-label={mode === "cancel" ? "Cancellation note" : "Reason shared with renter"}
              required={mode!=="cancel"}
              minLength={mode==="cancel"?undefined:5}
              maxLength={mode === "refund" && selectedRefundLine ? Math.max(5,400-rentalTitle(selectedRefundLine.line.title).length-3) : 400}
              value={reason}
              onChange={(e) => {setReason(e.target.value);if(mode === "pickup-time" || mode === "return-time") request.current=null;}}
              className="mt-1 w-full rounded-xl bg-[#151515] p-3 text-sm text-white"
            />
          </label>
          <button
            disabled={busy || (mode === "add" && !listingId) || ((mode === "pickup-time" || mode === "return-time") && !handoverLines.length)}
            className={`mt-3 rounded-full px-4 py-2 text-xs font-semibold text-white ${mode === "cancel" ? "bg-rose-600" : "bg-accent-500"}`}
          >
            {busy
              ? "Processing…"
              : mode === "cancel"
                ? "Confirm cancellation"
                : mode === "reschedule"
                  ? "Save new dates"
                  : mode === "pickup-time"
                    ? "Save pickup time"
                  : mode === "return-time"
                    ? "Save return time"
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
        <div role="status" className={`mt-3 flex flex-wrap items-center gap-3 text-xs ${result.includes("Review Stripe") ? "text-amber-100" : "text-emerald-300"}`}>
          <span>{result}</span>
          {refundApproval && <a aria-label="Review rental refund in Stripe" className="font-semibold underline" href={safeStripeApprovalUrl(refundApproval.url)} target="_blank" rel="noopener noreferrer">Review in Stripe</a>}
        </div>
      )}
      {showSavedCardTools && <SavedCardCharges token={token} bookingId={bookingId} admin />}
    </div>
  );
}
