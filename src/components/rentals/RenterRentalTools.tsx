"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { createPortal } from "react-dom";
import { SmartImage } from "@/components/SmartImage";
import { rentalTitle } from "@/lib/rentalPresentation";
import { rentalRequestDetail } from "@/lib/rentalRequestDraft";
import { RentalRequestCalendar } from "./RentalRequestCalendar";
import styles from "./RentalRequestApply.module.css";
import customerStyles from "./RenterRentalTools.module.css";
import { RentalRequestHistory } from "./RentalRequestHistory";

export function RenterRentalTools({ token, bookingId, consolidatedExtensions = false }: { token: string; bookingId: string; consolidatedExtensions?: boolean }) {
  return <RentalTools key={JSON.stringify([token, bookingId])} token={token} bookingId={bookingId} consolidatedExtensions={consolidatedExtensions} />;
}

function RentalTools({ token, bookingId, consolidatedExtensions = false }: { token: string; bookingId: string; consolidatedExtensions?: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { const timer = setInterval(() => setRefreshKey(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const receivedContext = useQuery(api.rentalRequests.context, { token, bookingId: bookingId as any, refreshKey });
  // A clock refresh can briefly return undefined. Keep this rental's last
  // projection while loading; an explicit auth failure clears it immediately.
  // The keyed wrapper above prevents reuse across accounts or rentals.
  const lastContext = useRef<typeof receivedContext>(undefined);
  if (receivedContext !== undefined) lastContext.current = receivedContext;
  const context = lastContext.current;
  useEffect(() => {
    const start = context?.rentalStartsAt;
    if (start == null || start <= Date.now()) return;
    const timer = setTimeout(() => setRefreshKey(Date.now()), Math.min(start - Date.now() + 1, 2147483647));
    return () => clearTimeout(timer);
  }, [context?.rentalStartsAt, refreshKey]);
  const cancellation = useQuery(api.cancellationRecovery.renterStatus, { token, bookingId: bookingId as any });
  const request = useMutation(api.rentalRequests.submit);
  const cancel = useAction(api.checkout.cancelByCustomer);
  const cancelUnpaid = useAction(api.checkout.cancelUnpaidByCustomer);
  const [mode, setMode] = useState<"dates" | "items" | "cancel" | null>(null);
  const [detail, setDetail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const requestId = useRef<string | null>(null);
  const [start, setStart] = useState(""), [end, setEnd] = useState(""), [pickup, setPickup] = useState(""), [dropoff, setDropoff] = useState("");
  const [change, setChange] = useState<"add" | "swap" | "remove">("add"), [itemIndex, setItemIndex] = useState(0), [addition, setAddition] = useState(""), [qty, setQty] = useState(1);
  const [dateSource,setDateSource]=useState<{listingId:string;qty:number;start:number;end:number;pickupTime:string|null;returnTime:string|null}[]>([]);
  const [source, setSource] = useState<{ listingId: string; title: string; qty: number; start: number; end: number } | null>(null);
  const [search, setSearch] = useState(""), [searchTerm, setSearchTerm] = useState(""), [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<{ id: string; title: string; heroImage: string | null; imageSources: string[] } | null>(null);
  useEffect(() => { const timer = setTimeout(() => setSearchTerm(search), 250); return () => clearTimeout(timer); }, [search]);
  const equipment = useQuery(api.rentalRequests.equipment, mode === "items" && change !== "remove" && !manual ? { token, bookingId: bookingId as any, search: searchTerm } : "skip");
  const dialog = useRef<HTMLDialogElement>(null), launcher = useRef<HTMLButtonElement | null>(null), inFlight = useRef(false), titleId = useId();
  useEffect(() => {
    if (!mode) return;
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); launcher.current?.focus(); };
  }, [mode, !!context]);
  useEffect(() => { requestId.current = null; }, [detail, start, end, pickup, dropoff, change, itemIndex, addition, qty, selected, manual, source,dateSource]);
  if (!context) return null;
  if (!["pending_payment", "confirmed", "active"].includes(context.status)) return <RentalRequestHistory token={token} bookingId={bookingId} consolidatedExtensions={consolidatedExtensions} />;
  const rentalStartedNow = () => context.rentalStarted || context.rentalStartsAt == null || Date.now() >= context.rentalStartsAt;
  const started = rentalStartedNow();
  const canCancel = !started && context.direct && (context.status === "pending_payment" || context.selfService);
  function open(next: typeof mode, button: HTMLButtonElement) { launcher.current = button; setDateSource(context!.lineItems.map(li=>({listingId:li.listingId,qty:li.qty,start:li.start,end:li.end,pickupTime:li.pickupTime,returnTime:li.returnTime}))); setStart(""); setEnd(""); setPickup(context?.lineItems.find(li=>li.start===context.start)?.pickupTime ?? ""); setDropoff(context?.lineItems.find(li=>li.end===context.end)?.returnTime ?? ""); setChange("add"); setItemIndex(0); setSource(context?.lineItems[0] ?? null); setAddition(""); setSelected(null); setSearch(""); setSearchTerm(""); setManual(false); setQty(1); setMode(next); setDetail(""); setConsent(false); setError(""); setResult(""); requestId.current = null; }
  async function submit() {
    if (inFlight.current || !mode || context!.locked) return;
    // A background tab's pickup timer can run after the customer's next click.
    // Recheck now before dispatching either cancellation action or request.
    if (mode === "cancel" && rentalStartedNow()) { setError("This rental has started. Please contact the team in this conversation."); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (mode === "cancel" && canCancel) {
        if (!consent) throw Error("Please confirm that you have read the cancellation terms.");
        if (context!.status === "pending_payment") await cancelUnpaid({ token, bookingId: bookingId as any });
        else await cancel({ token, bookingId: bookingId as any });
        setResult("Rental cancelled. The settlement details are saved in this conversation.");
      } else {
        requestId.current ??= crypto.randomUUID();
        await request({ token, bookingId: bookingId as any, requestId: requestId.current, kind: mode, detail: rentalRequestDetail({ kind: mode, note: detail, start, end, pickup, dropoff, change, item: source?.title, currentQty: source?.qty, addition: manual ? addition : selected?.title, qty }),
          dates:mode==="dates"?{start:Date.parse(start+"T00:00:00Z"),end:Date.parse(end+"T00:00:00Z"),pickupTime:pickup,returnTime:dropoff,note:detail,source:dateSource.map(line=>({...line,listingId:line.listingId as any}))}:undefined,
          kit: mode === "items" && (change === "remove" || !manual) ? { change, listingId: change === "remove" ? undefined : selected?.id as any, lineIndex: change === "add" ? undefined : itemIndex, source: change === "add" || !source ? undefined : { listingId: source.listingId as any, qty: source.qty, start: source.start, end: source.end }, quantity: qty, note: detail } : undefined });
        setResult("Request sent to the team in this conversation. Your rental stays unchanged until the team confirms it.");
      }
      setMode(null);
    } catch (e: any) { setError(e.data?.message ?? e.message ?? "Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const hero = context.lineItems[0];
  const day = (at: number | null) => at === null ? "To confirm" : new Date(at).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  const selectedDay = (value: string) => value ? day(Date.parse(value + "T00:00:00Z")) : "Choose dates";
  return <div className="mt-3" data-testid="renter-rental-tools">
    <RentalRequestHistory token={token} bookingId={bookingId} consolidatedExtensions={consolidatedExtensions} />
    {cancellation && cancellation.status !== "succeeded" && <p role="status" className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-100">{cancellation.status === "attention" ? "The team is reviewing your cancellation settlement. Please message us if you need help." : "Your cancellation is processing. We will confirm once the refund and security release are complete."}</p>}
    <div className="flex flex-wrap gap-2" aria-label="Rental requests">
      {(context.status === "active" ? [["items", "Request kit change"]] : [["dates", "Request dates"], ["items", "Request kit change"], ["cancel", "Cancel rental"]]).filter(([kind]) => kind !== "cancel" || !started).map(([kind, label]) => <button key={kind} disabled={busy || context.locked} onClick={e => open(kind as typeof mode, e.currentTarget)} className={`rounded-full border px-3 py-2 text-xs ${mode === kind ? "border-accent-400/50 bg-accent-500/10 text-white" : "border-white/10 text-white/60 hover:text-white"} disabled:opacity-35`}>{label}</button>)}
    </div>
    {mode && createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) setMode(null); }}>
      <form onSubmit={e => { e.preventDefault(); void submit(); }} className={`${styles.panel} ${customerStyles.panel}`} data-testid="renter-request-drawer">
        <header className={styles.header}><div><span className={styles.brand}>DB <span>CINEMA</span><small>RENTALS</small></span><h2 id={titleId}>{mode === "dates" ? "Request new dates" : mode === "items" ? "Request a kit change" : "Cancel your rental"}</h2><p className={customerStyles.subtitle}>{mode === "dates" ? "Choose your preferred dates and we’ll check availability." : mode === "items" ? "Tell us what equipment you need." : "Review your agreed cancellation terms."}</p></div><button type="button" className={styles.close} aria-label="Close request panel" disabled={busy} onClick={() => setMode(null)}>×</button></header>
        {hero && <section className={styles.hero}><SmartImage src={hero.heroImage} fallbackSources={hero.imageSources} alt={hero.title} className={styles.photo}/><div><span className={styles.eyebrow}>Your rental equipment</span><h3>{rentalTitle(hero.title)}</h3><p>{context.lineItems.reduce((n, li) => n + li.qty, 0)} item{context.lineItems.reduce((n, li) => n + li.qty, 0) === 1 ? "" : "s"} · {mode === "cancel" ? "Review cancellation" : "Team confirmation required"}</p></div></section>}
        {mode === "dates" && <>
          <section className={styles.periods}><div><span>Current rental period</span><strong>{day(context.start)} – {day(context.end)}</strong><small>Original agreed dates</small></div><span className={styles.arrow}>→</span><div className={styles.agreed}><span>Proposed dates</span><strong>{selectedDay(start)}{end ? ` – ${selectedDay(end)}` : ""}</strong><small>Awaiting team review</small></div></section>
          <section className={styles.section}><h3>Select new rental dates</h3><div className={styles.calendarLayout}><RentalRequestCalendar request initial={context.start ?? Date.now()} start={start} end={end} onStart={setStart} onEnd={setEnd} disabled={busy}/><div className={styles.inputs}>
            <label>Collection date<input required type="date" value={start} disabled={busy} onChange={e => setStart(e.target.value)}/></label><label>Return date<input required type="date" min={start || undefined} value={end} disabled={busy} onChange={e => setEnd(e.target.value)}/></label>
            <label>Collection · London time<input required type="time" min="09:00" max="22:00" value={pickup} disabled={busy} onChange={e => setPickup(e.target.value)}/></label><label>Return · London time<input required type="time" min="09:00" max="22:00" value={dropoff} disabled={busy} onChange={e => setDropoff(e.target.value)}/></label></div></div></section>
        </>}
        {mode === "items" && <>
          <section className={styles.section}><h3>Current kit ({context.lineItems.length} item{context.lineItems.length === 1 ? "" : "s"})</h3><div className={customerStyles.kit}>{context.lineItems.map((li, index) => <button type="button" disabled={busy} aria-pressed={itemIndex === index} key={index} className={customerStyles.tile} onClick={() => { setItemIndex(index); setSource(li); setQty(1); }}><SmartImage src={li.heroImage} fallbackSources={li.imageSources} alt={li.title} className={customerStyles.thumbnail}/><span><strong>{rentalTitle(li.title)}</strong><small>× {li.qty} · {day(li.start)} – {day(li.end)}</small></span></button>)}</div></section>
          <div className={customerStyles.tabs} aria-label="Type of kit request">{(["add", "swap", "remove"] as const).map(value => <button type="button" key={value} disabled={busy} aria-pressed={change === value} onClick={() => { setChange(value); setSelected(null); setQty(1); }}>{value === "add" ? "+ Add" : value === "swap" ? "⇄ Swap" : "− Remove"}</button>)}</div>
          <section className={styles.section}><h3>Request summary</h3>{change !== "add" && <p className={customerStyles.selection}>{change === "remove" ? "Remove from" : "Replace in"} your kit: <strong>{source?.title ?? "Select a current item"}</strong></p>}
            {change !== "remove" && <>
              <div className={customerStyles.searchHeading}><span>Choose equipment{change === "swap" ? " to swap in" : " to add"}</span><button type="button" disabled={busy} className={customerStyles.textButton} onClick={() => { setManual(value => !value); setSelected(null); setAddition(""); }}>{manual ? "Browse catalogue" : "Can’t find your item?"}</button></div>
              {manual ? <label>Describe the equipment you need<input required maxLength={200} disabled={busy} value={addition} onChange={e => setAddition(e.target.value)} placeholder="Equipment name or model"/></label> : <>
                <label className={customerStyles.search}>Search the catalogue<input aria-label="Search equipment" type="search" maxLength={100} disabled={busy} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cameras, lenses or lighting…"/></label>
                <div className={customerStyles.results} aria-label="Catalogue equipment" aria-busy={equipment === undefined}>{equipment === undefined ? <p role="status" className={styles.note}>Finding equipment…</p> : equipment.length === 0 ? <p role="status" className={styles.note}>No matching requestable equipment. Try another model or describe what you need.</p> : equipment.map(item => <button type="button" key={item.id} disabled={busy} className={customerStyles.result} aria-pressed={selected?.id === item.id} onClick={() => setSelected(item)}><span aria-hidden="true" className={customerStyles.radio}>{selected?.id === item.id ? "●" : "○"}</span><SmartImage src={item.heroImage} fallbackSources={item.imageSources} alt={item.title} className={customerStyles.thumbnail}/><span><strong>{rentalTitle(item.title)}</strong><small>{item.category}</small><small>Availability checked by the team</small></span></button>)}</div>
                {selected && <div className={customerStyles.chosen}><SmartImage src={selected.heroImage} fallbackSources={selected.imageSources} alt={selected.title} className={customerStyles.thumbnail}/><span><small>Selected equipment</small><strong>{rentalTitle(selected.title)}</strong></span><button type="button" disabled={busy} aria-label="Clear selected equipment" onClick={() => setSelected(null)}>×</button></div>}
              </>}
            </>}
            <label className={customerStyles.quantity}>Quantity<input type="number" required min={1} max={change === "add" ? 99 : source?.qty ?? 1} disabled={busy} value={qty} onChange={e => setQty(Number(e.target.value))}/></label><p className={styles.note}>Availability and any price change will be checked by the team.</p></section>
        </>}
        {mode === "cancel" ? <>
          <ol className={styles.steps}><li data-active="true"><span>1</span><strong>Review</strong><small>Agreed terms</small></li><li><span>2</span><strong>Processing</strong><small>Team & payment provider</small></li><li><span>3</span><strong>Completed</strong><small>Receipt and confirmation</small></li></ol>
          <section className={styles.section}><h3>Cancellation policy</h3><p className={customerStyles.policy}>{context.status === "pending_payment" ? "This is an unpaid checkout. Cancelling abandons checkout and releases its reservations. Any payment already captured is checked before settlement." : context.cancellationKind === "full_refund" ? `At least ${context.cancellationFullRefundDays} London calendar days before the earliest rental start: remaining captured rental payment, including refundable security, returns to the original payment method. Used account credit is restored.` : `Fewer than ${context.cancellationFullRefundDays} London calendar days before the earliest rental start: 0% rental cash refund. Remaining rental value becomes account credit valid for 365 days. Refundable security is settled separately. Your statutory rights are unaffected.`}</p>
            <a className={customerStyles.policyLink} href={`/legal/cancellation?version=${encodeURIComponent(context.cancellationTermsVersion)}`} target="_blank" rel="noopener noreferrer">Read your full cancellation terms ↗</a></section>
          <div className={styles.info}><span>◷</span><div><strong>Card holds are released separately</strong><p>A hold release is not a cash refund. Already refunded amounts cannot be refunded again.</p></div></div>
          {!canCancel && <p className={styles.note}>The team will process your request. Your rental stays booked until cancellation is confirmed; eligibility is checked when processed.</p>}
          {canCancel && <label className={styles.check}><input required type="checkbox" disabled={busy} checked={consent} onChange={e => setConsent(e.target.checked)}/>I have read the agreed cancellation terms and want to cancel this rental.</label>}
        </> : <ol className={styles.steps}><li data-active="true"><span>1</span><strong>Your request</strong><small>Choose your change</small></li><li><span>2</span><strong>Team review</strong><small>Stock, dates & quote</small></li><li><span>3</span><strong>Confirmed</strong><small>After agreement</small></li></ol>}
        {!(mode === "cancel" && canCancel) && <label className={styles.reason}>{mode === "cancel" ? "Reason for cancellation" : "Add a note for the team"} · required<textarea required minLength={5} maxLength={600} disabled={busy} value={detail} onChange={e => setDetail(e.target.value)} placeholder="Let us know what you need and any details about your shoot."/><small>{detail.length}/600</small></label>}
        {mode === "cancel" && started && <p role="status" className={styles.note}>This rental has started. Refunds can only be arranged by the team in this conversation.</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <footer className={styles.actions}><button className={styles.primary} disabled={busy || context.locked || (mode === "cancel" && (started || (canCancel && !consent)))}>{busy ? "Processing…" : mode === "cancel" && canCancel ? "Confirm cancellation" : mode === "dates" ? "Send date request" : mode === "items" ? "Send kit request" : "Send cancellation request"}</button><button type="button" className={styles.launch} disabled={busy} onClick={() => setMode(null)}>Back</button></footer>
        <p className={styles.note}>{mode === "cancel" ? "Completion is confirmed after refunds and authorisation releases settle." : "Your current booking stays unchanged until the team confirms your request."}</p>
      </form>
    </dialog>, document.body)}
    {!mode && error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    {result && <p role="status" className="mt-2 text-xs text-emerald-300">{result}</p>}
  </div>;
}
