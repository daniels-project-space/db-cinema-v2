"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import styles from "./AccountDocuments.module.css";
import { SmartImage } from "@/components/SmartImage";

function documentTitle(kind: string) {
  return kind === "drone-operator-licence" ? "Drone operator licence" : kind.startsWith("address-") ? "Proof of address" : `Proof of identity · ${kind.includes("back") ? "back" : "front"}${kind.includes("full_") ? " · full image" : ""}`;
}

export function AccountDocumentSummary({
  token,
  accountId,
  onReview,
}: {
  token: string;
  accountId: string;
  onReview: () => void;
}) {
  const archives = useQuery(api.verificationArchive.accountDocuments, {
    token,
    accountId: accountId as any,
  });
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const expiries = (archives ?? []).map(a => a.retention.expiresAt)
      .filter((at): at is number => at !== null && at > clock);
    if (!expiries.length) return;
    const timer = setTimeout(() => setClock(Date.now()),
      Math.min(86400000, Math.max(1, Math.min(...expiries) - Date.now())));
    return () => clearTimeout(timer);
  }, [archives, clock]);
  const files = (archives ?? [])
    .filter((a) => a.status !== "deleted")
    .flatMap((a) =>
      a.documents.map((d) => {
        const expired = a.retention.expiresAt !== null && a.retention.expiresAt <= clock;
        return { ...d, expired, complete: !expired && a.retention.viewable &&
          a.status === "complete" && a.copiesReady && d.available };
      }),
    )
    .slice(-3);
  return (
    <div>
      {archives === undefined ? (
        <p className="py-2 text-[11px] text-white/45">
          Loading retained documents…
        </p>
      ) : !files.length ? (
        <p className="py-2 text-[11px] leading-6 text-white/45">
          No retained document copies yet. Review verification archives for this
          account.
        </p>
      ) : (
        files.map((file) => (
          <button
            type="button"
            key={file.id}
            onClick={onReview}
            className="flex w-full items-center gap-2 border-t border-white/[.07] py-3 text-left"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              className="h-7 w-7 shrink-0 text-white/50"
            >
              <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" />
            </svg>
            <span className="min-w-0 flex-1">
              <strong className="block text-[10px] font-medium text-white/80">
                {documentTitle(file.kind)}
              </strong>
              <small className="mt-1 block text-[9px] text-white/40">
                Saved {new Date(file.savedAt).toLocaleDateString("en-GB")}
              </small>
            </span>
            <span
              className={`text-[9px] ${file.complete ? "text-emerald-400/70" : "text-amber-200/70"}`}
            >
              {file.expired ? "Retention ended" : file.complete ? "✓ Saved" : "Incomplete"}
            </span>
          </button>
        ))
      )}
      {!!archives?.some(
        (a) => a.status !== "complete" && a.status !== "deleted",
      ) && (
        <p className="mt-2 text-[10px] text-amber-200/80">
          Verification archive needs review.
        </p>
      )}
    </div>
  );
}

