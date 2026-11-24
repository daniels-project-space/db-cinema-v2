"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { IconCheck } from "@/components/icons";
import styles from "./IdVerify.module.css";
import { getDiditEmbeddedUrl, getDiditLayoutHeight, getDiditStandaloneUrl } from "@/lib/diditEmbed";
import { diditRenterOpenFailure } from "@/lib/diditRenterError";
import { customerDiditFailureNote, customerDiditRetryAvailable, DIDIT_DOCUMENT_EXPIRED } from "../../shared/diditFailureReason";

const LABEL: Record<string, string> = {
  required: "Verify your identity, selfie and address",
  processing: "Verification in progress",
  manual_review: "Your verification needs review",
  requires_input: "A document needs replacing — follow the instructions below",
  rejected: "Verification could not be completed",
  verified: "Identity and address verified",
};

type IdVerifyProps = {
  bookingId: string;
  status: string;
  note?: string | null;
  compact?: boolean;
  autoStart?: boolean;
  checkoutSessionId?: string | null;
};

export function IdVerify(props: IdVerifyProps) {
  const account = useAccount();
  // A provider URL belongs to one renter, rental and upload attempt. Remount
  // before showing a different context, including replacement documents.
  return <IdVerifySession key={JSON.stringify([props.bookingId, account.token, props.checkoutSessionId])} {...props} accountToken={account.token} />;
}

