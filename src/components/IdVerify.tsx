"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { IconCheck } from "@/components/icons";

const SumsubWebSdk = dynamic(() => import("@sumsub/websdk-react"), { ssr: false });

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
  const getToken = useAction(api.sumsub.bookingToken);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const refreshToken = useCallback(async () => {
    const result = await getToken({
      bookingId: bookingId as any,
      accountToken: account.token ?? undefined,
      checkoutSessionId: checkoutSessionId ?? undefined,
    });
    return result.token;
  }, [getToken, bookingId, account.token, checkoutSessionId]);

  const open = useCallback(async () => {
    if (busy || accessToken) return;
    setBusy(true);
    setErr(null);
    try { setAccessToken(await refreshToken()); }
    catch (e: any) { setErr(e?.message ?? "Could not open verification"); }
    finally { setBusy(false); }
  }, [busy, accessToken, refreshToken]);

  useEffect(() => {
    if (autoStart && status !== "verified" && status !== "rejected") void open();
  }, [autoStart, status, open]);

  if (status === "verified")
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300"><IconCheck className="h-3 w-3" /> Identity and address verified</span>;

  return (
    <div className={compact ? "" : "rounded-xl border border-accent-400/20 bg-accent-400/[0.06] p-4"}>
      <div className="text-sm text-white/70">{LABEL[status] ?? LABEL.required}</div>
      {note && status === "requires_input" && <p className="mt-1 text-xs text-amber-200">{note}</p>}
      {status === "processing" && <p className="mt-1 text-xs text-white/45">We will update this page when the provider completes its check. You can return later.</p>}
      {status === "manual_review" && <p className="mt-1 text-xs text-white/45">No further action is needed unless we ask for another document.</p>}
      {submitted && <p className="mt-1 text-xs text-white/45">Documents submitted. Waiting for the automatic result…</p>}
      {status !== "rejected" && status !== "manual_review" && !accessToken && (
        <button onClick={() => void open()} disabled={busy} className="btn-primary mt-2 px-5 py-2 text-sm">
          {busy ? "Opening…" : status === "requires_input" ? "Replace requested document" : status === "processing" ? "Continue check" : "Start automatic check"}
        </button>
      )}
      {accessToken && status !== "rejected" && status !== "manual_review" && (
        <div className="mt-3 min-h-80">
          <SumsubWebSdk
            accessToken={accessToken}
            expirationHandler={refreshToken}
            config={{ lang: "en", theme: "dark" }}
            options={{ addViewportTag: false, adaptIframeHeight: true }}
            onMessage={(type: string) => {
              if (type === "idCheck.onApplicantSubmitted" || type === "idCheck.onApplicantResubmitted") setSubmitted(true);
            }}
            onError={() => setErr("Verification could not load. Please retry.")}
          />
        </div>
      )}
      {err && <div className="mt-2 text-xs text-red-300">{err}</div>}
    </div>
  );
}