export function AccountDocuments({
  token,
  accountId,
  customer,
  onBack,
  onSection,
}: {
  token: string;
  accountId: string;
  customer?: { name: string; email: string; avatarUrl?: string | null; verified: boolean };
  onBack?: () => void;
  onSection?: (section: string) => void;
}) {
  const archives = useQuery(api.verificationArchive.accountDocuments, {
    token,
    accountId: accountId as any,
  });
  const retry = useMutation(api.verificationArchive.retry);
  const backfill = useMutation(api.verificationArchive.backfillAccount);
  const retentionHold = useMutation(api.verificationArchive.retentionHold);
  const [preview, setPreview] = useState<{
      url: string;
      type: string;
      title: string;
      documentId:string;
      accountId: string;
      token: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [originalOpen,setOriginalOpen]=useState(false);
  const originalDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(originalOpen && preview)originalDialog.current?.showModal();else originalDialog.current?.close();},[originalOpen,preview]);
  const activeUrl = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const scope = useRef(0);
  // A response can outlive the query snapshot, retention deadline or account.
  // Check the latest metadata again before creating a browser copy.
  const access = useRef({ archives, accountId, token });
  access.current = { archives, accountId, token };
  const [holdEditor, setHoldEditor] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [clock,setClock]=useState(()=>Date.now());
  useEffect(()=>{
    const expiries=(archives ?? []).map(a=>a.retention.expiresAt).filter((at):at is number=>at!==null && at>clock);
    if(!expiries.length)return;
    const timer=setTimeout(()=>setClock(Date.now()),Math.min(86400000,Math.max(1,Math.min(...expiries)-Date.now())));
    return()=>clearTimeout(timer);
  },[archives,clock]);
  const currentArchives=(archives ?? []).map(archive=>({...archive,retention:{...archive.retention,viewable:archive.retention.viewable && (archive.retention.expiresAt===null || archive.retention.expiresAt>clock)}}));
  const allFiles = currentArchives.filter(a => a.status !== "deleted").flatMap(archive => archive.documents.map(document => ({...document,available:archive.retention.viewable && document.available,archive}))).sort((a,b)=>Number(a.kind.includes("full_"))-Number(b.kind.includes("full_")) || a.savedAt-b.savedAt);
  const files = allFiles.filter(d => documentTitle(d.kind).toLowerCase().includes(search.toLowerCase()) && (filter === "all" || filter === "saved" && d.available || filter === "attention" && !d.available));
  const selectedFile = allFiles.find(d => d.id === selectedDocument) ?? files[0];
  const selectedArchive = selectedFile?.archive ?? currentArchives.find(a => a.status !== "deleted");
  const savedCount = allFiles.filter(d => d.available).length;
  const active = currentArchives.some(a => a.retention.status === "active-rental");
  const unhealthy = currentArchives.some(a => a.status !== "deleted" && a.retention.viewable && !a.copiesReady);
  const shortDate = (at: number) => new Date(at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  useEffect(()=>{
    if(!preview || !archives)return;
    const archive=archives.find(a=>a.documents.some(d=>d.id===preview.documentId));
    const clear=()=>{scope.current++;request.current?.abort();setPreview(null);setBusy(false);if(activeUrl.current)URL.revokeObjectURL(activeUrl.current);activeUrl.current=null;};
    if(!archive || archive.status==="deleted" || !archive.retention.viewable || !archive.documents.find(d=>d.id===preview.documentId)?.available){clear();return;}
    const expiresAt=archive.retention.expiresAt;if(expiresAt===null)return;
    let timer:ReturnType<typeof setTimeout>;
    const check=()=>{const remaining=expiresAt-Date.now();if(remaining<=0)clear();else timer=setTimeout(check,Math.min(remaining,86400000));};
    check();return()=>clearTimeout(timer);
  },[archives,preview]);
  useEffect(() => {
    scope.current++;
    request.current?.abort();
    request.current = null;
    setPreview(null);
    setError("");
    setBusy(false);
    setHoldEditor(null);
    setHoldReason("");
    setSearch("");
    setFilter("all");
    setSelectedDocument(null);
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    activeUrl.current = null;
  }, [accountId, token]);
  useEffect(
    () => () => {
      scope.current++;
      request.current?.abort();
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    },
    [],
  );
  useEffect(() => {
    if (selectedFile?.available && selectedDocument === null) void view(selectedFile);
  }, [accountId, token, selectedDocument, selectedFile?.id, selectedFile?.available]);
  async function view(document: {
    id: string;
    kind: string;
    contentType: string;
  }, download: boolean | "open" = false) {
    const currentScope = scope.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    const canView = () => {
      const current = access.current;
      if (current.accountId !== accountId || current.token !== token) return false;
      const archive = current.archives?.find(a => a.documents.some(d => d.id === document.id));
      return !!archive && archive.status !== "deleted" && archive.retention.viewable &&
        (archive.retention.expiresAt === null || archive.retention.expiresAt > Date.now()) &&
        archive.documents.some(d => d.id === document.id && d.available);
    };
    try {
      if (!canView()) throw Error("This document is no longer available.");
      const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
      if (!site) throw Error("Document service configuration is missing.");
      const response = await fetch(`${site}/admin-verification-document`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documentId: document.id }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok)
        throw Error(
          "Document could not be opened. Please retry or check admin access.",
        );
      const blob = await response.blob();
      if (controller.signal.aborted || currentScope !== scope.current) return;
      if (!canView()) throw Error("This document is no longer available.");
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
      const url = URL.createObjectURL(blob);
      activeUrl.current = url;
      setSelectedDocument(document.id);
      if (download === true) {
        const anchor = window.document.createElement("a");
        anchor.href = url; anchor.download = documentTitle(document.kind) + (document.contentType === "application/pdf" ? ".pdf" : document.contentType === "image/png" ? ".png" : document.contentType === "image/webp" ? ".webp" : ".jpg");
        anchor.click();
      }
      if (download === "open")setOriginalOpen(true);
      setPreview({ url, type: document.contentType, title: documentTitle(document.kind),documentId:document.id,accountId,token });
    } catch (e) {
      if (!controller.signal.aborted && currentScope === scope.current)
        setError(e instanceof Error ? e.message : "Could not open document.");
    } finally {
      if (currentScope === scope.current && request.current === controller) setBusy(false);
      if (request.current === controller) request.current = null;
    }
  }
  async function perform(action: () => Promise<unknown>) {
    const currentScope = scope.current;
    setBusy(true);
    setError("");
    try { await action(); }
    catch (e) { if (currentScope === scope.current) setError(e instanceof Error ? e.message : "Document action failed."); }
    finally { if (currentScope === scope.current) setBusy(false); }
  }
  return (
    <section className={styles.page} aria-label="Account documents" data-testid="retained-documents-page">
      <div className={styles.tools}>
        <button type="button" onClick={onBack} className={styles.breadcrumb}>← <span>Customers</span> / {customer?.name ?? "Account documents"}</button>
        <button type="button" disabled={busy} onClick={() => void perform(() => backfill({token,accountId:accountId as any}))} className={styles.primary}>↑ <span>Import from Didit</span></button>
      </div>
      {customer && <div className={styles.profile}>
        {customer.avatarUrl ? <SmartImage src={customer.avatarUrl} alt="" className={styles.avatar} /> : <span className={styles.avatar}>{customer.name.slice(0,1).toUpperCase()}</span>}
        <div className={styles.identity}><div><h2>{customer.name}</h2><span className={customer.verified ? styles.good : styles.pending}>{customer.verified ? "✓ Verified customer" : "Verification pending"}</span></div><p>{customer.email}</p></div>
        <nav aria-label="Customer profile sections">{["Overview","Rentals","Conversations","Documents","Notes"].map(name => <button type="button" key={name} aria-pressed={name === "Documents"} onClick={() => onSection?.(name.toLowerCase())}>{name}</button>)}</nav>
      </div>}
      <div className={styles.stats}>
        <div><DocumentIcon /><p><strong>{archives === undefined ? "…" : savedCount}</strong><span>saved document{savedCount === 1 ? "" : "s"}</span></p></div>
        <div><span className={styles.shield}><DocumentIcon type="shieldCheck" /></span><p><strong>{unhealthy ? "Documents need attention" : savedCount ? "Documents saved" : "Awaiting documents"}</strong><span>{unhealthy ? "Repair incomplete or missing copies" : "Private copies linked to this account"}</span></p></div>
        <div><span className={styles.lock}><DocumentIcon type="lock" /></span><p><strong>{active ? "Retention protected" : selectedArchive?.retention.viewable ? "Within retention" : "Retention status"}</strong><span>{active ? "Active rentals keep documents available" : "30 days after rental closure"}</span></p></div>
      </div>
      <div className={styles.retentionStrip}>
        <span className={styles.shield}><DocumentIcon type="shield" /></span><div><strong>Retained during the rental and for 30 days after return.</strong><p>An active rental keeps its documents available.</p></div>
        <ol aria-label="Document retention timeline">{["Uploaded","Saved","Rental active","Returned","30-day retention"].map((name,i) => <li key={name} className={i === 0 && allFiles.length || i === 1 && savedCount || i === 2 && active ? styles.reached : ""}><span/><strong>{name}</strong><small>{i === 0 && allFiles[0] ? shortDate(Math.min(...allFiles.map(d => d.savedAt))) : i === 1 && selectedArchive?.completedAt ? shortDate(selectedArchive.completedAt) : i === 2 && active ? "Active" : i === 4 && selectedArchive?.retention.expiresAt ? shortDate(selectedArchive.retention.expiresAt) : "—"}</small></li>)}</ol>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.columns}>
        <section className={styles.library} aria-label="Saved documents">
          <header><h3>Saved documents</h3><label className={styles.search}><span>⌕</span><input type="search" aria-label="Search documents" placeholder="Search documents…" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Filter documents" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All documents</option><option value="saved">Saved copies</option><option value="attention">Needs attention</option></select></header>
          {archives === undefined ? <p role="status" className={styles.empty}>Loading retained documents…</p> : !files.length ? <p className={styles.empty}>{allFiles.length ? "No documents match this search." : "No saved documents yet. Import existing Didit verifications or wait for the renter’s upload."}</p> : <ul>{files.map(document => <li key={document.id} className={selectedFile?.id === document.id ? styles.selected : ""}>
            <button type="button" className={styles.fileIdentity} onClick={() => {setSelectedDocument(document.id); if(document.available) void view(document);}} aria-label={`Select ${documentTitle(document.kind)}`}>
              <PrivateDocumentThumb key={`${accountId}:${document.id}`} token={token} accountId={accountId} document={document} />
              <span><strong>{documentTitle(document.kind)}</strong><small>{document.contentType === "application/pdf" ? "PDF" : document.contentType.split("/")[1].toUpperCase()} · {document.size >= 1024 * 1024 ? (document.size / (1024 * 1024)).toFixed(1) + " MB" : Math.ceil(document.size / 1024) + " KB"}</small><small>Uploaded {shortDate(document.savedAt)}</small></span>
            </button>
            <div className={styles.fileStatus}><span className={document.available ? styles.good : styles.pending}>{document.available ? "✓ Saved" : document.archive.retention.viewable ? "Copy unavailable" : "Retention ended"}</span><small>{document.archive.source === "drone" ? "Operator licence" : "Didit verification"}</small></div>
            <span className={styles.rental}>↗ {document.archive.bookingId.slice(-8)}</span>
            {document.available && <div className={styles.fileActions}><button type="button" disabled={busy} aria-label={`View ${documentTitle(document.kind)}`} onClick={() => void view(document)}><DocumentIcon type="eye" /></button><button type="button" disabled={busy} aria-label={`Download ${documentTitle(document.kind)}`} onClick={() => void view(document,true)}><DocumentIcon type="download" /></button></div>}
          </li>)}</ul>}
          {currentArchives.filter(a => a.status !== "deleted" && a.retention.viewable && !a.copiesReady).map(archive => <div key={archive._id} className={styles.repair}><strong>{archive.status === "complete" ? "Saved copies need repair" : archive.status === "attention" ? "Archive needs attention" : "Saving documents"}</strong><p>{archive.source === "drone" ? "Ask the renter to upload a current licence copy through their rental." : archive.error ?? "Verification files must finish saving before handover."}</p>{archive.source !== "drone" && <button type="button" disabled={busy} onClick={() => void perform(() => retry({token,archiveId:archive._id}))}>{archive.status === "complete" ? "Repair document archive" : "Retry document archive"} →</button>}</div>)}
        </section>
        <section className={styles.preview} aria-label="Document preview">
          <header><h3>{selectedFile ? documentTitle(selectedFile.kind) : "Document preview"}</h3><span className={styles.private}><DocumentIcon type="lock" /> Private document</span></header>
          <div className={styles.previewCanvas}>
            {preview && selectedFile?.available && preview.accountId === accountId && preview.token === token && preview.documentId === selectedFile.id ? preview.type === "application/pdf" ? <iframe src={preview.url} title={preview.title} /> : <img src={preview.url} alt={preview.title} /> : <div className={styles.previewEmpty}><DocumentIcon /><strong>{busy ? "Opening private document…" : selectedFile?.available ? "Open the saved original" : "No available preview"}</strong><p>{selectedFile?.available ? "Select a document to securely view its saved copy." : "Files become viewable once their private archive is complete."}</p></div>}
          </div>
          {selectedFile && <div className={styles.original}><div><strong>{selectedFile.available ? "Original file saved" : "Copy unavailable"}</strong><small>{selectedFile.contentType === "application/pdf" ? "PDF" : "Image"} · {Math.ceil(selectedFile.size / 1024)} KB</small><small>Linked to {customer?.name ?? "this account"} · {selectedFile.archive.bookingId.slice(-8)}</small></div>{selectedFile.available && <div><button type="button" disabled={busy} onClick={() => void view(selectedFile,"open")}>↗ Open original</button><button type="button" disabled={busy} className={styles.primary} onClick={() => void view(selectedFile,true)}>↓ Download</button></div>}</div>}
          <div className={styles.retention}><h4>Retention</h4>{selectedArchive ? <>
            <dl><div><dt>Current rental</dt><dd>{selectedArchive.retention.activeRentals ? "Active" : selectedArchive.retention.status === "unknown-closure" ? "Closure not recorded" : "Closed"}</dd></div><div><dt>Deletion date</dt><dd>{selectedArchive.retention.expiresAt ? shortDate(selectedArchive.retention.expiresAt) : selectedArchive.retention.activeRentals ? "Set after return" : selectedArchive.retention.openCases || selectedArchive.retentionHoldReason ? "Protected by insurance hold" : "Awaiting closure"}</dd></div></dl>
            {(selectedArchive.retention.status === "deleted" || !selectedArchive.retention.viewable || !!selectedArchive.retention.openCases) && <p>{selectedArchive.retention.status === "deleted" ? "File bytes have been removed." : !selectedArchive.retention.viewable ? "Retention ended. These documents cannot be viewed or reopened." : "An open damage or insurance case preserves these copies."}</p>}
            {selectedArchive.retention.viewable && <><div className={styles.holdRow}><span>Insurance review</span><button type="button" role="switch" aria-label="Insurance retention hold" aria-checked={!!selectedArchive.retentionHoldReason} disabled={busy} onClick={() => selectedArchive.retentionHoldReason ? void perform(() => retentionHold({token,archiveId:selectedArchive._id,reason:""})) : setHoldEditor(selectedArchive._id)} className={selectedArchive.retentionHoldReason ? styles.toggleOn : styles.toggle}><span /></button></div><p>Pause scheduled deletion while an insurance case is open.</p>{selectedArchive.retentionHoldReason && <p className={styles.holdNote}>Insurance hold: {selectedArchive.retentionHoldReason}</p>}
            {holdEditor === selectedArchive._id && <form onSubmit={event => {event.preventDefault();const origin=scope.current;void perform(async()=>{await retentionHold({token,archiveId:selectedArchive._id,reason:holdReason.trim()});if(origin===scope.current){setHoldEditor(null);setHoldReason("");}});}}><label>Insurance or damage case reason<textarea required minLength={10} maxLength={500} value={holdReason} onChange={e => setHoldReason(e.target.value)} /></label><button disabled={busy || holdReason.trim().length < 10} type="submit" className={styles.primary}>Save insurance hold</button><button type="button" onClick={() => {setHoldEditor(null);setHoldReason("");}}>Cancel</button></form>}</>}
          </> : <p>No document archive is linked to this account yet.</p>}</div>
        </section>
      </div>
      <dialog ref={originalDialog} className={styles.originalDialog} aria-label="Saved original document" onCancel={()=>setOriginalOpen(false)} onClose={()=>setOriginalOpen(false)}>
        {preview && selectedFile?.available && preview.documentId===selectedFile.id && preview.accountId===accountId && preview.token===token && <><header><h3>{preview.title}</h3><button type="button" onClick={()=>setOriginalOpen(false)} aria-label="Close original document">×</button></header>{preview.type==="application/pdf" ? <iframe src={preview.url} title={preview.title} /> : <img src={preview.url} alt={preview.title} />}</>}
      </dialog>
      <footer className={styles.activity}><h3>◷ Recent activity</h3>{[...allFiles].sort((a,b)=>b.savedAt-a.savedAt).slice(0,3).map(d => <div key={d.id}><DocumentIcon /><span><strong>Document saved</strong><small>{documentTitle(d.kind)} · {shortDate(d.savedAt)}</small></span></div>)}<span className={styles.private}><DocumentIcon type="lock" /> Admin access only · Downloads are logged</span></footer>
    </section>
  );
}

