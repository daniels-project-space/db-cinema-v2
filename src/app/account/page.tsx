"use client";
import { REVIEW_PRIZE_GBP } from "../../../shared/reviewPrize";
import { ReferralPanel } from "@/components/account/ReferralPanel";
import { EncoreCrest } from "@/components/account/LoyaltyCelebration";

import { useEffect, useState } from "react";
import {
  useQuery,
  useMutation,
  useAction,
} from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { useAccount } from "@/components/account/AccountProvider";
import { GoogleSignIn } from "@/components/account/GoogleSignIn";
import { GearCard } from "@/components/GearCard";
import { AccountFrame, AccountProfilePill } from "@/components/account/AccountFrame";
import { ChatAvatar } from "@/components/rentals/ChatIdentity";
import { RenterChat } from "@/components/RenterChat";
import { MembershipPlanCard } from "@/components/MembershipPlanCard";
import { tierByKey, TIERS } from "@/lib/membership";

import { AccentPicker } from "@/components/AccentPicker";
import { CollectiveProfile } from "@/components/account/CollectiveProfile";
import { RenterNotificationBell } from "@/components/account/RenterNotificationBell";
import { RenterOverview } from "@/components/account/RenterOverview";
import { RentalCalendar } from "@/components/account/RentalCalendar";
import { ShootLists } from "@/components/plans/ShootLists";
import { AvatarUpload } from "@/components/account/AvatarUpload";
import { ManagementShell } from "@/components/management/ManagementShell";
import { InvoiceLibrary } from "@/components/management/InvoiceLibrary";

export default function AccountPage() {
  const account = useAccount();
  if (account.loading)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-md px-6 py-24 text-center text-white/30">
          Loading…
        </main>
      </>
    );
  return (
    <>
      {account.me ? <Dashboard /> : <><SiteHeader /><main className="section-window mx-auto max-w-5xl px-6 py-12"><AuthForm /></main></>}
    </>
  );
}

function AuthForm() {
  const account = useAccount();
  const requestSignIn = useAction(api.accountAccess.requestSignIn);
  const [linkSent, setLinkSent] = useState(false);
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
      if (mode === "signup") {
        await account.signUp(email, password, name || undefined);
        setLinkSent(true);
      }
      else await account.signIn(email, password);
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-in mx-auto max-w-sm">
      <div className="hud-label !text-accent-400/90">Your rental workspace</div>
      <h1 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">
        {mode === "signup" ? "Create" : "Sign"}{" "}
        <span className="serif-accent gradient-text text-[1.06em]">
          {mode === "signup" ? "account" : "in"}
        </span>
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
          <input
            aria-label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="input"
          />
        )}
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          aria-label="Email"
          className="input"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (6+ chars)"
          type="password"
          aria-label="Password"
          className="input"
        />
        {err && (
          <div className="rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">
            {err}
          </div>
        )}
        <button onClick={go} disabled={busy} className="btn-primary py-3">
          {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        {mode === "signup" && linkSent && <p role="status" className="text-xs text-accent-300">Check your email to confirm account creation and activate your password. Private rentals stay locked until then.</p>}
        <GoogleSignIn onError={setErr} />
        {mode === "signin" && <>
          <Link href="/account/setup?purpose=reset" className="text-sm text-accent-300 hover:underline">Forgot password?</Link>
          <div className="mt-2 border-t border-white/10 pt-4 text-xs text-white/50">Booked without a password? Sign in with your rental email.</div>
          <button className="btn-secondary py-3" disabled={busy || !email.trim()} onClick={async()=>{setBusy(true);setErr(null);setLinkSent(false);try{await requestSignIn({email});setLinkSent(true);}catch{setErr("Could not request a link. Please try again.");}finally{setBusy(false);}}}>Email me a sign-in link</button>
          {linkSent && <p role="status" className="text-xs text-accent-300">If an account uses this email, a private sign-in link is on its way. It expires in 15 minutes.</p>}
        </>}
      </div>
    </div>
  );
}

