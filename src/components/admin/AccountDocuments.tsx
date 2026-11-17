"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { documentReadiness } from "../../../shared/documentReadiness";
import styles from "./AccountDocuments.module.css";
import { SmartImage } from "@/components/SmartImage";

function documentTitle(kind: string) {
  if (kind.startsWith("selfie-")) return "Selfie · liveness image";
  if (kind.startsWith("face-match-")) return `Face match · ${kind.endsWith("source_image") ? "source" : "target"} image`;
  if (kind.startsWith("id-extra-")) return kind.endsWith("portrait_image") ? "ID portrait" : `ID camera image · ${kind.includes("back_image") ? "back" : "front"}`;
  return kind === "drone-operator-licence" ? "Drone operator licence" : kind.startsWith("address-") ? "Proof of address" : `Proof of identity · ${kind.includes("back") ? "back" : "front"}${kind.includes("full_") ? " · full image" : ""}`;
}

function reviewTimestamp(value: number | null) {
  if (value === null || value <= 0 || !Number.isFinite(new Date(value).getTime())) return "Missing or invalid";
  return `${new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC")}`;
}

function DocumentReadinessCard({ archives, verified, verificationExpiresAt }: { archives: Parameters<typeof documentReadiness>[0] | undefined; verified: boolean; verificationExpiresAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const deadlines = [...(archives ?? []).flatMap(a => [a.retention.expiresAt, a.readProofExpiresAt]), verificationExpiresAt].filter((at): at is number => at !== null && at > now);
    const timer = setTimeout(() => setNow(Date.now()), Math.min(60000, ...deadlines.map(at => Math.max(1, at - Date.now()))));
    return () => clearTimeout(timer);
  }, [archives, verificationExpiresAt, now]);
  if (!archives) return <p role="status" className={styles.readiness}>Checking document readiness…</p>;
  const state = documentReadiness(archives, verified, verificationExpiresAt, now);
  const retentionNeedsReview = archives.some(archive => archive.retention.status === "unknown-closure" && "needsReview" in archive.retention && archive.retention.needsReview);
  const boundedReview = archives.find(archive => archive.retention.status === "unknown-closure" && "reviewWindowEligible" in archive.retention && archive.retention.reviewWindowEligible);
  const reviewDeadline = boundedReview && "expiresAt" in boundedReview.retention ? boundedReview.retention.expiresAt : null;
  const reviewStartedAt = boundedReview && "reviewStartedAt" in boundedReview.retention ? boundedReview.retention.reviewStartedAt : null;
  return <section className={styles.readiness} aria-label="Customer document readiness">
    <header><h4>Document readiness</h4><span data-ready={state.ready}>{state.ready ? "Approval & copies ready" : "Needs attention"}</span></header>
    <dl><div><dt>Verification</dt><dd data-good={state.approved}>{state.approval}{verificationExpiresAt && <small>Valid until {new Date(verificationExpiresAt).toLocaleDateString("en-GB")}</small>}</dd></div>
    <div><dt>Proof of identity</dt><dd data-good={state.identitySaved}>{state.identitySaved ? state.approved ? "Approved · copy saved" : "Copy saved · awaiting approval" : retentionNeedsReview ? "Unavailable · review retention" : "Private copy missing"}</dd></div>
    <div><dt>Proof of address</dt><dd data-good={state.addressSaved}>{state.addressSaved ? state.approved ? "Approved · copy saved" : "Copy saved · awaiting approval" : retentionNeedsReview ? "Unavailable · review retention" : "Private copy missing"}</dd></div></dl>
    <p>{boundedReview ? reviewStartedAt && reviewDeadline ? `Closure needs review · copies available until ${new Date(reviewDeadline).toLocaleDateString("en-GB")}; then deleted if unresolved.` : "Closure needs review · copies stay available; a 90-day review window starts at the next retention sweep." : retentionNeedsReview ? "Retention needs review. Copies stay protected until missing or inconsistent records are resolved." : state.daysLeft !== null ? `Earliest archive deletion in ${state.daysLeft} ${state.daysLeft === 1 ? "day" : "days"} · ${new Date(state.archiveExpiry!).toLocaleDateString("en-GB")}` : state.protectedArchive ? "Copies retained during an active rental or linked open case." : "Retention countdown begins after the rental closes."}</p>
    <small>Admin-only copies are deleted 90 days after rental closure. A linked open case pauses deletion; after it closes, the 90-day period starts. If closed dates are missing, a fixed 90-day review window starts at the first retention sweep. Account restrictions do not extend document retention.</small>
  </section>;
}