function DocumentIcon({type="document"}:{type?:"document"|"shield"|"shieldCheck"|"lock"|"eye"|"download"}) {const paths={document:"M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6",shield:"M12 2 3 6v7c0 5 9 9 9 9s9-4 9-9V6Z",shieldCheck:"M12 2 3 6v7c0 5 9 9 9 9s9-4 9-9V6Z M7 12l3 3 7-7",lock:"M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4",eye:"M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",download:"M12 2v14 M7 11l5 5 5-5 M4 18v4h16v-4"};return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d={paths[type]} /></svg>;}

function PrivateDocumentThumb({token,accountId,document}:{token:string;accountId:string;document:{id:string;available:boolean;contentType:string;kind:string}}) {
  const ref=useRef<HTMLSpanElement>(null);
  const [saved,setSaved]=useState<{url:string;token:string;accountId:string;id:string}|null>(null);
  useEffect(()=>{
    if(!document.available || !document.contentType.startsWith("image/"))return;
    const controller=new AbortController();let url:string|null=null,started=false;
    const load=async()=>{if(started)return;started=true;try{const site=process.env.NEXT_PUBLIC_CONVEX_SITE_URL;if(!site)return;const response=await fetch(`${site}/admin-verification-document`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({documentId:document.id}),cache:"no-store",signal:controller.signal});if(!response.ok)return;const blob=await response.blob();if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setSaved({url,token,accountId,id:document.id});}catch{/* The list still reports authoritative file readiness. */}};
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();void load();}},{rootMargin:"100px"});
    if(ref.current)observer.observe(ref.current);
    return()=>{observer.disconnect();controller.abort();if(url)URL.revokeObjectURL(url);};
  },[token,accountId,document.id,document.available,document.contentType]);
  const visible=document.available && saved?.token===token && saved.accountId===accountId && saved.id===document.id;
  return <span ref={ref} className={styles.thumbnail}>{visible ? <img src={saved.url} alt="" /> : <><DocumentIcon /><small>{document.contentType === "application/pdf" ? "PDF" : "IMAGE"}</small></>}</span>;
}
