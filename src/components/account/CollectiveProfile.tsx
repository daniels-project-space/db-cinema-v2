"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { IconCheck } from "@/components/icons";

/**
 * Creative Collective member panel. Appears on /account when the signed-in
 * email has an approved (or pending) application. While approved-but-incomplete
 * it GLOWS and walks the member through payout bank details + ID verification
 * to make the account "fully operational".
 */
export function CollectiveProfile() {
  const account = useAccount();
  const token = account.token ?? undefined;
  const m = useQuery(api.collective.myMembership, token ? { token } : "skip");
  if (!m) return null;

  const kindLabel = m.kind === "gear-provider" ? "Gear provider" : m.roleLabel || "Professional";

  if (m.status === "pending") {
    return (
      <section className="mt-8 spot gradient-border rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-white/80">Creative Collective</h2>
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/60">Under review</span>
        </div>
        <p className="mt-2 text-sm text-white/50">
          Your {kindLabel.toLowerCase()} application is with our team. We&apos;ll email you once it&apos;s approved — then you can finish setup here.
        </p>
      </section>
    );
  }

  // approved
  if (m.operational) {
    return (
      <section className="mt-8 rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.06] p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-white/85">Creative Collective · {kindLabel}</h2>
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
            <IconCheck className="h-3 w-3" /> Fully operational
          </span>
        </div>
        <p className="mt-2 text-sm text-white/55">
          You&apos;re verified and set up for payouts. {m.kind === "gear-provider" ? "Your listings are live and you're paid out monthly." : "You're live on the crew roster — we'll route bookings to you."}
        </p>
      </section>
    );
  }

  return (
    <section className="glow-ring mt-8 rounded-2xl border border-accent-400/30 bg-accent-500/[0.05] p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-white/85">Creative Collective · {kindLabel}</h2>
        <span className="rounded-full bg-accent-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-accent-300">Approved — finish setup</span>
      </div>
      <p className="mt-2 text-sm text-white/55">
        Two quick steps to make your account fully operational and {m.kind === "gear-provider" ? "list your gear" : "go live on the roster"}.
      </p>

      <div className="mt-5 space-y-4">
        <BankStep done={m.bankProvided} last4={m.bankLast4} token={token!} />
        <IdStep verified={m.idVerified} token={token!} />
      </div>
    </section>
  );
}

function StepShell({
  n,
  title,
  done,
  badge,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  badge?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-500/20 text-emerald-300" : "bg-accent-500/20 text-accent-300"}`}>
          {done ? <IconCheck className="h-4 w-4" /> : n}
        </span>
        <span className="font-display text-sm font-semibold text-white/85">{title}</span>
        {badge && <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/55">{badge}</span>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function BankStep({ done, last4, token }: { done: boolean; last4: string | null; token: string }) {
  const save = useMutation(api.collective.saveBankDetails);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ accountName: "", sortCode: "", accountNumber: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await save({ token, ...f });
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (done && !open) {
    return (
      <StepShell n={1} title="Payout bank details" done badge={last4 ? `••• ${last4}` : "Saved"}>
        <button onClick={() => setOpen(true)} className="text-xs text-accent-300 hover:underline">Update details</button>
      </StepShell>
    );
  }

  return (
    <StepShell n={1} title="Payout bank details" done={false}>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input w-full sm:col-span-2" value={f.accountName} onChange={(e) => set("accountName", e.target.value)} placeholder="Account holder name" />
        <input className="input w-full" value={f.sortCode} onChange={(e) => set("sortCode", e.target.value)} placeholder="Sort code (00-00-00)" inputMode="numeric" />
        <input className="input w-full" value={f.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} placeholder="Account number" inputMode="numeric" />
      </div>
      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
      <button onClick={submit} disabled={busy} className="btn-primary mt-3 px-5 py-2 text-sm">{busy ? "Saving…" : "Save bank details"}</button>
      <p className="mt-2 text-[11px] text-white/35">Used only to pay out your earnings, monthly.</p>
    </StepShell>
  );
}

function IdStep({ verified, token }: { verified: boolean; token: string }) {
  const createSession = useAction(api.identity.createAccountSession);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await createSession({ token, origin: window.location.origin });
      window.location.href = url; // Stripe Identity hosted flow → returns to /verify/return?account=1
    } catch (e: any) {
      setErr(e?.message ?? "Could not start verification");
      setBusy(false);
    }
  }

  if (verified) return <StepShell n={2} title="ID verification" done badge="Verified" />;
  return (
    <StepShell n={2} title="ID verification" done={false}>
      <p className="text-xs leading-relaxed text-white/45">
        Verify your identity with Stripe — a quick photo of a government ID plus a selfie. Instant and secure; nothing to email and no manual review.
      </p>
      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
      <button onClick={verify} disabled={busy} className="btn-primary mt-3 px-5 py-2 text-sm">
        {busy ? "Opening Stripe…" : "Verify my ID"}
      </button>
    </StepShell>
  );
}