export function AccountDocumentSummary({
  token,
  accountId,
  onReview,
  verified,
  verificationExpiresAt,
}: {
  token: string;
  accountId: string;
  onReview: () => void;
  verified: boolean;
  verificationExpiresAt: number | null;
}) {
  const archives = useQuery(api.verificationArchive.accountDocuments, {
    token,
    accountId: accountId as any,
  });
  const files = (archives ?? [])
    .filter((a) => a.status !== "deleted")
    .flatMap((a) =>
      a.documents.map((d) => ({ ...d, complete: a.status === "complete" && a.copiesReady && d.available })),
    )
    .slice(-3);
  return (
    <div>
      <DocumentReadinessCard archives={archives} verified={verified} verificationExpiresAt={verificationExpiresAt} />
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
              {file.complete ? "✓ Saved" : "Incomplete"}
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
  verificationExpiresAt = null,
  onBack,
  onSection,
  onRental,
  embedded = false,
  verified,
}: {
  token: string;
  accountId: string;
  customer?: { name: string; email: string; avatarUrl?: string | null; verified: boolean };
  verificationExpiresAt?: number | null;
  onBack?: () => void;
  onSection?: (section: string) => void;
  onRental?: (bookingId: string) => void;
  embedded?: boolean;
  verified?: boolean;
}) {
  const archives = useQuery(api.verificationArchive.accountDocuments, {
    token,
    accountId: accountId as any,
  });
  const retry = useMutation(api.verificationArchive.retry);
  const reportDisplayFailure = useMutation(api.verificationArchive.reportDisplayFailure);
  const retryImages = useMutation(api.verificationArchive.retrySupplemental);
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
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [originalOpen,setOriginalOpen]=useState(false);
  const originalDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(originalOpen && preview)originalDialog.current?.showModal();else originalDialog.current?.close();},[originalOpen,preview]);
  const activeUrl = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const scope = useRef(0);
  const [holdEditor, setHoldEditor] = useState<{archiveId: string; expectedReason: string; expectedRevision: number} | null>(null);
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
  const retentionNeedsReview = currentArchives.some(a => "needsReview" in a.retention && a.retention.needsReview);
  const unhealthy = retentionNeedsReview || currentArchives.some(a => a.status !== "deleted" && a.retention.viewable && !a.copiesReady);
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
    setNotice("");
    setBusy(false);
    setHoldEditor(null);
    setSearch("");
    setFilter("all");
    setSelectedDocument(null);
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    activeUrl.current = null;
  }, [accountId, token]);
  useEffect(() => {
    if (selectedFile?.available && selectedDocument === null) void view(selectedFile);
  }, [accountId, token, selectedFile?.id, selectedFile?.available]);
  useEffect(
    () => () => {
      scope.current++;
      request.current?.abort();
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    },
    [],
  );
  async function view(document: {
    id: string;
    kind: string;
    contentType: string;
    archive: { generation?: number };
  }, download: boolean | "open" = false) {
    const currentScope = scope.current;
    let reportArchiveFailure = false;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
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
      if (!response.ok) {
        reportArchiveFailure = response.status === 404 || response.status === 409;
        throw Error(
          "Document could not be opened. Please retry or check admin access.",
        );
      }
      const blob = await response.blob();
      if(document.contentType.startsWith("image/")&&typeof createImageBitmap==="function"){
        try { const bitmap=await createImageBitmap(blob);bitmap.close(); }
        catch (error) { reportArchiveFailure = true; throw error; }
      }
      if (controller.signal.aborted || currentScope !== scope.current) return;
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
      if (!controller.signal.aborted && currentScope === scope.current) {
        if(reportArchiveFailure)void reportDisplayFailure({token,documentId:document.id as any,generation:document.archive.generation??0}).catch(()=>{});
        setError(e instanceof Error ? e.message : "Could not open document.");
      }
    } finally {
      if (currentScope === scope.current) setBusy(false);
      if (request.current === controller) request.current = null;
    }
  }
  async function perform(action: () => Promise<unknown>, successMessage?: string) {
    const currentScope = scope.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (currentScope === scope.current && successMessage) setNotice(successMessage);
    }
    catch (e) { if (currentScope === scope.current) setError(e instanceof Error ? e.message : "Document action failed."); }
    finally { if (currentScope === scope.current) setBusy(false); }
  }
  function failedPreview() {
    if (!selectedFile || preview?.documentId !== selectedFile.id) return;
    setError("The browser could not preview this file. Try opening or downloading the saved original; the archive has not been changed.");
  }
  return (
    <section className={`${styles.page} ${embedded ? styles.embedded : ""}`} aria-label="Account documents" data-testid="retained-documents-page">
      <div className={styles.tools}>
        {!embedded && (onBack ? <button type="button" onClick={onBack} className={styles.breadcrumb}>← <span>Customers</span> / {customer?.name ?? "Account documents"}</button> : <span className={styles.breadcrumb}>Private customer documents</span>)}
        <button type="button" disabled={busy} onClick={() => void perform(() => backfill({token,accountId:accountId as any}), "Archive recovery started. Saved files will appear here as processing finishes.")} className={styles.primary}>↻ <span>Recover archives</span></button>
      </div>
      {customer && !embedded && <div className={styles.profile}>
        {customer.avatarUrl ? <SmartImage src={customer.avatarUrl} alt="" className={styles.avatar} /> : <span className={styles.avatar}>{customer.name.slice(0,1).toUpperCase()}</span>}
        <div className={styles.identity}><div><h2>{customer.name}</h2><span className={customer.verified ? styles.good : styles.pending}>{customer.verified ? "✓ Verified customer" : "Verification pending"}</span></div><p>{customer.email}</p></div>
        <nav aria-label="Customer profile sections">{["Overview","Rentals","Conversations","Documents","Notes"].map(name => <button type="button" key={name} aria-pressed={name === "Documents"} onClick={() => onSection?.(name.toLowerCase())}>{name}</button>)}</nav>
      </div>}
      <div className={styles.stats}>
        <div><DocumentIcon /><p><strong>{archives === undefined ? "…" : savedCount}</strong><span>{retentionNeedsReview ? "accessible" : "saved"} document{savedCount === 1 ? "" : "s"}</span></p></div>
        <div><span className={styles.shield}><DocumentIcon type="shieldCheck" /></span><p><strong>{unhealthy ? "Documents need attention" : savedCount ? "Documents saved" : "Awaiting documents"}</strong><span>{retentionNeedsReview ? "Retention review required" : unhealthy ? "Repair incomplete or missing copies" : "Private copies linked to this account"}</span></p></div>
        <div><span className={styles.lock}><DocumentIcon type="lock" /></span><p><strong>{active ? "Retention protected" : selectedArchive?.retention.viewable ? "Within retention" : "Retention status"}</strong><span>{active ? "Active rentals keep documents available" : "90 days after rental closure"}</span></p></div>
      </div>
      <div className={styles.retentionStrip}>
        <span className={styles.shield}><DocumentIcon type="shield" /></span><div><strong>Retained during the rental and normally for 90 days after closure.</strong><p>Open cases extend retention; uncertain records require review.</p></div>
        <ol aria-label="Document retention timeline">{["Uploaded","Saved","Rental active","Closed","90-day retention"].map((name,i) => <li key={name} className={i === 0 && allFiles.length || i === 1 && savedCount || i === 2 && active ? styles.reached : ""}><span/><strong>{name}</strong><small>{i === 0 && allFiles[0] ? shortDate(Math.min(...allFiles.map(d => d.savedAt))) : i === 1 && selectedArchive?.completedAt ? shortDate(selectedArchive.completedAt) : i === 2 && active ? "Active" : i === 4 && selectedArchive?.retention.expiresAt ? shortDate(selectedArchive.retention.expiresAt) : "—"}</small></li>)}</ol>
      </div>
      <DocumentReadinessCard archives={archives} verified={verified ?? customer?.verified ?? false} verificationExpiresAt={verificationExpiresAt} />
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      <div className={styles.columns}>
        <section className={styles.library} aria-label="Saved documents">
          <header><h3>Saved documents</h3><label className={styles.search}><span>⌕</span><input type="search" aria-label="Search documents" placeholder="Search documents…" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Filter documents" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All documents</option><option value="saved">Saved copies</option><option value="attention">Needs attention</option></select></header>
          {archives === undefined ? <p role="status" className={styles.empty}>Loading retained documents…</p> : !files.length ? <p className={styles.empty}>{allFiles.length ? "No documents match this search." : "No saved documents yet. Recover archived verification files or wait for the renter’s upload."}</p> : <ul>{files.map(document => <li key={document.id} className={selectedFile?.id === document.id ? styles.selected : ""}>
            <button type="button" className={styles.fileIdentity} onClick={() => {setSelectedDocument(document.id); if(document.available) void view(document);}} aria-label={`Select ${documentTitle(document.kind)}`}>
              <PrivateDocumentThumb key={`${accountId}:${document.id}`} token={token} accountId={accountId} document={document} />
              <span><strong>{documentTitle(document.kind)}</strong><small>{document.contentType === "application/pdf" ? "PDF" : document.contentType.split("/")[1].toUpperCase()} · {document.size >= 1024 * 1024 ? (document.size / (1024 * 1024)).toFixed(1) + " MB" : Math.ceil(document.size / 1024) + " KB"}</small><small>Uploaded {shortDate(document.savedAt)}</small></span>
            </button>
            <div className={styles.fileStatus}><span className={document.available ? styles.good : styles.pending}>{document.available ? "✓ Saved" : "needsReview" in document.archive.retention && document.archive.retention.needsReview ? "Retention needs review" : document.archive.retention.viewable ? "Copy unavailable" : "Retention ended"}</span><small>{document.archive.source === "drone" ? "Operator licence" : "Didit verification"}</small></div>
            <span className={styles.rental}>↗ {document.archive.bookingId.slice(-8)}</span>
          </li>)}</ul>}
          {currentArchives.filter(a => a.status !== "deleted" && a.retention.viewable && !a.copiesReady).map(archive => <div key={archive._id} className={styles.repair}><strong>{archive.status === "complete" ? "Saved copies need repair" : archive.status === "attention" ? "Archive needs attention" : "Saving documents"}</strong><p>{archive.source === "drone" ? "Ask the renter to upload a current licence copy through their rental." : archive.error ?? "Verification files must finish saving before handover."}</p>{archive.source !== "drone" && <button type="button" disabled={busy} onClick={() => void perform(() => retry({token,archiveId:archive._id}))}>{archive.status === "complete" ? "Repair document archive" : "Retry document archive"} →</button>}</div>)}
          {currentArchives.filter(a=>a.status==="complete" && a.retention.viewable && a.supplementalStatus && a.supplementalStatus!=="complete").map(archive=><div key={`extra-${archive._id}`} className={styles.repair}><strong>{archive.supplementalStatus==="pending"?"Saving additional verification images":"Additional verification images need attention"}</strong><p>{archive.supplementalError ?? "Checking available selfie and face-match images without interrupting saved documents."}</p>{archive.supplementalStatus==="attention" && <button type="button" disabled={busy} onClick={()=>void perform(()=>retryImages({token,archiveId:archive._id}))}>Retry image recovery →</button>}</div>)}
        </section>
        <section className={styles.preview} aria-label="Document preview">
          <header><h3>{selectedFile ? documentTitle(selectedFile.kind) : "Document preview"}</h3><span className={styles.private}><DocumentIcon type="lock" /> Private document</span></header>
          <div className={styles.previewCanvas}>
            {preview && preview.accountId === accountId && preview.token === token && preview.documentId === selectedFile?.id ? preview.type === "application/pdf" ? <iframe src={preview.url} title={preview.title} onError={failedPreview} /> : <img src={preview.url} alt={preview.title} onError={failedPreview} /> : <div className={styles.previewEmpty}><DocumentIcon /><strong>{busy ? "Opening private document…" : selectedFile?.available ? "Open the saved original" : "No available preview"}</strong><p>{selectedFile?.available ? "Select a document to securely view its saved copy." : "Files become viewable once their private archive is complete."}</p></div>}
          </div>
          {selectedFile && <div className={styles.original}><div><strong>{selectedFile.available ? "Original file saved" : "Copy unavailable"}</strong><small>{selectedFile.contentType === "application/pdf" ? "PDF" : "Image"} · {Math.ceil(selectedFile.size / 1024)} KB</small><small>Linked to {customer?.name ?? "this account"} · {selectedFile.archive.bookingId.slice(-8)}</small></div>{selectedFile.available && <div><button type="button" disabled={busy} onClick={() => void view(selectedFile,"open")}>↗ Expand preview</button><button type="button" disabled={busy} className={styles.primary} aria-label={`Download ${documentTitle(selectedFile.kind)}`} onClick={() => void view(selectedFile,true)}>↓ Download copy</button></div>}</div>}
          <div className={styles.retention}><h4>Retention</h4>{selectedArchive ? <>
            <dl><div><dt>Current rental</dt><dd>{selectedArchive.retention.permanent ? "Identity-safety hold" : "needsReview" in selectedArchive.retention && selectedArchive.retention.needsReview ? "Needs review" : selectedArchive.retention.activeRentals ? "Active" : selectedArchive.retention.status === "unknown-closure" ? "Closure not recorded" : "Closed"}</dd></div><div><dt>Deletion date</dt><dd>{selectedArchive.retention.permanent ? "Permanent admin archive" : "reviewWindowEligible" in selectedArchive.retention && selectedArchive.retention.reviewWindowEligible ? selectedArchive.retention.expiresAt ? `Review until ${shortDate(selectedArchive.retention.expiresAt)}` : "Starts at next retention sweep" : "needsReview" in selectedArchive.retention && selectedArchive.retention.needsReview ? "Paused for review" : selectedArchive.retention.expiresAt ? shortDate(selectedArchive.retention.expiresAt) : selectedArchive.retention.activeRentals ? "Set after return" : selectedArchive.retention.openCases ? "After open case closes" : "Awaiting closure"}</dd></div></dl>
            {selectedArchive.retention.permanent && <p>Kept for repeat-identity review. Admin access only; matches still require human review.</p>}
            {(selectedArchive.retention.status === "deleted" || !selectedArchive.retention.viewable || !!selectedArchive.retention.openCases) && <p>{selectedArchive.retention.status === "deleted" ? "File bytes have been removed." : "needsReview" in selectedArchive.retention && selectedArchive.retention.needsReview ? "Retention needs review. These copies are protected from deletion but cannot be opened until reviewed." : !selectedArchive.retention.viewable ? "Retention ended. These documents cannot be viewed or reopened." : "An open internal damage case preserves these copies. It does not file an insurer claim."}</p>}
            {"reviewDetails" in selectedArchive.retention && selectedArchive.retention.reviewDetails && <div className={`${styles.repair} ${styles.reviewDetails}`}><strong>Case dates need investigation</strong><p>Check the original case evidence. Copies stay available until the review deadline above, then are deleted if unresolved.</p><dl><div><dt>Rental ID</dt><dd>{selectedArchive.retention.reviewDetails.bookingId}</dd></div><div><dt>Case ID</dt><dd>{selectedArchive.retention.reviewDetails.caseId}</dd></div><div><dt>Opened</dt><dd>{reviewTimestamp(selectedArchive.retention.reviewDetails.openedAt)}</dd></div><div><dt>Closed</dt><dd>{reviewTimestamp(selectedArchive.retention.reviewDetails.closedAt)}</dd></div></dl>{onRental && <button type="button" onClick={() => {const retention=selectedArchive.retention;if("reviewDetails" in retention && retention.reviewDetails)onRental(retention.reviewDetails.bookingId);}}>Open linked rental →</button>}</div>}
            {selectedArchive.retention.status === "unknown-closure" && <RetentionReviewControls token={token} accountId={accountId} archive={selectedArchive} />}
            {selectedArchive.retentionHoldReason && <div className={styles.repair}><strong>Legacy manual hold</strong><p>Old note: {selectedArchive.retentionHoldReason}</p><p>This override no longer changes retention. Active rentals and linked open cases control deletion.</p><button type="button" disabled={busy} onClick={() => setHoldEditor({archiveId:selectedArchive._id,expectedReason:selectedArchive.retentionHoldReason ?? "",expectedRevision:selectedArchive.retentionHoldRevision ?? 0})}>Clear old hold</button></div>}
            {holdEditor?.archiveId === selectedArchive._id && <form onSubmit={event => {event.preventDefault();const origin=scope.current;void perform(async()=>{await retentionHold({token,archiveId:selectedArchive._id,reason:"",expectedReason:holdEditor.expectedReason,expectedRevision:holdEditor.expectedRevision,confirmed:true});if(origin===scope.current)setHoldEditor(null);},"Legacy override cleared. The rental and open-case schedule remains in effect.");}}><p>Clear the legacy override. The rental and open-case schedule remains in effect.</p><button disabled={busy || !holdEditor.expectedReason} type="submit" className={styles.primary}>Clear legacy hold</button><button type="button" onClick={() => setHoldEditor(null)}>Cancel</button></form>}
          </> : <p>No document archive is linked to this account yet.</p>}</div>
        </section>
      </div>
      <dialog ref={originalDialog} className={styles.originalDialog} aria-label="Saved original document" onCancel={()=>setOriginalOpen(false)} onClose={()=>setOriginalOpen(false)}>
        {preview && preview.accountId===accountId && preview.token===token && <><header><h3>{preview.title}</h3><button type="button" onClick={()=>setOriginalOpen(false)} aria-label="Close original document">×</button></header>{preview.type==="application/pdf" ? <iframe src={preview.url} title={preview.title} onError={failedPreview} /> : <img src={preview.url} alt={preview.title} onError={failedPreview} />}</>}
      </dialog>
      <footer className={styles.activity}><h3>◷ Recent activity</h3>{[...allFiles].sort((a,b)=>b.savedAt-a.savedAt).slice(0,3).map(d => <div key={d.id}><DocumentIcon /><span><strong>Document saved</strong><small>{documentTitle(d.kind)} · {shortDate(d.savedAt)}</small></span></div>)}<span className={styles.private}><DocumentIcon type="lock" /> Admin access only · Downloads are logged</span></footer>
    </section>
  );
}

