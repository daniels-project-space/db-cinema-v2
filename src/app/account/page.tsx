"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { useAccount } from "@/components/account/AccountProvider";
import { IdVerify } from "@/components/IdVerify";
import { GearCard } from "@/components/GearCard";

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

      {/* security */}
      <AccountSecurity />

      {/* favourites */}
      <Favourites />

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
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <IdVerify bookingId={b._id} status={b.idVerifyStatus} compact />
                  {b.firstSlug && (
                    <Link href={`/gear/${b.firstSlug}`} className="rounded-full glass px-3 py-1 text-xs text-white/60 hover:text-white">
                      Rent again
                    </Link>
                  )}
                </div>
                <BookingReview bookingId={b._id} reviewed={b.reviewed} token={account.token!} />
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

function Favourites() {
  const account = useAccount();
  const ids = (account.me?.favorites ?? []) as any[];
  const favs = useQuery(api.catalog.listingsByIds, ids.length ? { ids } : "skip") ?? [];
  if (ids.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="font-display font-semibold text-white/80">Favourites</h2>
      <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
        {favs.map((l: any) => (
          <GearCard key={l._id} listing={l} />
        ))}
      </div>
    </section>
  );
}

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1 text-xl">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={n <= value ? "text-accent-400" : "text-white/20"}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function BookingReview({
  bookingId,
  reviewed,
  token,
}: {
  bookingId: string;
  reviewed: boolean;
  token: string;
}) {
  const submit = useMutation(api.reviews.submitNative);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (reviewed || done)
    return <div className="mt-3 text-xs text-emerald-300">✓ Reviewed — thank you!</div>;

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 text-xs text-accent-400 hover:underline"
      >
        Leave a review
      </button>
    );

  async function send() {
    setErr(null);
    try {
      await submit({ token, bookingId: bookingId as any, rating, text });
      setDone(true);
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <Stars value={rating} onChange={setRating} />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="How was the gear & service?"
        rows={2}
        className="mt-2 w-full rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/80 outline-none placeholder:text-white/30"
      />
      {err && <div className="mt-1 text-xs text-red-300">{err}</div>}
      <div className="mt-2 flex gap-2">
        <button onClick={send} className="rounded-full bg-accent-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-600">
          Submit review
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-white/40 hover:text-white">
          cancel
        </button>
      </div>
    </div>
  );
}

function AccountSecurity() {
  const account = useAccount();
  const changePassword = useAction(api.accounts.changePassword);
  const deleteAccount = useMutation(api.accounts.deleteAccount);
  const [oldp, setOldp] = useState("");
  const [newp, setNewp] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function changePw() {
    setErr(null); setMsg(null);
    try {
      await changePassword({ token: account.token!, oldPassword: oldp, newPassword: newp });
      setMsg("Password changed ✓"); setOldp(""); setNewp("");
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
  }
  async function del() {
    try {
      await deleteAccount({ token: account.token! });
      await account.signOut();
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
  }

  return (
    <section className="mt-8 rounded-2xl glass gradient-border p-5">
      <h2 className="font-display font-semibold text-white/80">Security</h2>
      <div className="mt-4 flex flex-col gap-3">
        <input type="password" value={oldp} onChange={(e) => setOldp(e.target.value)} placeholder="Current password" className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
        <input type="password" value={newp} onChange={(e) => setNewp(e.target.value)} placeholder="New password (6+ chars)" className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30" />
        {msg && <div className="text-xs text-emerald-300">{msg}</div>}
        {err && <div className="text-xs text-red-300">{err}</div>}
        <button onClick={changePw} disabled={!oldp || newp.length < 6} className="w-fit rounded-full bg-accent-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-40">
          Change password
        </button>
      </div>
      <div className="mt-6 border-t border-white/5 pt-4">
        {!confirmDel ? (
          <button onClick={() => setConfirmDel(true)} className="text-xs text-red-300/70 hover:text-red-300">
            Delete my account
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/60">Delete account permanently?</span>
            <button onClick={del} className="rounded-full bg-red-500/80 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-500">Yes, delete</button>
            <button onClick={() => setConfirmDel(false)} className="text-xs text-white/40 hover:text-white">cancel</button>
          </div>
        )}
      </div>
    </section>
  );
}
