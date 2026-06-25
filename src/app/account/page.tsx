"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { useAccount } from "@/components/account/AccountProvider";
import { GoogleSignIn } from "@/components/account/GoogleSignIn";
import { GearCard } from "@/components/GearCard";
import { RenterChat } from "@/components/RenterChat";
import { tierByKey, TIERS } from "@/lib/membership";
import { MemberOffers } from "@/components/MemberOffers";
import { AccentPicker } from "@/components/AccentPicker";
import { CollectiveProfile } from "@/components/account/CollectiveProfile";
import { BookingSections } from "@/components/account/BookingSections";
import { RentalCalendar } from "@/components/account/RentalCalendar";
import { AvatarUpload } from "@/components/account/AvatarUpload";

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
      <main className="section-window mx-auto max-w-5xl px-6 py-12">
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
    <div className="page-in mx-auto max-w-sm">
      <div className="hud-label !text-accent-400/90">Members area</div>
      <h1 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">
        {mode === "signup" ? "Create" : "Sign"}{" "}
        <span className="serif-accent gradient-text text-[1.06em]">{mode === "signup" ? "account" : "in"}</span>
      </h1>
      <p className="mt-2 text-sm text-white/40">
        {mode === "signup" ? "Already have one? " : "New here? "}
        <button
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          className="text-accent-400 underline-offset-2 hover:underline"
        >
          {mode === "signup" ? "Sign in" : "Create one"}
        </button>
      </p>
      <div className="mt-6 flex flex-col gap-3">
        {mode === "signup" && (
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" className="input" />
        )}
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" aria-label="Email" className="input" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (6+ chars)" type="password" aria-label="Password" className="input" />
        {err && <div className="rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">{err}</div>}
        <button onClick={go} disabled={busy} className="btn-primary py-3">
          {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <GoogleSignIn onError={setErr} />
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
  const [tab, setTab] = useState<"rentals" | "chat" | "profile" | "membership" | "security">("rentals");
  const [chatBooking, setChatBooking] = useState<string | null>(null);

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
    <div className="page-in">
      {/* account bar — identity + key info, always on top */}
      <header className="spot gradient-border flex flex-wrap items-center gap-4 rounded-2xl p-4 sm:p-5">
        {(me as any).avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={(me as any).avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-white/10" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-500/20 font-display text-base font-bold text-accent-200 ring-2 ring-white/10">
            {(me.name || me.email || "?").trim().charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="hud-label !text-accent-400/90">Members area</div>
          <h1 className="truncate font-display text-xl font-bold text-white sm:text-2xl">{me.name || "My account"}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/45">
            <span className="truncate">{me.email}</span>
            {me.idVerified && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300">ID verified</span>
            )}
            {(me as any).storeCredit > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-300">£{(me as any).storeCredit} credit</span>
            )}
            {me.membershipActive && me.membershipTier && (
              <span className="rounded-full bg-accent-500/15 px-2 py-0.5 font-medium text-accent-300">
                {tierByKey(me.membershipTier)?.name ?? me.membershipTier} member
              </span>
            )}
          </p>
        </div>
        <button onClick={() => account.signOut()} className="btn-ghost shrink-0 px-4 py-2 text-sm">
          Sign out
        </button>
      </header>

      {/* tabs */}
      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-white/10">
        {(
          [
            ["rentals", "Rentals"],
            ["chat", "Chat"],
            ["profile", "Profile & settings"],
            ["membership", "Membership"],
            ["security", "Security"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === key ? "border-accent-400 text-white" : "border-transparent text-white/45 hover:text-white/80"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* RENTALS */}
      {tab === "rentals" && (
        <div className="tab-in mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-8">
            <BookingSections
              bookings={bookings as any}
              token={account.token!}
              onOpenChat={(id?: string) => {
                setChatBooking(id ?? null);
                setTab("chat");
              }}
            />
            <Favourites />
          </div>
          {/* sidebar cell stretches to the row height so the calendar can stick smoothly */}
          <div>
            <div className="lg:sticky lg:top-6">
              <RentalCalendar bookings={bookings as any} />
            </div>
          </div>
        </div>
      )}

      {/* CHAT */}
      {tab === "chat" && (
        <div className="tab-in mt-6" id="renter-chat">
          <RenterChat bookings={bookings as any} focusBookingId={chatBooking} />
        </div>
      )}

      {/* PROFILE & SETTINGS */}
      {tab === "profile" && (
        <div className="tab-in mt-6 space-y-6">
          <section className="spot gradient-border rounded-2xl p-5">
            <h2 className="font-display font-semibold text-white/80">Profile</h2>
            <div className="mt-4">
              <AvatarUpload />
            </div>
            {(me as any).storeCredit > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm">
                <span className="font-semibold text-amber-200">£{(me as any).storeCredit} store credit</span>
                <span className="text-amber-200/60">· applied automatically at your next checkout</span>
              </div>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="input" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="input" />
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Default delivery address" rows={2} className="input sm:col-span-2" />
            </div>
            <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/60">
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="accent-accent-500" />
              Email me booking reminders &amp; offers
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">−5% on every rental</span>
            </label>
            <button onClick={save} className="btn-primary mt-4 w-fit px-6 py-2.5 text-sm">
              {saved ? "Saved" : "Save changes"}
            </button>
          </section>

          <section className="spot gradient-border rounded-2xl p-5">
            <h2 className="font-display font-semibold text-white/80">Appearance</h2>
            <p className="mt-1 text-xs text-white/40">Pick your accent colour — the whole site follows, on this device.</p>
            <div className="mt-4">
              <AccentPicker />
            </div>
          </section>

          <CollectiveProfile />
        </div>
      )}

      {/* MEMBERSHIP */}
      {tab === "membership" && (
        <div className="tab-in mt-6 space-y-6">
          <Membership bookings={bookings} />
          <MemberOffers />
        </div>
      )}

      {/* SECURITY */}
      {tab === "security" && <div className="tab-in mt-6"><AccountSecurity /></div>}
    </div>
  );
}

function Favourites() {
  const account = useAccount();
  const ids = (account.me?.favorites ?? []) as any[];
  const favs = useQuery(api.catalog.listingsByIds, ids.length ? { ids } : "skip") ?? [];
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display font-semibold text-white/80">Favourites</h2>
        {ids.length > 0 && (
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/45">{ids.length}</span>
        )}
      </div>
      {ids.length === 0 ? (
        <div className="spot mt-3 rounded-2xl p-6 text-center text-sm text-white/40">
          No favourites yet — tap the <span className="text-accent-400">♥</span> on any gear to save it here.{" "}
          <Link href="/gear" className="text-accent-400 hover:underline">Browse gear →</Link>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
          {favs.map((l: any) => (
            <GearCard key={l._id} listing={l} />
          ))}
        </div>
      )}
    </section>
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
      setMsg("Password changed"); setOldp(""); setNewp("");
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
  }
  async function del() {
    try {
      await deleteAccount({ token: account.token! });
      await account.signOut();
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
  }

  return (
    <section className="spot gradient-border rounded-2xl p-5">
      <h2 className="font-display font-semibold text-white/80">Security</h2>
      <div className="mt-4 flex flex-col gap-3">
        <input type="password" value={oldp} onChange={(e) => setOldp(e.target.value)} placeholder="Current password" className="input" />
        <input type="password" value={newp} onChange={(e) => setNewp(e.target.value)} placeholder="New password (6+ chars)" className="input" />
        {msg && <div className="text-xs text-emerald-300">{msg}</div>}
        {err && <div className="text-xs text-red-300">{err}</div>}
        <button onClick={changePw} disabled={!oldp || newp.length < 6} className="btn-primary w-fit px-6 py-2.5 text-sm">
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

function Membership({ bookings }: { bookings: any[] | null | undefined }) {
  const account = useAccount();
  const portal = useAction(api.checkout.billingPortal);
  const subscribe = useAction(api.checkout.startMembership);
  const [busy, setBusy] = useState(false);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const tier = account.me?.membershipActive ? tierByKey(account.me.membershipTier) : null;

  async function manage() {
    setBusy(true);
    try {
      const { url } = await portal({ token: account.token!, origin: window.location.origin });
      window.location.href = url;
    } catch {
      setBusy(false);
    }
  }
  async function join(tierKey: string) {
    setBusyTier(tierKey);
    try {
      const { url } = await subscribe({ token: account.token!, tier: tierKey, origin: window.location.origin });
      window.location.href = url;
    } catch (e: any) {
      setBusyTier(null);
      alert(e?.message ?? "Could not start checkout.");
    }
  }

  // ── active member: what they're getting + manage ──
  if (tier) {
    const mo = new Date().toISOString().slice(0, 7);
    const used = account.me?.freeAccessoryMonth === mo ? account.me?.freeAccessoryUsed ?? 0 : 0;
    const left = Math.max(0, tier.freeAccessories - used);
    return (
      <section className="spot gradient-border rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display font-semibold text-white/80">Membership</h2>
          <span className="rounded-full bg-accent-500/15 px-2.5 py-0.5 text-[11px] font-medium text-accent-300">
            {tier.name} member
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-white/60">
            You're saving <span className="font-medium text-accent-300">{tier.pct}% on every rental</span>
            {tier.freeDelivery ? " + free delivery" : ""}.
            {tier.freeAccessories > 0 && (
              <span className="mt-1 block text-amber-300">
                {left} of {tier.freeAccessories} free accessories left this month (tripod, gimbal, filters or batteries).
              </span>
            )}
          </div>
          <button onClick={manage} disabled={busy} className="btn-ghost px-4 py-2 text-sm disabled:opacity-40">
            {busy ? "…" : "Manage membership"}
          </button>
        </div>
      </section>
    );
  }

  // ── non-member: the pitch ──
  const paid = (bookings ?? []).filter((b: any) => ["confirmed", "active", "returned"].includes(b.status));
  const spend = Math.round(paid.reduce((n: number, b: any) => n + (b.subtotal ?? 0), 0));
  const proPct = tierByKey("pro")?.pct ?? 15;
  const wouldSave = Math.round((spend * proPct) / 100);

  return (
    <section className="spot gradient-border rounded-2xl p-5">
      <div className="hud-label !text-accent-400/90">Db Cinema Membership</div>
      <h2 className="mt-1 font-display text-2xl font-bold text-white">
        Rent more, <span className="serif-accent gradient-text text-[1.05em]">pay less</span>
      </h2>

      {spend >= 50 ? (
        <p className="mt-3 rounded-xl border border-accent-400/25 bg-accent-500/[0.07] px-4 py-3 text-sm text-white/70">
          You've rented <span className="font-semibold text-white">£{spend.toLocaleString()}</span> of gear with us.
          On <span className="font-medium text-accent-300">Pro</span> you'd have saved about{" "}
          <span className="font-semibold text-emerald-300">£{wouldSave.toLocaleString()}</span>
          {wouldSave >= 49 ? " — more than the membership costs." : " — and you'd keep saving on every shoot."}
        </p>
      ) : (
        <p className="mt-2 text-sm text-white/55">
          Save <span className="text-white/80">10–20% on every rental</span>, get free accessories and member-only
          gear — it pays for itself in a shoot or two.
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {TIERS.map((t) => {
          const popular = t.key === "pro";
          return (
            <div
              key={t.key}
              className={`relative rounded-2xl border p-4 ${
                popular ? "border-accent-400/50 bg-accent-500/[0.06]" : "border-white/10 bg-white/[0.02]"
              }`}
            >
              {popular && (
                <span className="absolute -top-2 right-3 rounded-full bg-accent-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Most popular
                </span>
              )}
              <div className="font-display text-lg font-bold text-white">{t.name}</div>
              <div className="mt-0.5">
                <span className="font-display text-2xl font-bold text-white">£{t.monthlyGbp}</span>
                <span className="text-xs text-white/40">/mo</span>
              </div>
              <div className="mt-2 text-sm font-semibold text-accent-300">{t.pct}% off every rental</div>
              <ul className="mt-2 space-y-1">
                {t.perks.slice(1, 4).map((p) => (
                  <li key={p} className="flex items-start gap-1.5 text-xs text-white/60">
                    <span className="mt-0.5 shrink-0 text-accent-400">✓</span>
                    {p}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => join(t.key)}
                disabled={!!busyTier}
                className={`mt-3 w-full rounded-lg px-3 py-2 text-center text-xs font-semibold transition disabled:opacity-40 ${
                  popular
                    ? "bg-accent-500 text-white hover:bg-accent-600"
                    : "border border-white/15 bg-white/[0.04] text-white/85 hover:bg-white/[0.08]"
                }`}
              >
                {busyTier === t.key ? "…" : `Get ${t.name}`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/40">
        <span>Cancel anytime · billed monthly · perks apply instantly</span>
        <Link href="/membership" className="text-accent-300 hover:underline">
          Compare plans in detail →
        </Link>
      </div>
    </section>
  );
}