function IdVerifySession({ bookingId, status, note, compact, autoStart = false, checkoutSessionId, accountToken }: IdVerifyProps & {accountToken: string | null}) {
  const getSession = useAction(api.didit.bookingSession);
  const retryRejected = useAction(api.didit.retryRejected);
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState(700);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [retryAllowed, setRetryAllowed] = useState(true);
  const [reused, setReused] = useState(false);
  const [waitingForBookingId, setWaitingForBookingId] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const [showFrameOptions, setShowFrameOptions] = useState(false);
  const mounted = useRef(false);
  const flight = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const attempted = useRef<string | null>(null);
  useEffect(() => { setSessionUrl(null); setErr(null); setRetryAllowed(true); setFrameHeight(700); attempted.current = null; }, [bookingId]);
  const previousStatus = useRef(status);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (status === "manual_review" || status === "rejected" || (status === "requires_input" && previous !== "rejected")) {
      setSessionUrl(null); setRetryAllowed(true); setFrameHeight(700); attempted.current = null;
    }
  }, [status]);
  useEffect(() => {
    if (!sessionUrl) return;
    const onMessage = (event: MessageEvent) => {
      const height = getDiditLayoutHeight(event, iframeRef.current?.contentWindow ?? null);
      if (height !== null) setFrameHeight(height);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sessionUrl]);

  const open = useCallback(async () => {
    if (flight.current || sessionUrl || reused) return;
    flight.current = true;
    setBusy(true);
    setErr(null);
    setRetryAllowed(true);
    setUpdated(false);
    setWaitingForBookingId(null);
    try {
      const shouldResubmit = status === "rejected" || (status === "requires_input" && note === DIDIT_DOCUMENT_EXPIRED);
      const result = await (shouldResubmit ? retryRejected : getSession)({
        bookingId: bookingId as any,
        accountToken: accountToken ?? undefined,
        checkoutSessionId: checkoutSessionId ?? undefined,
      });
      if (!mounted.current) return;
      if ("reused" in result && result.reused) setReused(true);
      else if ("waitingForBookingId" in result && result.waitingForBookingId) setWaitingForBookingId(result.waitingForBookingId);
      else if ("updated" in result && result.updated) setUpdated(true);
      else if (result.url) {
        const embeddedUrl = getDiditEmbeddedUrl(result.url);
        if (embeddedUrl) setSessionUrl(embeddedUrl);
        else { setErr("We couldn’t open a secure verification link. No new payment was taken. Contact the team below."); setRetryAllowed(false); }
      }
      else { const failure = diditRenterOpenFailure(null); setErr(failure.message); setRetryAllowed(failure.retryable); }
    }
    catch (error) { if (mounted.current) { const failure = diditRenterOpenFailure(error); setErr(failure.message); setRetryAllowed(failure.retryable); } }
    finally { flight.current = false; if (mounted.current) setBusy(false); }
  }, [sessionUrl, reused, getSession, retryRejected, status, note, bookingId, accountToken, checkoutSessionId]);

  useEffect(() => {
    const key = bookingId;
    if (autoStart && attempted.current !== key && !["verified", "rejected", "manual_review"].includes(status)) { attempted.current = key; void open(); }
  }, [autoStart, status, bookingId, open]);

  if (status === "verified")
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300"><IconCheck className="h-3 w-3" /> Identity and address verified</span>;

  const restart = status === "requires_input" && /expired|not completed/i.test(note ?? "");
  const canRetry = customerDiditRetryAvailable(status, note);

  return (
    <div className={compact ? "" : "rounded-xl border border-accent-400/20 bg-accent-400/[0.06] p-4"}>
      {!compact && <div className="text-sm text-white/70">{restart ? "Verification needs restarting" : LABEL[status] ?? LABEL.required}</div>}
      {note && (status === "requires_input" || status === "manual_review") && <p className="mt-1 text-xs text-amber-200">{note}</p>}
      {status === "rejected" && customerDiditFailureNote(note) && <p className="mt-1 text-xs text-amber-200">{customerDiditFailureNote(note)}</p>}
      {status === "processing" && <p className="mt-1 text-xs text-white/45">Continue verification if any steps remain. This page updates when a result is available.</p>}
      {status === "manual_review" && <p className="mt-1 text-xs text-white/45">Message the team if you need an update on this review.</p>}
      {status === "rejected" && canRetry && <p className="mt-1 text-xs text-white/60">Try the unsuccessful steps again. Approved steps stay saved; some results may need a team review. If a retry is available, we’ll also email you a secure link.</p>}
      {reused && <p role="status" className="mt-2 text-sm text-emerald-300">Your recent verification has been reused. We’re updating your rental progress.</p>}
      {updated && <p role="status" className="mt-2 text-sm text-emerald-300">We checked your existing verification. Your rental progress is updating.</p>}
      {waitingForBookingId && <div role="status" className="mt-2 rounded-xl border border-white/10 bg-white/[.04] p-3 text-sm text-white/75">
        <p>Your identity check is underway for another paid rental. This booking is still waiting for Didit approval; it has not been approved by the in-progress check.</p>
        <Link href={`/account?rental=${encodeURIComponent(waitingForBookingId)}#verification`} className="mt-2 inline-block underline underline-offset-4">Open that rental’s verification</Link>
      </div>}
      {status !== "manual_review" && canRetry && !sessionUrl && !reused && retryAllowed && (
        <button onClick={() => void open()} disabled={busy} className="btn-primary mt-2 px-5 py-2 text-sm">
          {busy ? "Opening…" : waitingForBookingId ? "Check status" : status === "rejected" ? "Try verification again" : err ? "Try again" : updated ? "Check again" : restart ? "Restart verification" : status === "requires_input" ? "Replace requested document" : "Continue verification"}
        </button>
      )}
      {sessionUrl && status !== "manual_review" && (
        <div className={styles.frameShell}>
          <div className={styles.mobileBar}>
            <a href={getDiditStandaloneUrl(sessionUrl) ?? sessionUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={styles.mobileStandaloneLink} data-testid="didit-mobile-standalone" aria-label="Open Didit verification in a new browser tab">Open in browser ↗</a>
            <button type="button" onClick={() => setShowFrameOptions(value => !value)} className={styles.mobileOptionsButton} aria-label="Verification options" aria-expanded={showFrameOptions}>⋯</button>
            {showFrameOptions && <div className={styles.mobileMenu}>
              <button type="button" onClick={() => { setSessionUrl(null); setFrameHeight(700); setShowFrameOptions(false); }}>Back to rental</button>
              <a href={getDiditStandaloneUrl(sessionUrl) ?? sessionUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={() => setShowFrameOptions(false)}>Open in new tab</a>
            </div>}
          </div>
          <iframe
            ref={iframeRef}
            src={sessionUrl}
            title="Identity, selfie and address verification"
            allow="camera; microphone; geolocation; clipboard-write; fullscreen; autoplay; encrypted-media; digital-credentials-get"
            className={styles.frame}
            style={{ "--didit-content-height": `${frameHeight}px` } as CSSProperties}
          />
          <p className={styles.fallback}>Your result will update here automatically. If the camera does not open, <a href={getDiditStandaloneUrl(sessionUrl) ?? sessionUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="underline">open verification in a new tab</a>.</p>
        </div>
      )}
      {err && <div role="alert" className="mt-2 text-xs text-red-300"><p>{err}</p><Link href={`/account?rental=${encodeURIComponent(bookingId)}#chat`} className="mt-2 inline-block underline underline-offset-4">Open this rental’s chat</Link></div>}
    </div>
  );
}