function Dashboard() {
  const account = useAccount();
  const me = account.me!;
  const unreadMessages =
    useQuery(
      api.rentalChat.unreadTotals,
      account.token ? { token: account.token } : "skip",
    ) ?? 0;
  const rentalPages = usePaginatedQuery(
    api.accounts.myBookingsPage,
    account.token ? { token: account.token } : "skip",
    { initialNumItems: 30 },
  );
  const bookings =
    rentalPages.status === "LoadingFirstPage" ? undefined : rentalPages.results;

  const [name, setName] = useState(me.name ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [address, setAddress] = useState(me.address ?? "");
  const [marketing, setMarketing] = useState(me.marketingEmails);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<
    "rentals" | "calendar" | "invoices" | "chat" | "plans" | "profile" | "membership" | "security"
  >("rentals");
  const [chatBooking, setChatBooking] = useState<string | null>(null);

  useEffect(() => {
    if (["calendar", "rentals"].includes(tab) && rentalPages.status === "CanLoadMore") rentalPages.loadMore(30);
  }, [tab, rentalPages.status, rentalPages.loadMore]);

  useEffect(() => {
    setName(me.name ?? "");
    setPhone(me.phone ?? "");
    setAddress(me.address ?? "");
    setMarketing(me.marketingEmails);
  }, [me]);

  // Gaffer sends people here with /account#chat when it says "I'll pick this up
  // in your chat" — the chat is a tab, so the hash has to select it or they land
  // on Rentals wondering where the conversation went.
  useEffect(() => {
    const openFromHash = () => {
      const section=window.location.hash.slice(1).toLowerCase();
      if (["rentals", "calendar", "invoices", "chat", "plans", "profile", "membership", "security"].includes(section)) setTab(section as typeof tab);
      if (window.location.hash.replace("#", "").toLowerCase() === "chat") {
        setTab("chat");
        const rental = new URLSearchParams(window.location.search).get(
          "rental",
        );
        if (rental) setChatBooking(rental);
        else if(new URLSearchParams(window.location.search).get("conversation")==="general")setChatBooking("general");
      }
    };
    openFromHash();
    const openChat = (event: Event) => {
      setTab("chat");
      const id = (event as CustomEvent<{ bookingId?: string }>).detail?.bookingId;
      if (id) setChatBooking(id);
    };
    window.addEventListener("hashchange", openFromHash);
    window.addEventListener("dbc:open-rental-chat", openChat);
    return () => { window.removeEventListener("hashchange", openFromHash); window.removeEventListener("dbc:open-rental-chat", openChat); };
  }, []);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await account.updateProfile({
        name,
        phone,
        address,
        marketingEmails: marketing,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setSaveError(e.message ?? "Profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ManagementShell role="renter" name={me.name || "My account"} title={{ rentals: "My rentals", calendar: "Rental calendar", invoices: "Invoices", chat: "Messages", plans: "Shoot lists", profile: "Profile", membership: "Membership", security: "Account security" }[tab]} subtitle="Manage your bookings, documents and conversations in one place." active={tab}
      nav={[{ key: "rentals", label: "My rentals", icon: "rentals" }, { key: "calendar", label: "Calendar", icon: "calendar" }, { key: "chat", label: "Messages", icon: "messages", badge: unreadMessages }, { key: "invoices", label: "Invoices", icon: "documents" }, { key: "plans", label: "Shoot lists", icon: "calendar" }, { key: "membership", label: "Membership", icon: "people" }, { key: "profile", label: "Profile", icon: "people" }, { key: "security", label: "Security", icon: "settings" }]}
      onNavigate={key => setTab(key as typeof tab)} actions={<><RenterNotificationBell token={account.token!}/><button onClick={() => account.signOut()} className="rounded-lg border border-white/15 px-3 py-2 text-[10px] text-white/65">Sign out</button></>}>
      {/* Profile identity and account details. */}
      {tab === "profile" && <AccountProfilePill tier={me.membershipActive ? me.membershipTier : null}>
        <AccountFrame tier={me.membershipActive ? me.membershipTier : null}><ChatAvatar sender="renter" photo={me.avatarUrl} name={me.name || me.email} className="!h-12 !w-12" /></AccountFrame>
        <div className="min-w-0 flex-1">
          <div className="hud-label !text-accent-400/90">
            Your rental workspace
          </div>
          <h1 className="truncate font-display text-xl font-bold text-white sm:text-2xl">
            {me.name || "My account"}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/45">
            <span className="truncate">{me.email}</span>
            {me.idVerified && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300">
                ID verified
              </span>
            )}
            {(me as any).storeCredit > 0 && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-300">
                £{(me as any).storeCredit} credit
              </span>
            )}
            {me.membershipActive && me.membershipTier && (
              <span className="rounded-full bg-accent-500/15 px-2 py-0.5 font-medium text-accent-300">
                {tierByKey(me.membershipTier)?.name ?? me.membershipTier} member
              </span>
            )}
          </p>
        </div>
      </AccountProfilePill>}

      {tab === "calendar" && <div className="mt-6 max-w-3xl"><RentalCalendar bookings={bookings as any} loading={rentalPages.status !== "Exhausted"} onOpenRental={id=>{setChatBooking(id);setTab("chat");}} /></div>}
      {tab === "invoices" && <InvoiceLibrary rentals={bookings} token={account.token!} />}
      {["calendar", "invoices"].includes(tab) && rentalPages.status === "CanLoadMore" && <button onClick={() => rentalPages.loadMore(30)} className="mt-5 rounded-lg border border-white/15 px-5 py-2 text-xs text-white/70">Load older rentals and documents</button>}
      {tab === "plans" && <ShootLists />}

      {/* Renter overview: equipment, calendar and conversations first. */}
      {tab === "rentals" && <>
        <RenterOverview bookings={bookings as any} token={account.token!}
          historyLoading={rentalPages.status !== "Exhausted"} unreadMessages={unreadMessages}
          onOpenChat={id=>{setChatBooking(id??null);setTab("chat");}}
          onOpenCalendar={()=>setTab("calendar")}/>
        <details className="mt-6 rounded-lg border border-white/10 bg-[#1b1c1b] p-5">
          <summary className="cursor-pointer text-sm text-white/65">Account credit, rewards &amp; saved gear</summary>
          <div className="mt-5 grid items-start gap-4 lg:grid-cols-3">
              <div className="mb-4 rounded-3xl border border-white/[0.06] bg-[#141414] p-5">
                <p className="text-xs text-white/35">Account credit</p>
                <p className="mt-2 font-display text-2xl text-white">
                  £{((me as any).storeCredit ?? 0).toFixed(2)}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-white/40">
                  Earned credit competes with other savings. Refund credit can pay the remaining balance. Check each credit’s expiry.
                </p>
              </div>
              <div className="mb-4 rounded-3xl border border-amber-200/20 bg-gradient-to-br from-amber-200/[.07] to-transparent p-5">
                <p className="font-mono text-[10px] uppercase tracking-[.25em] text-amber-200/65">Encore · returning filmmakers</p>
                <p className="mt-2 font-display text-2xl text-white">{me.loyaltyEligible ? `${me.loyaltyPercent}% off your next story` : `${me.loyaltyCompleted} / 3 completed rentals`}</p>
                <EncoreCrest level={Math.max(1,me.loyaltyLevel)} className="mx-auto mt-3 h-20 w-20 text-amber-100/65"/>
                <p className="mt-2 text-xs leading-6 text-white/45">{me.loyaltyEligible ? me.membershipActive ? "Unlocked and saved. Your subscription and Encore price benefits do not stack." : "Applied automatically when it is your best saving. Rental charges only; delivery and security are excluded." : "Complete separate rentals to earn 2%, then 4%, then 10% off rental charges. No subscription needed."}</p>
                {me.loyaltyLevel<3&&<p className="mt-3 border-t border-white/10 pt-3 text-xs text-amber-100/60">{me.loyaltyCompleted} / 3 completed · Next: {me.loyaltyLevel===0?2:me.loyaltyLevel===1?4:10}%</p>}
              </div>
              {account.token&&<ReferralPanel token={account.token}/>}
          </div>
          <div className="mt-5"><Favourites /></div>
          <Link href="/rental-stories" className="mt-5 inline-flex items-center gap-2 text-xs text-amber-200/80">Your set story could win £{REVIEW_PRIZE_GBP} · enter &amp; track →</Link>
        </details>
      </>}

      {/* CHAT */}
      {tab === "chat" && (
        <div className="tab-in mt-6" id="renter-chat">
          <RenterChat bookings={bookings as any} focusBookingId={chatBooking} />
        </div>
      )}

      {/* PROFILE & SETTINGS */}
      {tab === "profile" && (
        <div className="tab-in mt-6 space-y-6">
          <section className="rounded-3xl border border-white/[0.07] bg-[#141414] p-6">
            <h2 className="font-display font-semibold text-white/80">
              Profile
            </h2>
            <div className="mt-4">
              <AvatarUpload />
            </div>
            {(me as any).storeCredit > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm">
                <span className="font-semibold text-amber-200">
                  £{(me as any).storeCredit} store credit
                </span>
                <span className="text-amber-200/60">
                  · applied automatically at your next checkout
                </span>
              </div>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                aria-label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                className="input"
              />
              <input
                aria-label="Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone"
                className="input"
              />
              <textarea
                aria-label="Default delivery address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Default delivery address"
                rows={2}
                className="input sm:col-span-2"
              />
            </div>
            <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/60">
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                className="accent-accent-500"
              />
              Email me booking reminders &amp; offers

            </label>
            {saveError && (
              <p role="alert" className="mt-3 text-xs text-rose-300">
                {saveError}
              </p>
            )}
            <button
              disabled={saving}
              onClick={save}
              className="btn-primary mt-4 w-fit px-6 py-2.5 text-sm"
            >
              {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
            </button>
          </section>

          <section className="rounded-3xl border border-white/[0.07] bg-[#141414] p-6">
            <h2 className="font-display font-semibold text-white/80">
              Appearance
            </h2>
            <p className="mt-1 text-xs text-white/40">
              Pick your accent colour — the whole site follows, on this device.
            </p>
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
          <Membership />
          <p className="mt-4 text-xs text-white/45">Pro and Studio weekend deals are applied automatically to eligible website rentals; no member coupon is needed.</p>
        </div>
      )}

      {/* SECURITY */}
      {tab === "security" && (
        <div className="tab-in mt-6">
          <AccountSecurity />
        </div>
      )}
    </ManagementShell>
  );
}

function Favourites() {
  const account = useAccount();
  const ids = (account.me?.favorites ?? []) as any[];
  const favs =
    useQuery(api.catalog.listingsByIds, ids.length ? { ids } : "skip") ?? [];
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-display font-semibold text-white/80">Favourites</h2>
        {ids.length > 0 && (
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/45">
            {ids.length}
          </span>
        )}
      </div>
      {ids.length === 0 ? (
        <div className="spot mt-3 rounded-2xl p-6 text-center text-sm text-white/40">
          No favourites yet — tap the{" "}
          <span className="text-accent-400">♥</span> on any gear to save it
          here.{" "}
          <Link href="/gear" className="text-accent-400 hover:underline">
            Browse gear →
          </Link>
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
    setErr(null);
    setMsg(null);
    try {
      await changePassword({
        token: account.token!,
        oldPassword: oldp,
        newPassword: newp,
      });
      setMsg("Password changed");
      setOldp("");
      setNewp("");
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    }
  }
  async function del() {
    try {
      await deleteAccount({ token: account.token! });
      await account.signOut();
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    }
  }

  return (
    <section className="rounded-3xl border border-white/[0.07] bg-[#141414] p-6">
      <h2 className="font-display font-semibold text-white/80">Security</h2>
      <div className="mt-4 flex flex-col gap-3">
        {account.me?.hasPassword && <input
          type="password"
          value={oldp}
          onChange={(e) => setOldp(e.target.value)}
          placeholder="Current password"
          className="input"
        />}
        <input
          type="password"
          value={newp}
          onChange={(e) => setNewp(e.target.value)}
          placeholder="New password (6+ chars)"
          className="input"
        />
        {msg && <div className="text-xs text-emerald-300">{msg}</div>}
        {err && <div className="text-xs text-red-300">{err}</div>}
        <button
          onClick={changePw}
          disabled={!oldp || newp.length < 6}
          className="btn-primary w-fit px-6 py-2.5 text-sm"
        >
          Change password
        </button>
      </div>
      <div className="mt-6 border-t border-white/5 pt-4">
        {!confirmDel ? (
          <button
            onClick={() => setConfirmDel(true)}
            className="text-xs text-red-300/70 hover:text-red-300"
          >
            Delete my account
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/60">
              Delete account permanently?
            </span>
            <button
              onClick={del}
              className="rounded-full bg-red-500/80 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-500"
            >
              Yes, delete
            </button>
            <button
              onClick={() => setConfirmDel(false)}
              className="text-xs text-white/40 hover:text-white"
            >
              cancel
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Membership() {
  const account = useAccount();
  const portal = useAction(api.checkout.billingPortal);
  const [busy, setBusy] = useState(false);
  const tier = account.me?.membershipActive
    ? tierByKey(account.me.membershipTier)
    : null;

  async function manage() {
    setBusy(true);
    try {
      const { url } = await portal({
        token: account.token!,
        origin: window.location.origin,
      });
      window.location.href = url;
    } catch {
      setBusy(false);
    }
  }
  async function join(_tierKey: string) { window.location.href = "/membership"; }

  // ── active member: what they're getting + manage ──
  if (tier) {
    return (
      <section>
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[.16em] text-accent-300">Your {tier.name} membership</p>
        <div className="max-w-md"><MembershipPlanCard tier={tier} compact onSelect={manage} disabled={busy || !!(account.me?.membershipAdminGranted && !account.me?.membershipBillingTier)} label={busy ? "Opening settings…" : account.me?.membershipAdminGranted && !account.me?.membershipBillingTier ? "Granted by DB Cinema" : "Membership settings / cancel"} /></div>
        {account.me?.membershipAdminGranted && <p className="mt-3 max-w-md text-xs leading-5 text-white/50">DB Cinema has granted this plan’s access. Monthly credit is issued only for paid subscription invoices; the upfront security waiver requires a paid membership. {account.me.membershipBillingTier ? `Your paid ${tierByKey(account.me.membershipBillingTier)?.name ?? "membership"} subscription is managed separately.` : "This grant does not start a subscription or monthly charges."}</p>}
        {account.me?.membershipStatus === "trialing" && <p className="mt-3 text-xs text-amber-200">Free week: upfront security payment applies until the first paid invoice.</p>}
        {account.me?.membershipCancelAtPeriodEnd && <p className="mt-3 text-xs text-white/45">Cancellation scheduled. Your plan will not renew.</p>}
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-white/[0.07] bg-[#141414] p-5 sm:p-6">
      <div className="hud-label !text-accent-400/90">Db Cinema Membership</div>
      {account.me?.membershipBillingTier && <div className="my-4 max-w-md rounded-xl border border-white/10 p-4"><p className="text-xs leading-5 text-white/60">Your {tierByKey(account.me.membershipBillingTier)?.name ?? "paid"} subscription billing can still be managed here, even when membership access is inactive.</p><button type="button" onClick={manage} disabled={busy} className="mt-3 text-xs text-accent-200 underline">{busy ? "Opening settings…" : "Manage / cancel paid subscription"}</button></div>}
      <h2 className="mt-2 font-display text-3xl font-bold text-white">More room for <span className="serif-accent gradient-text">your next story.</span></h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/55">Turn your monthly membership into rental credit, with extra credit on top. Keep it for your next shoot or let it build towards something bigger.</p>
      <div className="mt-6 grid items-stretch gap-4 lg:grid-cols-3" data-testid="account-membership-plans">
        {TIERS.map(t => <MembershipPlanCard key={t.key} tier={t} compact onSelect={() => join(t.key)} label={`Explore ${t.name}`} />)}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/40">
        <span>Monthly renewal · credits valid for one year · applicable card holds remain</span>
        <Link href="/membership" className="text-accent-300 hover:underline">
          Compare plans in detail →
        </Link>
      </div>
    </section>
  );
}
