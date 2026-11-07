"use client";

import { useEffect, useRef, useState } from "react";

export function AuthenticatedBookingDownload({ bookingId, token, kind, label, className, ariaLabel }: {
  bookingId: string;
  token: string;
  kind: "invoice" | "return" | "calendar";
  label: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const scope = JSON.stringify([bookingId, token, kind]);
  const currentScope = useRef(scope);
  currentScope.current = scope;

  useEffect(() => {
    setBusy(false);
    setError(false);
    return () => { request.current?.abort(); request.current = null; };
  }, [scope]);

  async function download() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(false);
    try {
      const calendar = kind === "calendar";
      const path = calendar ? "booking-ics" : "invoice";
      const suffix = kind === "return" ? "?phase=return" : "";
      const response = await fetch(`/api/${path}/${encodeURIComponent(bookingId)}${suffix}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (!response.ok || type !== (calendar ? "text/calendar" : "application/pdf")) throw new Error("Download unavailable");
      const blob = await response.blob();
      if (controller.signal.aborted || currentScope.current !== scope) return;
      if (!blob.size) throw new Error("Download unavailable");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `DB-Cinema-${kind}-${bookingId.slice(-8)}.${calendar ? "ics" : "pdf"}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      if (!controller.signal.aborted && currentScope.current === scope) setError(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return <span className="inline-flex flex-wrap items-center gap-2">
    <button type="button" onClick={download} disabled={busy} aria-label={ariaLabel} aria-busy={busy} className={className}>{busy ? "Preparing…" : label}</button>
    {busy && <span role="status" className="sr-only">Preparing download.</span>}
    {error && <span role="alert" className="text-xs text-rose-300">Could not download. Please try again.</span>}
  </span>;
}
