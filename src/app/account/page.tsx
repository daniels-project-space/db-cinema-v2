"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { useAccount } from "@/components/account/AccountProvider";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export default function AccountPage() {
  const account = useAccount();
  if (account.loading)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-md px-6 py-24 text-center text-white/30">Loading…</main>
      </>
    );
  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-3xl px-6 py-12">
        {account.me ? <Dashboard /> : <AuthForm />}
      </main>
    </>
  );
}

function AuthForm() {
  const account = useAccount();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "signup") await account.signUp(email, password, name || undefined);
      else await account.signIn(email, password);
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-display text-3xl font-bold text-white/90">
        {mode === "signup" ? "Create account" : "Sign in"}
      </h1>
      <p className="mt-2 text-sm text-white/40">
        {mode === "signup" ? "Already have one? " : "New here? "}
        <button
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          className="text-accent-400 hover:underline"
        >
          {mode === "signup" ? "Sign in" : "Create one"}
        </button>
      </p>
      <div className="mt-6 flex flex-col gap-3">
        {mode === "signup" && (
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
        )}
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (6+ chars)" type="password" className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
        {err && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
        <button onClick={go} disabled={busy} className="rounded-full bg-accent-500 py-3 font-medium text-white hover:bg-accent-600 disabled:opacity-40">
          {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </div>
    </div>
  );
}

function Dashboard() {
  const account = useAccount();
  const me = account.me!;
  const bookings = useQuery(api.accounts.myBookings, account.token ? { token: account.token } : "skip");

  const [name, setName] = useState(me.name ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [address, setAddress] = useState(me.address ?? "");
  const [marketing, setMarketing] = useState(me.marketingEmails);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(me.name ?? "");
    setPhone(me.phone ?? "");
    setAddress(me.address ?? "");
    setMarketing(me.marketingEmails);
  }, [me]);

  async function save() {
    await account.updateProfile({ name, phone, address, marketingEmails: marketing });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-white/90">My account</h1>
          <p className="mt-1 text-sm text-white/40">{me.email}</p>
        </div>
        <button onClick={() => account.signOut()} className="rounded-full glass px-4 py-2 text-sm text-white/60 hover:text-white">
          Sign out
        </button>
      </div>

      {/* profile + settings */}
      <section className="mt-8 rounded-2xl glass gradient-border p-5">
        <h2 className="font-display font-semibold text-white/80">Profile &amp; settings</h2>
        <div className="mt-4 flex flex-col gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Default delivery address" rows={2} className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
          <label className="flex items-center gap-2 text-sm text-white/60">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="accent-accent-500" />
            Email me occasional offers
          </label>
          <button onClick={save} className="w-fit rounded-full bg-accent-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-accent-600">
            {saved ? "Saved ✓" : "Save changes"}
          </button>
        </div>
      </section>

      {/* my bookings */}
      <section className="mt-8">
        <h2 className="font-display font-semibold text-white/80">My bookings</h2>
        <div className="mt-3 flex flex-col gap-3">
          {bookings === undefined ? (
            <div className="text-sm text-white/30">Loading…</div>
          ) : bookings && bookings.length > 0 ? (
            bookings.map((b: any) => (
              <div key={b._id} className="rounded-2xl glass p-4">
                <div className="flex justify-between">
                  <span className="rounded bg-accent-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent-300">{b.status}</span>
                  <span className="font-display font-bold text-white/90">£{b.total}</span>
                </div>
                <div className="mt-2 text-xs text-white/45">
                  {b.lineItems.map((li: any, i: number) => (
                    <div key={i}>{li.title} · {day(li.start)}→{day(li.end)}</div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-white/30">
              No bookings yet. <Link href="/gear" className="text-accent-400 hover:underline">Browse gear →</Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
