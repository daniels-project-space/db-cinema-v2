"use client";
import { useEffect, useRef, useState } from "react";
import { formatGbp } from "@/lib/pricing";
import { fmtDateYear } from "@/lib/bookingDisplay";
import styles from "./InvoiceLibrary.module.css";

type Rental = { _id: string; at: number; status: string; total: number; guestEmail?: string; hasPayment?: boolean; hasReturnStatement?: boolean; lineItems: { title: string }[] };
export function InvoiceLibrary({ rentals, token, admin = false }: { rentals: Rental[] | undefined; token: string; admin?: boolean }) {
  const [search, setSearch] = useState(""), [filter, setFilter] = useState("all");
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), activeUrl = useRef<string | null>(null), request = useRef(0);
  useEffect(() => { request.current++; setPreview(null); setBusy(null); setError(""); if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); activeUrl.current = null; return () => { request.current++; if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); }; }, [token]);
  useEffect(() => { if (preview && !dialog.current?.open) dialog.current?.showModal(); }, [preview]);
  const documents = (rentals ?? []).flatMap(r => {
    const paid = r.hasPayment ?? ["confirmed", "active", "returned"].includes(r.status);
    return [...(paid ? [{ rental: r, phase: "receipt", label: "Rental receipt" }] : []), ...(r.hasReturnStatement ? [{ rental: r, phase: "return", label: "Return settlement" }] : [])];
  });
  const visible = documents.filter(d => (filter === "all" || filter === d.phase) && `${d.rental._id} ${d.rental.guestEmail ?? ""} ${d.rental.lineItems.map(i => i.title).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
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
    {rentals === undefined ? <p className={styles.empty}>Loading rental documents…</p> : !visible.length ? <p className={styles.empty}>{search ? "No documents match your search." : "No documents in this view yet. Paid rentals appear here automatically."}</p> : <div className={styles.list}>{visible.map(({ rental: r, phase, label }) => <article key={`${r._id}-${phase}`}><span className={styles.icon}>▤</span><div className={styles.document}><h3>DBC-{r._id.slice(-8).toUpperCase()}{phase === "return" ? "-R" : ""}</h3><p>{label} · {fmtDateYear(r.at)}</p><span>{admin && r.guestEmail ? `${r.guestEmail} · ` : ""}{r.lineItems[0]?.title ?? "Rental"}{r.lineItems.length > 1 ? ` +${r.lineItems.length - 1} more` : ""}</span></div><div className={styles.amount}>{phase === "receipt" ? formatGbp(r.total) : "Settlement"}<small>{r.status.replaceAll("_", " ")}</small></div><button disabled={!!busy} onClick={() => void open(r, phase)}>{busy === `${r._id}-${phase}` ? "Opening…" : "View PDF ↗"}</button></article>)}</div>}
    <dialog ref={dialog} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }} className={styles.preview}>{preview && <><header><strong>{preview.name}</strong><div><a href={preview.url} download={preview.name}>Download PDF</a><button onClick={close}>Close</button></div></header><iframe src={preview.url} title={preview.name} /></>}</dialog>
  </section>;
}
