"use client";
import { SmartImage } from "@/components/SmartImage";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { fmtDateYear } from "@/lib/bookingDisplay";
import styles from "./InvoiceLibrary.module.css";

type Rental = { _id: string; at: number; status: string; total: number; guestEmail?: string; guestName?: string; hasPayment?: boolean; hasReturnStatement?: boolean;returnStatementIssuedAt?:number; lineItems: { title: string; start?: number; end?: number }[] };
function compactDate(at:number){return new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"Europe/London"}).format(at);}
function rentalPeriod(lines:Rental["lineItems"]){
  const periods=[...new Set(lines.filter(l=>Number.isFinite(l.start)&&Number.isFinite(l.end)).map(l=>JSON.stringify([l.start,l.end])))];
  if(!periods.length)return "Dates not recorded";
  if(periods.length>1)return `${periods.length} rental periods`;
  const [start,end]=JSON.parse(periods[0]);if(start===end)return compactDate(start);
  const month=new Intl.DateTimeFormat("en-GB",{month:"numeric",year:"numeric",timeZone:"Europe/London"});
  const first=new Intl.DateTimeFormat("en-GB",{day:"numeric",...(month.format(start)===month.format(end)?{}:{month:"short" as const}),timeZone:"Europe/London"}).format(start);
  return `${first}–${compactDate(end)}`;
}
export function InvoiceLibrary({ rentals, token, admin = false, hasMore=false, loadingMore=false, onLoadMore }: { rentals: Rental[] | undefined; token: string; admin?: boolean; hasMore?: boolean; loadingMore?: boolean; onLoadMore?:()=>void }) {
  const [search, setSearch] = useState(""), [filter, setFilter] = useState("all"), [dateRange,setDateRange]=useState("all");
  const [chosen,setChosen]=useState<{key:string;epoch:number}|null>(null);
  const scope=useRef({token,epoch:0});
  const [preview, setPreview] = useState<{ url: string; name: string; epoch:number } | null>(null), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const detailPanel=useRef<HTMLElement>(null),selectedButton=useRef<HTMLButtonElement|null>(null);
  const focusAfterClose=useRef<number|null>(null);
  const dialog = useRef<HTMLDialogElement>(null), activeUrl = useRef<string | null>(null), request = useRef(0), controller=useRef<AbortController|null>(null);
  if(scope.current.token!==token){scope.current={token,epoch:scope.current.epoch+1};request.current++;}
  const selected=chosen?.epoch===scope.current.epoch?chosen.key:null,activePreview=preview?.epoch===scope.current.epoch?preview:null;
  useEffect(() => { request.current++; setPreview(null); setChosen(null); setBusy(null); setError(""); if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); activeUrl.current = null; return () => { request.current++; controller.current?.abort(); if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); }; }, [token]);
  useEffect(() => { if (activePreview && !dialog.current?.open) dialog.current?.showModal(); else if(!activePreview)dialog.current?.close(); }, [activePreview]);
  const documents = (rentals ?? []).flatMap(r => {
    const paid = r.hasPayment ?? ["confirmed", "active", "returned"].includes(r.status);
    return [...(paid ? [{ rental: r, phase: "receipt", label: "Rental receipt" }] : []), ...(r.hasReturnStatement ? [{ rental: r, phase: "return", label: "Return settlement" }] : [])];
  });
  const visible = documents.filter(d => (dateRange === "all" || (d.phase === "return" ? d.rental.returnStatementIssuedAt : d.rental.at) != null && (d.phase === "return" ? d.rental.returnStatementIssuedAt! : d.rental.at) >= Date.now()-Number(dateRange)*86400000) && (filter === "all" || filter === d.phase) && `${d.rental._id} ${d.rental.guestName ?? ""} ${d.rental.guestEmail ?? ""} ${d.rental.lineItems.map(i => i.title).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selection = visible.find(d => `${d.rental._id}-${d.phase}` === selected);
  const detail = useQuery(api.bookings.invoiceData, selection ? { token, bookingId: selection.rental._id as any } : "skip");
  useEffect(()=>{if(selected && window.matchMedia("(max-width:1200px)").matches){const frame=requestAnimationFrame(()=>detailPanel.current?.scrollIntoView({block:"start",behavior:"instant"}));return()=>cancelAnimationFrame(frame);}},[selected,detail !== undefined]);
  useEffect(()=>{
    if(selected !== null || focusAfterClose.current === null) return;
    const epoch=focusAfterClose.current;focusAfterClose.current=null;
    if(epoch===scope.current.epoch && selectedButton.current?.isConnected){
      selectedButton.current.focus({preventScroll:true});
      selectedButton.current.scrollIntoView({block:"center",behavior:"instant"});
    }
  },[selected,token]);
  function closeDetails(){close();focusAfterClose.current=scope.current.epoch;setChosen(null);}
  function close() { request.current++;controller.current?.abort();controller.current=null;setBusy(null);setError("");dialog.current?.close(); setPreview(null); if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); activeUrl.current = null; }
  async function open(rental: Rental, phase: string) {
    controller.current?.abort();const abort=new AbortController();controller.current=abort;
    const epoch=scope.current.epoch,attempt = ++request.current, key = `${rental._id}-${phase}`;
    setBusy(key); setError("");
    try {
      const response = await fetch(`/api/invoice/${encodeURIComponent(rental._id)}${phase === "return" ? "?phase=return" : ""}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store",signal:abort.signal });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) throw Error("The document could not be opened. Please retry or sign in again.");
      const blob = await response.blob();
      if (request.current !== attempt) return;
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
      const url = URL.createObjectURL(blob); activeUrl.current = url;
      setPreview({ url, epoch,name: `DBC-${rental._id.slice(-8).toUpperCase()}${phase === "return" ? "-RETURN" : ""}.pdf` });
    } catch (e) { if (request.current === attempt) setError(e instanceof Error ? e.message : "Could not open document."); }
    finally { if (request.current === attempt) setBusy(null); }
  }
  return <section className={styles.library} data-admin={admin} data-has-detail={!!selection} aria-label="Rental invoice library">
    <div className={styles.directoryPanel}><div className={styles.toolbar}><div><h2>{admin ? "Invoices" : "Rental documents"}</h2><p>View rental receipts, payments and issued settlements.</p></div><div className={styles.searchControls}><label><span className="sr-only">Invoice issue date</span><select aria-label="Invoice issue date" value={dateRange} onChange={e=>setDateRange(e.target.value)}><option value="all">All dates</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></select></label><label><span className="sr-only">Search rental documents</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder={admin ? "Search loaded invoices, customers or equipment…" : "Search loaded invoices or equipment…"} /></label></div></div>
    <div className={styles.tabs}>{[["all", "All loaded documents"], ["receipt", "Rental receipts"], ["return", "Return settlements"]].map(([key, label]) => <button key={key} aria-pressed={filter === key} aria-label={label} onClick={() => setFilter(key)}>{admin ? key === "all" ? "All" : key === "receipt" ? "Receipts" : "Settlements" : label}<span>{documents.filter(d => key === "all" || d.phase === key).length}</span></button>)}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.workspace}>
    {rentals === undefined ? <p className={styles.empty}>Loading rental documents…</p> : !visible.length ? <p className={styles.empty}>{search ? "No documents match your search." : "No documents in this view yet. Paid rentals appear here automatically."}</p> : <div className={styles.list}><table><colgroup>{(admin?[19,18,20,12,11,14,6]:[24,25,16,13,16,6]).map((width,i)=><col key={i} style={{width:`${width}%`}}/>)}</colgroup><thead><tr><th>Invoice</th><th>Rental</th>{admin&&<th>Customer</th>}<th>Issued</th><th>Amount</th><th>Rental status</th><th><span className="sr-only">PDF</span></th></tr></thead><tbody>{visible.map(({rental:r,phase,label})=><tr key={`${r._id}-${phase}`} data-selected={selected===`${r._id}-${phase}`}><td><button className={styles.document} aria-pressed={selected===`${r._id}-${phase}`} onClick={e=>{selectedButton.current=e.currentTarget;close();setChosen({key:`${r._id}-${phase}`,epoch:scope.current.epoch});}}><h3>DBC-{r._id.slice(-8).toUpperCase()}{phase==="return"?"-R":""}</h3><p>{label}</p></button></td><td data-label="Rental"><strong title={rentalPeriod(r.lineItems)}>{rentalPeriod(r.lineItems)}</strong><small title={r.lineItems.map(l=>l.title).join(", ")}>{r.lineItems[0]?.title??"Rental"}{r.lineItems.length>1?` +${r.lineItems.length-1}`:""}</small></td>{admin&&<td data-label="Customer"><strong title={r.guestName}>{r.guestName??"Rental customer"}</strong><small title={r.guestEmail}>{r.guestEmail??"Email not recorded"}</small></td>}<td data-label="Issued">{phase==="return"?(r.returnStatementIssuedAt==null?"Not recorded":compactDate(r.returnStatementIssuedAt)):compactDate(r.at)}</td><td className={styles.amount} data-label="Amount">{phase==="receipt"?formatGbp(r.total):"Settlement"}</td><td data-label="Rental status"><span className={styles.status} data-status={r.status}>{r.status.replaceAll("_"," ")}</span></td><td><button className={styles.pdfButton} disabled={!!busy} onClick={()=>void open(r,phase)} title={`View ${label} PDF`} aria-label={`View PDF ${r._id} ${label}`}>{busy===`${r._id}-${phase}`?"…":"↗"}</button></td></tr>)}</tbody></table></div>}

    </div>
    <footer className={styles.footer}><span>{visible.length} matching documents in {rentals?.length??0} loaded rentals</span>{onLoadMore&&(hasMore||loadingMore)&&<button disabled={loadingMore} onClick={onLoadMore}>{loadingMore?"Loading older records…":"Load older records"}</button>}</footer>
    </div>
    {selection && <aside ref={detailPanel} className={styles.detail} aria-label="Selected rental document"><header><div><small>{selection.label}</small><h3>{selection.phase === "return" ? detail?.returnStatement?.number ?? `${detail?.number ?? `DBC-${selection.rental._id.slice(-8).toUpperCase()}`}-R` : detail?.number ?? `DBC-${selection.rental._id.slice(-8).toUpperCase()}`}</h3><p className={styles.reference}>Rental {selection.rental._id.slice(-8).toUpperCase()} · {rentalPeriod(selection.rental.lineItems)}</p></div><div className={styles.detailActions}><button className={styles.openPdf} disabled={!!busy} onClick={()=>void open(selection.rental,selection.phase)}>{busy ? "Opening…" : "Open PDF"}</button><button aria-label="Close document details" onClick={closeDetails}>×</button></div></header>{detail === undefined ? <p>Loading authorised rental record…</p> : !detail ? <p role="alert">This record is unavailable. Please sign in again.</p> : <><section className={styles.customerMeta}><div><h4>Customer</h4><p className={styles.customerName}>{detail.customerName ?? "Rental customer"}</p><p>{detail.email}</p></div><div><h4>Invoice details</h4><p>Issued {fmtDateYear(selection.phase === "return" && detail.returnStatement ? detail.returnStatement.issuedAt : detail.issuedAt)}</p><p>Rental status <span className={styles.status} data-status={detail.status}>{detail.status.replaceAll("_", " ")}</span></p></div></section><section><h4>Rented equipment</h4><div className={styles.equipmentHead}><span>Item</span><span>Total</span></div>{detail.lineItems.map((line, index) => <div className={styles.line} key={index}>{!!detail.equipmentImages?.[index]?.length && <SmartImage src={detail.equipmentImages[index][0]} fallbackSources={detail.equipmentImages[index]} alt={line.title} className={styles.equipmentImage}/>}<div><strong>{line.title}</strong><small>{line.qty} × · {fmtDateYear(line.start)} – {fmtDateYear(line.end)}</small></div><span>{formatGbp(line.lineTotal)}</span></div>)}</section><section><h4>Rental payment record</h4><dl><div><dt>Rental subtotal</dt><dd>{formatGbp(detail.subtotal)}</dd></div>{detail.discount > 0 && <div><dt>Discount</dt><dd>−{formatGbp(detail.discount)}</dd></div>}{detail.creditApplied > 0 && <div><dt>Total credit applied</dt><dd>−{formatGbp(detail.creditApplied)}</dd></div>}{detail.membershipCreditApplied > 0 && <div><dt>Subscription portion · included above</dt><dd>{formatGbp(detail.membershipCreditApplied)}</dd></div>}{detail.deliveryFee > 0 && <div><dt>Delivery</dt><dd>{formatGbp(detail.deliveryFee)}</dd></div>}<div><dt>Receipt amount</dt><dd>{formatGbp(detail.total)}</dd></div><div><dt>Confirmed rental refunds</dt><dd>{formatGbp(detail.rentalRefunded)}</dd></div>{detail.accountCreditIssued > 0 && <div><dt>Account credit issued · no card refund</dt><dd>{formatGbp(detail.accountCreditIssued)}</dd></div>}</dl></section><section><h4>Refundable security</h4><dl><div><dt>Deposit payment</dt><dd>{formatGbp(detail.depositAmount)}</dd></div><div><dt>Deposit refunded</dt><dd>{detail.depositRefundAmount === null ? "Not recorded" : formatGbp(detail.depositRefundAmount)}</dd></div><div><dt>Original card authorisation</dt><dd>{formatGbp(detail.depositHoldAmount)}</dd></div></dl><p>Authorisation status: {detail.depositHoldStatus?.replaceAll("_", " ") ?? "Not recorded"}. A released authorisation is separate from a cash refund.</p></section>{selection.phase === "return" && detail.returnStatement && <section><h4>Issued return settlement</h4><dl><div><dt>Security payment refunded</dt><dd>{formatGbp(detail.returnStatement.securityRefunded)}</dd></div><div><dt>Documented damage/loss retained</dt><dd>{formatGbp(detail.returnStatement.damageTotal)}</dd></div><div><dt>Damage collected from card hold</dt><dd>{formatGbp(detail.returnStatement.damageFromHold)}</dd></div><div><dt>Separate late rental assessed</dt><dd>{formatGbp(detail.returnStatement.lateAssessed)}</dd></div></dl>{detail.returnStatement.damageNote && <p>{detail.returnStatement.damageNote}</p>}</section>}<button className={styles.pdfButton} disabled={!!busy} onClick={() => void open(selection.rental, selection.phase)}>{busy ? "Opening…" : "View & download PDF ↗"}</button></>}</aside>}

    <dialog ref={dialog} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }} className={styles.preview}>{activePreview && <><header><strong>{activePreview.name}</strong><div><a href={activePreview.url} download={activePreview.name}>Download PDF</a><button onClick={close}>Close</button></div></header><iframe src={activePreview.url} title={activePreview.name} /></>}</dialog>
  </section>;
}
