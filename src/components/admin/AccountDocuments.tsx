"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

function documentTitle(kind: string) {
  return kind.startsWith("address-") ? "Proof of address" : kind.includes("back") ? "Proof of identity · back" : "Proof of identity · front";
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
  const files = (archives ?? [])
    .filter((a) => a.status !== "deleted")
    .flatMap((a) =>
      a.documents.map((d) => ({ ...d, complete: a.status === "complete" })),
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
}: {
  token: string;
  accountId: string;
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
      accountId: string;
      token: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const activeUrl = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const scope = useRef(0);
  const [holdEditor, setHoldEditor] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState("");
  useEffect(() => {
    scope.current++;
    request.current?.abort();
    request.current = null;
    setPreview(null);
    setError("");
    setBusy(false);
    setHoldEditor(null);
    setHoldReason("");
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
  async function view(document: {
    id: string;
    kind: string;
    contentType: string;
  }) {
    const currentScope = scope.current;
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
      if (!response.ok)
        throw Error(
          "Document could not be opened. Please retry or check admin access.",
        );
      const blob = await response.blob();
      if (controller.signal.aborted || currentScope !== scope.current) return;
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
      const url = URL.createObjectURL(blob);
      activeUrl.current = url;
      setPreview({ url, type: document.contentType, title: documentTitle(document.kind), accountId, token });
    } catch (e) {
      if (!controller.signal.aborted && currentScope === scope.current)
        setError(e instanceof Error ? e.message : "Could not open document.");
    } finally {
      if (currentScope === scope.current) setBusy(false);
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
    <section
      className="mt-6 border-t border-white/10 pt-5"
      aria-label="Account documents"
    >
      <h4 className="text-sm font-semibold text-white">
        Documents · retained verification copies
      </h4>
      <p className="mt-2 text-xs leading-5 text-white/50">
        Copies saved in DB Cinema storage and linked to this account and rental.
        Every document view requires admin access and is logged.
      </p>
      <p className="mt-2 text-xs text-white/50">
        Retained during the rental and for 30 days after closure. Open insurance
        cases can preserve copies until the hold is removed.
      </p>
      <button
        disabled={busy}
        onClick={() => void perform(() => backfill({ token, accountId: accountId as any }))}
        className="mt-3 text-xs text-accent-300"
      >
        Archive existing verifications
      </button>
      {archives === undefined ? (
        <p className="mt-3 text-xs text-white/50">Loading documents…</p>
      ) : !archives.length ? (
        <p className="mt-3 text-xs text-amber-200">
          No archived verification documents yet.
        </p>
      ) : (
        archives.map((archive) => (
          <div
            key={archive._id}
            className="mt-4 rounded-xl border border-white/10 p-3"
          >
            <p className="text-xs text-white/70">
              Rental {archive.bookingId.slice(-8)} ·{" "}
              {archive.status === "deleted"
                ? "Files deleted after retention period"
                : archive.status === "complete"
                  ? "Archive complete"
                  : archive.status === "attention"
                    ? "Archive needs attention"
                    : "Saving documents"}
            </p>
            <p className="mt-2 text-xs leading-5 text-white/50">
              {archive.retention.status === "deleted" ? "Retention ended. File bytes have been removed." :
                archive.retention.status === "active-rental" ? `Preserved for ${archive.retention.activeRentals} active rental${archive.retention.activeRentals === 1 ? "" : "s"}. The 30-day period begins after closure.` :
                archive.retention.status === "insurance-case" ? `Preserved for ${archive.retention.openCases} open damage or insurance case${archive.retention.openCases === 1 ? "" : "s"}.` :
                archive.retention.status === "manual-hold" ? "Preserved under an admin insurance hold." :
                archive.retention.status === "unknown-closure" ? "Preserved until the rental closure date is confirmed." :
                `${archive.retention.viewable ? "Retained until" : "Retention ended on"} ${new Date(archive.retention.expiresAt!).toLocaleString("en-GB")}.${archive.retention.viewable ? "" : " File removal is pending; document access has ended."}`}
            </p>
            {archive.retentionHoldReason && <p className="mt-2 rounded-lg border border-amber-200/15 bg-amber-200/5 p-3 text-xs leading-5 text-amber-100/80">Insurance hold: {archive.retentionHoldReason}</p>}
            {archive.status !== "deleted" && (
              <div className="mt-3">
                {archive.retentionHoldReason ? (
                  <button disabled={busy} onClick={() => void perform(() => retentionHold({ token, archiveId: archive._id, reason: "" }))} className="text-xs text-white/60 disabled:opacity-30">Remove admin insurance hold</button>
                ) : holdEditor === archive._id ? (
                  <form onSubmit={event => {
                    event.preventDefault();
                    const currentScope = scope.current;
                    void perform(async () => {
                      await retentionHold({ token, archiveId: archive._id, reason: holdReason.trim() });
                      if (currentScope === scope.current) { setHoldEditor(null); setHoldReason(""); }
                    });
                  }} className="rounded-lg border border-white/10 bg-white/[.025] p-3">
                    <label className="block text-xs text-white/70">Insurance or damage case reason
                      <textarea required minLength={10} maxLength={500} value={holdReason} onChange={event => setHoldReason(event.target.value)} className="mt-2 block min-h-20 w-full rounded-lg border border-white/15 bg-black/20 p-3 text-xs text-white" />
                    </label>
                    <p className="mt-2 text-[11px] text-white/45">Copies remain preserved until this hold is removed. Active rentals and open cases preserve them separately.</p>
                    <div className="mt-3 flex gap-4">
                      <button disabled={busy || holdReason.trim().length < 10} className="text-xs text-accent-300 disabled:opacity-30">Save insurance hold</button>
                      <button type="button" disabled={busy} onClick={() => { setHoldEditor(null); setHoldReason(""); }} className="text-xs text-white/50">Cancel</button>
                    </div>
                  </form>
                ) : <button disabled={busy} onClick={() => { setHoldEditor(archive._id); setHoldReason(""); }} className="text-xs text-white/60 disabled:opacity-30">Preserve for an insurance case</button>}
                {!!archive.retention.openCases && <p className="mt-2 text-[11px] text-white/45">Open cases must be closed through the rental controls before their automatic retention ends.</p>}
              </div>
            )}
            {!["complete", "deleted"].includes(archive.status) && (
              <>
                <p className="mt-2 text-xs text-amber-200">
                  {archive.error ??
                    "Provider documents are being copied. Do not rely on this archive until it is complete."}
                </p>
                <button
                  disabled={busy}
                  onClick={() => void perform(() => retry({ token, archiveId: archive._id }))}
                  className="mt-2 text-xs text-accent-300"
                >
                  Retry document archive
                </button>
              </>
            )}
            <ul className="mt-3 space-y-2">
              {archive.documents.map((document) => (
                <li
                  key={document.id}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-white/60">
                    {documentTitle(document.kind)} ·{" "}
                    {Math.ceil(document.size / 1024)} KB
                  </span>
                  {archive.retention.viewable && (
                    <button
                      disabled={busy}
                      onClick={() => void view(document)}
                      className="text-accent-300 disabled:opacity-30"
                    >
                      View document ↗
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-rose-200">
          {error}
        </p>
      )}
      {preview && preview.accountId === accountId && preview.token === token && (
        <div className="mt-4 rounded-xl border border-white/15 p-3">
          <div className="flex justify-between text-xs text-white">
            <span>{preview.title}</span>
            <button
              onClick={() => {
                request.current?.abort();
                request.current = null;
                setBusy(false);
                setPreview(null);
                if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
                activeUrl.current = null;
              }}
            >
              Close
            </button>
          </div>
          {preview.type === "application/pdf" ? (
            <iframe
              src={preview.url}
              title={preview.title}
              className="mt-3 h-96 w-full"
            />
          ) : (
            <img
              src={preview.url}
              alt={preview.title}
              className="mt-3 max-h-96 w-full object-contain"
            />
          )}
          <a
            href={preview.url}
            download={preview.title}
            className="mt-3 inline-block text-xs text-accent-300"
          >
            Download retained copy
          </a>
        </div>
      )}
    </section>
  );
}
