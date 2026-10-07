"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { formatGbp } from "@/lib/pricing";
import { fmtDateYear } from "@/lib/bookingDisplay";
import styles from "./InvoiceLibrary.module.css";

type Rental = { _id: string; at: number; status: string; total: number; guestEmail?: string; hasPayment?: boolean; hasReturnStatement?: boolean; lineItems: { title: string }[] };
export function InvoiceLibrary({ rentals, token, admin = false }: { rentals: Rental[] | undefined; token: string; admin?: boolean }) {
  const [search, setSearch] = useState(""), [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), activeUrl = useRef<string | null>(null), request = useRef(0);
  useEffect(() => { request.current++; setPreview(null); setSelected(null); setBusy(null); setError(""); if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); activeUrl.current = null; return () => { request.current++; if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); }; }, [token]);
  useEffect(() => { if (preview && !dialog.current?.open) dialog.current?.showModal(); }, [preview]);
  const documents = (rentals ?? []).flatMap(r => {
    const paid = r.hasPayment ?? ["confirmed", "active", "returned"].includes(r.status);
    return [...(paid ? [{ rental: r, phase: "receipt", label: "Rental receipt" }] : []), ...(r.hasReturnStatement ? [{ rental: r, phase: "return", label: "Return settlement" }] : [])];
  });
  const visible = documents.filter(d => (filter === "all" || filter === d.phase) && `${d.rental._id} ${d.rental.guestEmail ?? ""} ${d.rental.lineItems.map(i => i.title).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selection = visible.find(d => `${d.rental._id}-${d.phase}` === selected);
  const detail = useQuery(api.bookings.invoiceData, selection ? { token, bookingId: selection.rental._id as any } : "skip");
  function close() { dialog.current?.close(); setPreview(null); if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); activeUrl.current = null; }
  async function open(rental: Rental, phase: string) {
    const attempt = ++request.current, key = `${rental._id}-${phase}`;
    setBusy(key); setError("");
    try {
      const response = await fetch(`/api/invoice/${encodeURIComponent(rental._id)}${phase === "return" ? "?phase=return" : ""}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) throw Error("The document could not be opened. Please retry or sign in again.");
      const blob = await response.blob();
      if (request.current !== attempt) return;
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
      const url = URL.createObjectURL(blob); activeUrl.current = url;
      setPreview({ url, name: `DBC-${rental._id.slice(-8).toUpperCase()}${phase === "return" ? "-RETURN" : ""}.pdf` });
    } catch (e) { if (request.current === attempt) setError(e instanceof Error ? e.message : "Could not open document."); }
    finally { if (request.current === attempt) setBusy(null); }
  }
  return <section className={styles.library} aria-label="Rental invoice library">
    <div className={styles.toolbar}><div><h2>Rental documents</h2><p>Receipts and issued return settlements, linked to each rental.</p></div><label><span className="sr-only">Search rental documents</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder={admin ? "Search rental, customer or equipment…" : "Search rental or equipment…"} /></label></div>
    <div className={styles.tabs}>{[["all", "All documents"], ["receipt", "Rental receipts"], ["return", "Return settlements"]].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{documents.filter(d => key === "all" || d.phase === key).length}</span></button>)}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={`${styles.workspace} ${selection ? styles.withDetail : ""}`}>
    {rentals === undefined ? <p className={styles.empty}>Loading rental documents…</p> : !visible.length ? <p className={styles.empty}>{search ? "No documents match your search." : "No documents in this view yet. Paid rentals appear here automatically."}</p> : <div className={styles.list}>{visible.map(({ rental: r, phase, label }) => <article key={`${r._id}-${phase}`} data-selected={selected === `${r._id}-${phase}`}><span className={styles.icon}>▤</span><button className={styles.document} aria-pressed={selected === `${r._id}-${phase}`} onClick={() => setSelected(`${r._id}-${phase}`)}><h3>DBC-{r._id.slice(-8).toUpperCase()}{phase === "return" ? "-R" : ""}</h3><p>{label} · rental created {fmtDateYear(r.at)}</p><span>{admin && r.guestEmail ? `${r.guestEmail} · ` : ""}{r.lineItems[0]?.title ?? "Rental"}{r.lineItems.length > 1 ? ` +${r.lineItems.length - 1} more` : ""}</span></button><div className={styles.amount}>{phase === "receipt" ? formatGbp(r.total) : "Settlement"}<small>{r.status.replaceAll("_", " ")}</small></div><button className={styles.pdfButton} disabled={!!busy} onClick={() => void open(r, phase)}>{busy === `${r._id}-${phase}` ? "Opening…" : "View PDF ↗"}</button></article>)}</div>}
    {selection && <aside className={styles.detail} aria-label="Selected rental document"><header><div><small>{selection.label}</small><h3>{detail?.number ?? `DBC-${selection.rental._id.slice(-8).toUpperCase()}`}{selection.phase === "return" ? "-R" : ""}</h3></div><button aria-label="Close document details" onClick={() => setSelected(null)}>×</button></header>{detail === undefined ? <p>Loading authorised rental record…</p> : !detail ? <p role="alert">This record is unavailable. Please sign in again.</p> : <><section><h4>Customer & rental</h4><p>{detail.customerName ?? "Rental customer"}</p><p>{detail.email}</p><p>Issued {fmtDateYear(selection.phase === "return" && detail.returnStatement ? detail.returnStatement.issuedAt : detail.issuedAt)} · {detail.status.replaceAll("_", " ")}</p></section><section><h4>Rented equipment</h4>{detail.lineItems.map((line, index) => <div className={styles.line} key={index}><div><strong>{line.title}</strong><small>{line.qty} × · {fmtDateYear(line.start)} – {fmtDateYear(line.end)}</small></div><span>{formatGbp(line.lineTotal)}</span></div>)}</section><section><h4>Rental payment record</h4><dl><div><dt>Rental subtotal</dt><dd>{formatGbp(detail.subtotal)}</dd></div>{detail.discount > 0 && <div><dt>Discount</dt><dd>−{formatGbp(detail.discount)}</dd></div>}{detail.creditApplied > 0 && <div><dt>Total credit applied</dt><dd>−{formatGbp(detail.creditApplied)}</dd></div>}{detail.membershipCreditApplied > 0 && <div><dt>Subscription portion · included above</dt><dd>{formatGbp(detail.membershipCreditApplied)}</dd></div>}{detail.deliveryFee > 0 && <div><dt>Delivery</dt><dd>{formatGbp(detail.deliveryFee)}</dd></div>}<div><dt>Receipt amount</dt><dd>{formatGbp(detail.total)}</dd></div><div><dt>Confirmed rental refunds</dt><dd>{formatGbp(detail.rentalRefunded)}</dd></div>{detail.accountCreditIssued > 0 && <div><dt>Account credit issued · no card refund</dt><dd>{formatGbp(detail.accountCreditIssued)}</dd></div>}</dl></section><section><h4>Refundable security</h4><dl><div><dt>Deposit payment</dt><dd>{formatGbp(detail.depositAmount)}</dd></div><div><dt>Deposit refunded</dt><dd>{detail.depositRefundAmount === null ? "Not recorded" : formatGbp(detail.depositRefundAmount)}</dd></div><div><dt>Original card authorisation</dt><dd>{formatGbp(detail.depositHoldAmount)}</dd></div></dl><p>Authorisation status: {detail.depositHoldStatus?.replaceAll("_", " ") ?? "Not recorded"}. A released authorisation is separate from a cash refund.</p></section>{selection.phase === "return" && detail.returnStatement && <section><h4>Issued return settlement</h4><dl><div><dt>Security payment refunded</dt><dd>{formatGbp(detail.returnStatement.securityRefunded)}</dd></div><div><dt>Documented damage/loss retained</dt><dd>{formatGbp(detail.returnStatement.damageTotal)}</dd></div><div><dt>Damage collected from card hold</dt><dd>{formatGbp(detail.returnStatement.damageFromHold)}</dd></div><div><dt>Separate late rental assessed</dt><dd>{formatGbp(detail.returnStatement.lateAssessed)}</dd></div></dl>{detail.returnStatement.damageNote && <p>{detail.returnStatement.damageNote}</p>}</section>}<button className={styles.pdfButton} disabled={!!busy} onClick={() => void open(selection.rental, selection.phase)}>{busy ? "Opening…" : "View & download PDF ↗"}</button></>}</aside>}
    </div>
    <dialog ref={dialog} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }} className={styles.preview}>{preview && <><header><strong>{preview.name}</strong><div><a href={preview.url} download={preview.name}>Download PDF</a><button onClick={close}>Close</button></div></header><iframe src={preview.url} title={preview.name} /></>}</dialog>
  </section>;
}
