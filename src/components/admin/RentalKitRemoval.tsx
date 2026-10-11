"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SmartImage } from "@/components/SmartImage";
import { rentalTitle } from "@/lib/rentalPresentation";
import drawer from "@/components/rentals/RentalRequestApply.module.css";
import styles from "@/components/rentals/RentalAdditionApproval.module.css";

type Props = { token: string; bookingId: string; id: string; onClose: () => void };
type Source = { index: number; listingId: string; title: string; qty: number; start: number; end: number; heroImage: string | null; imageSources: string[] };
export function RentalKitRemoval(props: Props) { return <Removal key={JSON.stringify([props.token, props.bookingId, props.id])} {...props}/>; }
function Removal({ token, bookingId, id, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId(), initialized = useRef(false), inFlight = useRef(false), requestId = useRef<string | null>(null);
  const details = useQuery(api.rentalOperations.details, { token, bookingId: bookingId as any });
  const agreed = useQuery(api.rentalRequests.agreedKit, { token, bookingId: bookingId as any, id: id as any });
  const remove = useMutation(api.rentalOperations.removeItem);
  const [source, setSource] = useState<Source | null>(null), [quantity, setQuantity] = useState(1), [reason, setReason] = useState(""), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const fixed = agreed?.kitSelection?.change === "remove";
  useEffect(() => { const node = dialog.current, previous = document.activeElement as HTMLElement | null; if (node && !node.open) node.showModal(); return () => { if (node?.open) node.close(); if (previous?.isConnected) previous.focus(); }; }, []);
  useEffect(() => {
    if (initialized.current || !details || !agreed) return;
    initialized.current = true; setReason((agreed.decisionNote ?? "Apply the agreed equipment removal.").slice(0, 400));
    const selection = agreed.kitSelection;
    if (selection?.change === "remove" && selection.source && selection.lineIndex !== undefined) {
      setSource({ index: selection.lineIndex, listingId: selection.source.listingId, qty: selection.source.qty, start: selection.source.start, end: selection.source.end, title: selection.sourceTitle ?? agreed.sourceEquipment?.title ?? "Requested equipment", heroImage: agreed.sourceEquipment?.heroImage ?? null, imageSources: agreed.sourceEquipment?.imageSources ?? [] });
      setQuantity(selection.quantity);
    } else if (!selection && details.lineItems[0]) { setSource({ ...details.lineItems[0], index: 0 }); setQuantity(details.lineItems[0].qty); }
  }, [agreed, details]);
  const current = source ? details?.lineItems[source.index] : undefined;
  const stale = !!source && !!details && (!current || current.listingId !== source.listingId || current.qty !== source.qty || current.start !== source.start || current.end !== source.end);
  const remaining = source ? source.qty - quantity : 0;
  const eligible = agreed?.status === "approved" && !agreed.execution && (!agreed.kitSelection || fixed);
  const lastItem = details?.lineItems.length === 1 && remaining === 0;
  async function submit() {
    if (inFlight.current || !source || !eligible || stale || !consent) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      requestId.current ??= crypto.randomUUID();
      await remove({ token, bookingId: bookingId as any, changeRequestId: id as any, requestId: requestId.current, lineIndex: source.index, listingId: source.listingId as any, expectedQty: source.qty, expectedStart: source.start, expectedEnd: source.end, removeQty: quantity, keepAgreedCharges: true, reason });
      onClose();
    } catch (e: any) { setError(e.data?.message ?? e.message ?? "The removal could not be completed. Review its status and retry."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return createPortal(<dialog ref={dialog} className={drawer.dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><form className={drawer.panel} data-testid="admin-kit-removal" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <header className={drawer.header}><div><span className={drawer.brand}>DB <span>CINEMA</span><small>RENTALS</small></span><h2 id={titleId}>Remove agreed equipment</h2></div><button type="button" className={drawer.close} aria-label="Close equipment removal" disabled={busy} onClick={onClose}>×</button></header>
    {details === undefined || agreed === undefined ? <p role="status">Loading the agreed request…</p> : !details || !agreed ? <p role="alert" className={drawer.error}>This rental request is unavailable.</p> : <>
      {details.customer && <div className={drawer.customer}><span>{(details.customer.name ?? details.customer.email).slice(0, 2).toUpperCase()}</span><div><strong>{details.customer.name ?? "Rental customer"}</strong><a href={`mailto:${details.customer.email}`}>{details.customer.email}</a></div></div>}
      {!fixed && <section className={drawer.section}><h3>Choose the agreed equipment</h3><div className={styles.catalog}>{details.lineItems.map((item, index) => <button key={index} type="button" disabled={busy} aria-pressed={source?.index === index} onClick={() => { setSource({ ...item, index }); setQuantity(item.qty); requestId.current = null; setConsent(false); }}><SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className={styles.thumb}/><span>{item.qty}× {rentalTitle(item.title)}</span></button>)}</div></section>}
      {source && <>
        <section className={drawer.hero}><SmartImage src={source.heroImage} fallbackSources={source.imageSources} alt={source.title} className={drawer.photo}/><div><span className={drawer.eyebrow}>Approved equipment removal</span><h3>{rentalTitle(source.title)}</h3><p>{quantity} to remove · {remaining} remaining</p></div></section>
        <section className={drawer.periods}><div><span>Current quantity</span><strong>{source.qty}× {rentalTitle(source.title)}</strong></div><span className={drawer.arrow}>→</span><div className={drawer.agreed}><span>After removal</span><strong>{remaining}× {rentalTitle(source.title)}</strong><small>{remaining === 0 ? "Removed from this kit" : "Remaining equipment stays reserved"}</small></div></section>
        <label>Quantity to remove<input required type="number" min={1} max={source.qty} aria-label="Removal quantity" value={quantity} disabled={busy || fixed} onChange={e => { setQuantity(Number(e.target.value)); requestId.current = null; setConsent(false); }}/></label>
        <div className={drawer.info}><span>◇</span><div><strong>Stock is released after confirmation</strong><p>The remaining equipment keeps its original dates and collection/return times. No card refund or account credit is created by this operation.</p></div></div>
        <label className={drawer.check}><input required type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)}/>Keep agreed charges and security unchanged. Record any eligible rental refund separately through the refund controls.</label>
        <label className={drawer.reason}>Removal reason · required<textarea required minLength={5} maxLength={400} disabled={busy} value={reason} onChange={e => { setReason(e.target.value); requestId.current = null; }}/></label>
      </>}
      {stale && <p role="alert" className={drawer.error}>The kit changed since this request. Review it with the customer and approve a new request before removing equipment.</p>}
      {lastItem && <p className={drawer.note}>Use Cancel rental to remove the final item under the agreed cancellation terms.</p>}
      {!eligible && <p role="status" className={drawer.note}>This request is no longer an approved equipment removal awaiting execution.</p>}
    </>}
    {error && <p role="alert" className={drawer.error}>{error}</p>}
    <footer className={drawer.actions}><button className={drawer.primary} disabled={busy || !source || !eligible || stale || lastItem || !consent || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > source.qty}>{busy ? "Updating kit…" : "Confirm equipment removal"}</button><button type="button" className={drawer.launch} disabled={busy} onClick={onClose}>Back</button></footer>
  </form></dialog>, document.body);
}
