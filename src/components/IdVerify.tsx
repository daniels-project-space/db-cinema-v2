"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { IconCheck } from "@/components/icons";

const LABEL: Record<string, string> = {
  required: "Verify your identity, selfie and address",
  processing: "Your documents are being checked automatically",
  manual_review: "Your documents need a human review — we will contact you",
  requires_input: "A document needs replacing — follow the instructions below",
  rejected: "Verification could not be completed — contact us for review",
  verified: "Identity and address verified",
};

export function IdVerify({ bookingId, status, note, compact, autoStart = false, checkoutSessionId }: {
  bookingId: string;
  status: string;
  note?: string | null;
  compact?: boolean;
  autoStart?: boolean;
  checkoutSessionId?: string | null;
}) {
  const account = useAccount();
  const getSession = useAction(api.didit.bookingSession);
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = useCallback(async () => {
    if (busy || sessionUrl) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await getSession({
        bookingId: bookingId as any,
        accountToken: account.token ?? undefined,
        checkoutSessionId: checkoutSessionId ?? undefined,
      });
      setSessionUrl(result.url);
    }
    catch (e: any) { setErr(e?.message ?? "Could not open verification"); }
    finally { setBusy(false); }
  }, [busy, sessionUrl, getSession, bookingId, account.token, checkoutSessionId]);

  useEffect(() => {
    if (autoStart && status !== "verified" && status !== "rejected") void open();
  }, [autoStart, status, open]);

  if (status === "verified")
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300"><IconCheck className="h-3 w-3" /> Identity and address verified</span>;

  return (
    <div className={compact ? "" : "rounded-xl border border-accent-400/20 bg-accent-400/[0.06] p-4"}>
      <div className="text-sm text-white/70">{LABEL[status] ?? LABEL.required}</div>
      {note && (status === "requires_input" || status === "manual_review") && <p className="mt-1 text-xs text-amber-200">{note}</p>}
      {status === "processing" && <p className="mt-1 text-xs text-white/45">We will update this page when the provider completes its check. You can return later.</p>}
      {status === "manual_review" && <p className="mt-1 text-xs text-white/45">We will review this result and contact you if another document is needed.</p>}
      {status !== "rejected" && status !== "manual_review" && !sessionUrl && (
        <button onClick={() => void open()} disabled={busy} className="btn-primary mt-2 px-5 py-2 text-sm">
          {busy ? "Opening…" : status === "requires_input" ? "Replace requested document" : status === "processing" ? "Continue check" : "Start automatic check"}
        </button>
      )}
      {sessionUrl && status !== "rejected" && status !== "manual_review" && (
        <div className="mt-3 min-h-80">
          <iframe
            src={sessionUrl}
            title="Identity, selfie and address verification"
            allow="camera; microphone; fullscreen; autoplay; encrypted-media"
            className="h-[700px] w-full rounded-lg border-0 bg-white"
          />
          <p className="mt-2 text-xs text-white/45">Your result will update here automatically. If the camera does not open, <a href={sessionUrl} target="_blank" rel="noreferrer" className="underline">open verification in a new tab</a>.</p>
        </div>
      )}
      {err && <div className="mt-2 text-xs text-red-300">{err}</div>}
    </div>
  );
}