function RetentionReviewControls({token,accountId,archive}:{token:string;accountId:string;archive:any}) {
  const startReview=useMutation(api.verificationRetentionReview.start);
  const repairLink=useMutation(api.verificationRetentionReview.repairLink);
  const [reason,setReason]=useState("");
  const [linkReason,setLinkReason]=useState("");
  const [cursor,setCursor]=useState<string|null>(null);
  const [candidateRows,setCandidateRows]=useState<any[]>([]);
  const [replacementBookingId,setReplacementBookingId]=useState("");
  const review=archive.retentionReview;
  const candidates=useQuery(api.verificationRetentionReview.candidates,review?.state==="needs_link"?{token,archiveId:archive._id,cursor}:"skip");
  useEffect(()=>{setCursor(null);setCandidateRows([]);setReplacementBookingId("");setReason("");setLinkReason("");},[archive._id]);
  useEffect(()=>{
    if(!candidates)return;
    setCandidateRows(current=>{
      const rows=cursor===null?[]:[...current];
      const seen=new Set(rows.map(row=>String(row.bookingId)));
      for(const row of candidates.candidates)if(!seen.has(String(row.bookingId))){rows.push(row);seen.add(String(row.bookingId));}
      return rows;
    });
  },[candidates,cursor]);
  const status=review?.state??"not_started";
  const canStart=status!=="running"&&status!=="needs_link"&&status!=="complete";
  const progress=review?`${review.linkedRentals} rentals · ${review.casesScanned} cases`:"Checks every linked rental and case in pages of 25.";
  return <section className={styles.repair} aria-label="Full verification retention history review">
    <strong>Full rental history</strong>
    <p>{status==="running"?`Scanning safely · ${progress}`:status==="complete"?`History checked · ${progress}`:status==="needs_link"?"A linked rental record is missing. Link the exact same-account rental to continue.":status==="attention"?review?.error??"History could not be reconciled safely. Documents remain protected.":status==="stale"?"Rental or case history changed. Restart the scan to refresh it.":archive.retention.reviewReason??"History exceeds the quick review limit. Start a full paginated scan."}</p>
    {review?.state==="running"&&<p role="status">The scan resumes automatically. Documents stay protected until all pages finish.</p>}
    {review?.state==="complete"&&<p role="status">No active rentals or open linked cases were missed. Real closure dates still control the 90-day deletion date.</p>}
    {review?.state==="needs_link"&&<div>
      <label>Same-account rental<select aria-label="Replacement rental" value={replacementBookingId} onChange={event=>setReplacementBookingId(event.target.value)}><option value="">Choose a matching rental</option>{candidateRows.map(row=><option key={row.bookingId} value={row.bookingId}>{row.title} · {String(row.bookingId).slice(-8)} · {row.status}</option>)}</select></label>
      {candidates?.more&&<button type="button" onClick={()=>setCursor(candidates.cursor)}>More matching rentals</button>}
      <label>Why is this the correct link?<input value={linkReason} minLength={10} maxLength={400} onChange={event=>setLinkReason(event.target.value)} placeholder="Brief audit reason" /></label>
      <button type="button" disabled={!replacementBookingId||linkReason.trim().length<10} onClick={()=>void repairLink({token,archiveId:archive._id,generation:review.generation,missingBookingId:review.missingBookingId, ...(review.orphanLinkId?{orphanLinkId:review.orphanLinkId}:{}),replacementBookingId:replacementBookingId as any,reason:linkReason})}>Link and rescan</button>
    </div>}
    {canStart&&<div><label>Review reason<input value={reason} minLength={10} maxLength={400} onChange={event=>setReason(event.target.value)} placeholder="Why this history needs reconciliation" /></label><button type="button" disabled={reason.trim().length<10} onClick={()=>void startReview({token,archiveId:archive._id,accountId:accountId as any,reason})}>Scan full history</button></div>}
    <small>Admin only. Each rental and case is checked against current records. No closure date is invented and there is no manual clear or retention override.</small>
  </section>;
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
