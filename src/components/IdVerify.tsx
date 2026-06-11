"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { IconCheck } from "@/components/icons";

const LABEL: Record<string, string> = {
  required: "ID verification required",
  processing: "ID verification in progress",
  requires_input: "ID verification needs another try",
  verified: "ID verified",
  canceled: "ID verification cancelled",
};

export function IdVerify({
  bookingId,
  status,
  compact,
}: {
  bookingId: string;
  status: string;
  compact?: boolean;
}) {
  const create = useAction(api.identity.createSession);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (status === "verified")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
        <IconCheck className="h-3 w-3" /> ID verified
      </span>
    );
  if (status === "not_required")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs text-white/50">
        Secured by deposit — no ID check needed
      </span>
    );

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await create({ bookingId: bookingId as any, origin: window.location.origin });
      window.location.href = url;
    } catch (e: any) {
      setErr(e?.message ?? "Could not start verification");
      setBusy(false);
    }
  }

  return (
    <div className={compact ? "" : "rounded-xl border border-accent-400/20 bg-accent-400/[0.06] p-4"}>
      {!compact && (
        <div className="text-sm text-white/70">
          {LABEL[status] ?? "ID verification"}
        </div>
      )}
      <button
        onClick={go}
        disabled={busy}
        className="btn-primary mt-2 px-5 py-2 text-sm"
      >
        {busy ? "Opening…" : status === "processing" ? "Continue verification" : "Verify your ID"}
      </button>
      {err && <div className="mt-2 text-xs text-red-300">{err}</div>}
    </div>
  );
}
