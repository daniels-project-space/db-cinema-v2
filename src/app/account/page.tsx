"use client";
import {AccountCreditReceipts} from "@/components/account/AccountCreditReceipts";
import { REVIEW_PRIZE_GBP } from "../../../shared/reviewPrize";
import { accountAccessDestination } from "../../../shared/accountAccess";
import { ReferralPanel } from "@/components/account/ReferralPanel";
import { EncoreCrest } from "@/components/account/LoyaltyCelebration";

import { useEffect, useRef, useState } from "react";
import {
  useQuery,
  useMutation,
  useAction,
} from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import { api } from "@cvx/_generated/api";
import type { Id } from "@cvx/_generated/dataModel";
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
import { GuestChatHandoff } from "@/components/account/GuestChatHandoff";
import { RenterOverview } from "@/components/account/RenterOverview";
import { RentalCalendar } from "@/components/account/RentalCalendar";
import { AvatarUpload } from "@/components/account/AvatarUpload";
import { ManagementShell } from "@/components/management/ManagementShell";
import { InvoiceLibrary } from "@/components/management/InvoiceLibrary";
import { ACCOUNT_AUTH_MESSAGES, accountAuthErrorMessage } from "../../../shared/accountAuth";
import { PrivatePortraitPreference } from "@/components/account/PrivatePortraitPreference";
import { useCreditBalance } from "@/components/account/useCreditBalance";
import { legalVersionForPolicy, CURRENT_PRIVACY_NOTICE_VERSION } from "../../../shared/legalVersioning";

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
      {account.me ? <><Dashboard /><GuestChatHandoff key={account.token!} token={account.token!} email={account.me.email} /></> : <><SiteHeader /><main className="section-window mx-auto max-w-5xl px-6 py-12"><AuthForm /></main></>}
    </>
  );
}

function AuthForm() {
  const account = useAccount();
  const requestSignIn = useAction(api.accountAccess.requestSignIn);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const accountPolicy = useQuery(api.settings.get, mode === "signup" ? {} : "skip");
  const termsVersion = accountPolicy ? legalVersionForPolicy(accountPolicy) : null;
  const [linkSent, setLinkSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [termsAndPrivacyAcknowledged, setTermsAndPrivacyAcknowledged] = useState(false);
  const [acceptedTermsVersion, setAcceptedTermsVersion] = useState<string | null>(null);
  const [termsNeedReacknowledgement, setTermsNeedReacknowledgement] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetHref, setResetHref] = useState("/account/setup?purpose=reset");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rental = params.get("rental");
    if (params.get("next") === "verification" && rental)
      setResetHref(`/account/setup?purpose=reset&next=verification&rental=${encodeURIComponent(rental)}`);
  }, []);
  const termsConsentCurrent = mode !== "signup" || (!!termsVersion && termsAndPrivacyAcknowledged && acceptedTermsVersion === termsVersion);

  function requireCurrentTermsAcknowledgement() {
    setTermsAndPrivacyAcknowledged(false);
    setAcceptedTermsVersion(null);
    setTermsNeedReacknowledgement(true);
    setErr(ACCOUNT_AUTH_MESSAGES.SIGNUP_TERMS_UPDATED);
  }

  useEffect(() => {
    if (mode === "signup" && acceptedTermsVersion && termsVersion && acceptedTermsVersion !== termsVersion) {
      setTermsAndPrivacyAcknowledged(false);
      setAcceptedTermsVersion(null);
      setTermsNeedReacknowledgement(true);
      setErr(ACCOUNT_AUTH_MESSAGES.SIGNUP_TERMS_UPDATED);
    }
  }, [mode, acceptedTermsVersion, termsVersion]);

  function authReturn() {
    const params = new URLSearchParams(window.location.search);
    const bookingId = params.get("rental");
    if (params.get("review") === "1" && bookingId) return { next: "review" as const, bookingId: bookingId as Id<"bookings"> };
    if (params.get("next") === "verification" && bookingId) return { next: "verification" as const, bookingId: bookingId as Id<"bookings"> };
    if (window.location.hash.toLowerCase() === "#chat") return bookingId ? {next:"chat" as const,bookingId:bookingId as Id<"bookings">} : {next:"chat" as const};
    return {};
  }

  async function go(values: FormData) {
    // Password managers can fill the DOM without dispatching React onChange.
    // Authenticate the values the renter sees, rather than stale component state.
    const submittedEmail = String(values.get("email") ?? "").trim();
    const submittedPassword = String(values.get("password") ?? "");
    const submittedName = String(values.get("name") ?? "").trim();
    const acceptedLegalTerms = values.get("termsAndPrivacyAcknowledged") === "on";
    setEmail(submittedEmail);
    setPassword(submittedPassword);
    setBusy(true);
    setErr(null);
    try {
      if (mode === "signup") {
        if (!acceptedLegalTerms || !termsVersion || acceptedTermsVersion !== termsVersion) {
          if (acceptedTermsVersion && termsVersion && acceptedTermsVersion !== termsVersion) requireCurrentTermsAcknowledgement();
          else setErr(!termsVersion ? "The current terms are still loading. Please try again." : "Please agree to the Terms and Conditions and read the Privacy Notice.");
          return;
        }
        const target = authReturn();
        await account.signUp(submittedEmail, submittedPassword, submittedName || undefined, target.next, target.bookingId, { termsVersion, privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION });
        setLinkSent(true);
      }
      else await account.signIn(submittedEmail, submittedPassword);
    } catch (e: unknown) {
      const errorCode = e && typeof e === "object" && "data" in e ? (e as any).data?.code : undefined;
      if (mode === "signup" && errorCode === "SIGNUP_TERMS_UPDATED") requireCurrentTermsAcknowledgement();
      setErr(accountAuthErrorMessage(e, mode === "signup"
        ? "We couldn't create your account right now. Please try again."
        : "We couldn't sign you in right now. Please try again or request an email sign-in link."));
    } finally {
      setBusy(false);
    }
  }

  function handleGoogleError(message: string, code?: string) {
    setErr(message);
    if (mode === "signup" && code === "SIGNUP_TERMS_UPDATED") requireCurrentTermsAcknowledgement();
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
          onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setTermsAndPrivacyAcknowledged(false); setAcceptedTermsVersion(null); setTermsNeedReacknowledgement(false); setErr(null); setLinkSent(false); }}
          className="text-accent-400 underline-offset-2 hover:underline"
        >
          {mode === "signup" ? "Sign in" : "Create one"}
        </button>
      </p>
      {mode === "signup" && <details data-testid="account-verification-retention" className="group mt-4 rounded-2xl border border-accent-400/15 bg-white/[0.025] px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-white/75 [&::-webkit-details-marker]:hidden">
          <span>Verification &amp; file retention</span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent-300/20 bg-accent-300/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-accent-200/80">90 days <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span></span>
        </summary>
        <div className="mt-2 space-y-2 border-t border-white/10 pt-2 text-xs leading-relaxed text-white/60">
          <p>Didit approval lasts 90 days if your details stay current. Files stay during rentals and for 90 days after rental closure.</p>
          <p>Open cases extend retention to 90 days after closure. Restrictions do not extend it.</p>
        </div>
      </details>}
      <form className="mt-6 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); if (!busy) void go(new FormData(e.currentTarget)); }}>
        {mode === "signup" && (
          <input
            aria-label="Name"
            name="name"
            autoComplete="name"
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
          name="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="input"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "signup" ? "Password (8+ chars)" : "Password"}
          type="password"
          aria-label="Password"
          name="password"
          minLength={mode === "signup" ? 8 : undefined}
          maxLength={256}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          className="input"
        />
        {mode === "signup" && <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3 text-xs leading-5 text-white/65">
          <input name="termsAndPrivacyAcknowledged" type="checkbox" checked={termsAndPrivacyAcknowledged && acceptedTermsVersion === termsVersion} onChange={e => { const checked=e.target.checked; setTermsAndPrivacyAcknowledged(checked); setAcceptedTermsVersion(checked ? termsVersion : null); if (checked) { setTermsNeedReacknowledgement(false); setErr(null); } }} disabled={!termsVersion} required className="mt-1 h-4 w-4 shrink-0 accent-[#c49a6c]" />
          <span>I agree to the current <Link href={termsVersion ? `/legal/terms?version=${encodeURIComponent(termsVersion)}` : "/legal/terms"} target="_blank" rel="noreferrer" className="text-accent-300 underline underline-offset-2">Terms and Conditions</Link> and acknowledge the <Link href="/legal/privacy" target="_blank" rel="noreferrer" className="text-accent-300 underline underline-offset-2">Privacy Notice</Link>.</span>
        </label>}
        {mode === "signup" && termsNeedReacknowledgement && <p role="status" data-testid="signup-terms-reacknowledgement" className="rounded-lg border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-xs text-amber-100/80">Review the updated Terms and Privacy Notice, then tick the box again.</p>}
        {err && (
          <div role="alert" className="rounded-lg border border-rec-500/20 bg-rec-500/10 px-3 py-2 text-xs text-red-300">
            {err}
          </div>
        )}
        <button type="submit" disabled={busy || (mode === "signup" && !termsConsentCurrent)} className="btn-primary py-3">
          {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        {mode === "signup" && linkSent && <p role="status" className="text-xs text-accent-300">Check your email to confirm account creation and activate your password. Private rentals stay locked until then.</p>}
        <GoogleSignIn onError={handleGoogleError} requireTermsAcceptance={mode === "signup"} termsAcceptance={mode === "signup" && termsConsentCurrent ? { termsVersion: termsVersion!, privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION } : null} />
        {mode === "signin" && <>
          <Link href={resetHref} className="text-sm text-accent-300 hover:underline">Forgot password?</Link>
          <div className="mt-2 border-t border-white/10 pt-4 text-xs text-white/50">Booked without a password? Sign in with your rental email.</div>
          <button type="button" className="btn-secondary py-3" disabled={busy || !email.trim()} onClick={async()=>{setBusy(true);setErr(null);setLinkSent(false);try{await requestSignIn({email,...authReturn()});setLinkSent(true);}catch{setErr("Could not request a link. Please try again.");}finally{setBusy(false);}}}>Email me a sign-in link</button>
          {linkSent && <p role="status" className="text-xs text-accent-300">If an account uses this email, a private sign-in link is on its way. It expires in 15 minutes.</p>}
        </>}
      </form>
    </div>
  );
}

function Dashboard() {
  const account = useAccount();
  const me = account.me!;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bookingId = params.get("rental");
    if (params.get("next") === "verification" && bookingId)
      window.location.replace(accountAccessDestination(bookingId, "verification"));
  }, []);
  const creditBalance = useCreditBalance(account.token ?? null);
  const [tab, setTab] = useState<"rentals" | "calendar" | "invoices" | "chat" | "profile">("rentals");
  function navigateToTab(nextTab: typeof tab) {
    setTab(nextTab);
    if (window.location.hash !== `#${nextTab}`) window.location.hash = nextTab;
  }
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [tab]);
  const unreadMessages =
    useQuery(
      api.rentalChat.unreadTotals,
      account.token && tab !== "chat" ? { token: account.token } : "skip",
    ) ?? 0;
  const availableCreditLabel = creditBalance?.accountId === String(me._id)
    ? `£${creditBalance.available.toFixed(2)}`
    : "£—";
  const encoreCompleted = me.loyaltyCompleted;
  const encoreMilestones = encoreCompleted === null ? 0 : Math.min(3, Math.max(0, encoreCompleted));
  const encoreAssigned = me.loyaltyAdminAssigned === true;
  const encoreHistoricalLevel = Math.min(3, Math.max(0, Number(me.loyaltyHistoricalLevel) || 0));
  const encoreTierLevel = Math.max(encoreMilestones, encoreHistoricalLevel);
  const encoreTierName = encoreAssigned
    ? "Assigned access"
    : encoreCompleted === null || encoreTierLevel === 0
      ? "Building your Encore"
      : `Encore ${["", "I", "II", "III"][encoreTierLevel]}`;
  const encoreProgressLabel = encoreCompleted === null
    ? "Progress unavailable"
    : `${encoreMilestones} / 3 reviewed rentals`;
  const encoreBenefitLabel = encoreAssigned
    ? `Assigned · ${me.loyaltyPercent}% off`
    : encoreHistoricalLevel > encoreMilestones
      ? `Retained · ${me.loyaltyPercent}% off`
    : encoreCompleted === null
      ? "Encore status needs a check"
      : `${me.loyaltyPercent}% off rentals`;
  const encoreNextStep = encoreAssigned
    ? "Assigned access and review-earned progress are tracked separately."
    : encoreCompleted === null
      ? "We’ll show your next tier when rental history is ready."
      : encoreCompleted >= 3
        ? "Top tier reached · no subscription needed."
        : encoreHistoricalLevel > encoreMilestones
          ? encoreHistoricalLevel >= 3
            ? "Your earlier Encore III stays active. You’re already at the top tier."
            : `Your earlier Encore ${["", "I", "II", "III"][encoreHistoricalLevel]} stays active. Honest reviews build the next level.`
      : `Next clean rental + honest review earns ${[2, 4, 10][encoreMilestones]}% off. Every star counts; no subscription needed.`;
  const rentalPages = usePaginatedQuery(
    api.accounts.myBookingsPage,
    account.token && ["rentals", "calendar", "invoices"].includes(tab)
      ? { token: account.token }
      : "skip",
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
    const openCredit=()=>openCreditTile();
    const openProfileSection=(section:"membership"|"security")=>{setTab("profile");if(window.location.hash!==`#${section}`)window.location.hash=section;requestAnimationFrame(()=>requestAnimationFrame(()=>{const target=document.getElementById(`profile-${section}`) as HTMLDetailsElement|null;if(target){target.open=true;target.scrollIntoView({block:"start",behavior:"smooth"})}}))};
    const openFromHash = () => {
      const section=window.location.hash.slice(1).toLowerCase();
      if(section==="credits")openCredit();
      if(section==="membership"||section==="security")openProfileSection(section);
      else if(section==="plans")navigateToTab("rentals");
      else if (["rentals", "calendar", "invoices", "chat", "profile"].includes(section)) setTab(section as typeof tab);
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
    const legacyTab=new URLSearchParams(window.location.search).get("tab");
    if(legacyTab==="membership"||legacyTab==="security")openProfileSection(legacyTab);
    const openChat = (event: Event) => {
      navigateToTab("chat");
      const id = (event as CustomEvent<{ bookingId?: string }>).detail?.bookingId;
      if (id) setChatBooking(id);
    };
    window.addEventListener("dbc:open-account-credit",openCredit);
    window.addEventListener("hashchange", openFromHash);
    window.addEventListener("dbc:open-rental-chat", openChat);
    return () => { window.removeEventListener("dbc:open-account-credit",openCredit);window.removeEventListener("hashchange", openFromHash); window.removeEventListener("dbc:open-rental-chat", openChat); };
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

  function openCreditTile() {
    setTab("rentals");
    if (window.location.hash !== "#credits") window.location.hash = "credits";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById("credits")?.scrollIntoView({ block: "center", behavior: "smooth" });
    }));
  }

  return (
    <ManagementShell role="renter" name={me.name || "My account"} avatarUrl={me.avatarUrl} title={{ rentals: "My rentals", calendar: "Rental calendar", invoices: "Invoices", chat: "Messages", profile: "Profile" }[tab]} active={tab} breadcrumb={<><button type="button" onClick={()=>navigateToTab("rentals")}>Account</button><i aria-hidden="true">/</i><strong aria-current="page">{{rentals:"Rentals",calendar:"Calendar",invoices:"Invoices",chat:"Messages",profile:"Profile"}[tab]}</strong></>}
      nav={[{ key: "rentals", label: "My rentals", icon: "rentals" }, { key: "calendar", label: "Calendar", icon: "calendar" }, { key: "chat", label: "Messages", icon: "messages", badge: unreadMessages }, { key: "invoices", label: "Invoices", icon: "documents" }, { key: "profile", label: "Profile", icon: "people" }]}
      onNavigate={key => navigateToTab(key as typeof tab)} actions={<div className="flex items-center gap-1" data-testid="account-top-actions">
        <Link href="/gear" aria-label="Browse gear" title="Browse gear" className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[.04] text-white/65 transition hover:border-amber-100/30 hover:text-amber-100"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 7h18v13H3zM6 7l2-4h8l2 4M7 20V9m10 11V9M9 13h6"/></svg></Link>
        <a href="/account#credits" onClick={event => { event.preventDefault(); openCreditTile(); }} aria-label={`Account credit ${availableCreditLabel} available`} title={`Account credit · ${availableCreditLabel}`} data-testid="account-credit-shortcut" className="grid h-9 min-w-9 place-items-center rounded-full border border-amber-100/20 bg-amber-100/[.06] px-1.5 text-[9px] font-semibold tabular-nums text-amber-100 transition hover:border-amber-100/40 hover:bg-amber-100/[.12]">{availableCreditLabel}</a>
        <button type="button" onClick={()=>navigateToTab("profile")} aria-label="Open profile" title="Profile" className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-white/10 bg-white/[.04] text-white/65 transition hover:border-amber-100/30 hover:text-amber-100"><ChatAvatar sender="renter" photo={me.avatarUrl} name={me.name || me.email} className="!h-7 !w-7 !rounded-full !bg-transparent" /></button>
        <RenterNotificationBell token={account.token!} accountId={String(me._id)} chatOpen={tab === "chat"}/>
        <button type="button" aria-label="Sign out" title="Sign out" data-testid="account-top-signout" onClick={() => account.signOut()} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[.04] text-white/55 transition hover:border-rose-200/30 hover:text-rose-100"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10"/></svg></button>
      </div>} menuActions={<button type="button" data-testid="account-menu-signout" onClick={() => account.signOut()}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10"/></svg>Sign out</button>}>
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
            {me.membershipActive && me.membershipTier && (
              <span className="rounded-full bg-accent-500/15 px-2 py-0.5 font-medium text-accent-300">
                {tierByKey(me.membershipTier)?.name ?? me.membershipTier} member
              </span>
            )}
          </p>
        </div>
      </AccountProfilePill>}

      {tab === "calendar" && <div className="mt-6 max-w-3xl"><RentalCalendar bookings={bookings as any} loading={rentalPages.status !== "Exhausted"} onOpenRental={id=>{setChatBooking(id);navigateToTab("chat");}} /></div>}
      {tab === "invoices" && <><InvoiceLibrary rentals={bookings} token={account.token!} /><AccountCreditReceipts token={account.token!}/></>}
      {["calendar", "invoices"].includes(tab) && rentalPages.status === "CanLoadMore" && <button onClick={() => rentalPages.loadMore(30)} className="mt-5 rounded-lg border border-white/15 px-5 py-2 text-xs text-white/70">Load older rentals and documents</button>}

      {/* Renter overview: equipment, calendar and conversations first. */}
      {tab === "rentals" && <>
        <section className="mt-5 grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Account benefits" data-testid="renter-benefit-tiles">
          <article id="credits" className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_100%_0%,rgba(210,174,132,.12),transparent_58%),linear-gradient(145deg,rgba(255,255,255,.055),rgba(18,20,20,.96)_68%)] p-3 transition hover:border-amber-100/25" data-testid="account-credit-tile">
            <span className="pointer-events-none absolute -right-5 -top-8 h-24 w-24 rounded-full border border-amber-100/10" aria-hidden="true" />
            <div className="flex items-center gap-2 text-amber-100/65">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg>
              <p className="text-[11px] font-medium uppercase tracking-[.15em]">Account credit</p>
            </div>
            <p className="mt-3 font-display text-3xl leading-none text-white" data-testid="account-credit-balance">{creditBalance?.accountId === String(me._id) ? `£${creditBalance.available.toFixed(2)}` : "Loading…"}</p>
            <p data-testid="account-credit-summary" className="mt-2 text-xs leading-4 text-white/55">Earned credit competes with other savings. Refund credit can pay the remaining balance. Check each credit’s expiry.</p>
            <Link href="/account#invoices" className="mt-auto inline-flex min-h-8 items-end pt-3 text-xs text-amber-100/75 underline decoration-amber-100/25 underline-offset-4">History &amp; expiry <span aria-hidden="true" className="ml-1">↗</span></Link>
          </article>
          <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-amber-100/15 bg-[radial-gradient(ellipse_at_100%_0%,rgba(235,199,158,.13),transparent_58%),linear-gradient(145deg,rgba(235,199,158,.06),rgba(18,20,20,.96)_68%)] p-3 transition hover:border-amber-100/30" aria-label={`Encore: ${encoreTierName}, ${encoreProgressLabel}, ${encoreBenefitLabel}`} data-testid="account-encore-tile">
            <div className="flex items-center gap-2 text-amber-100/70"><EncoreCrest level={Math.max(1,me.loyaltyLevel)} className="h-7 w-7 shrink-0 text-amber-100/80"/><div><p className="text-[11px] font-medium uppercase tracking-[.15em]">Encore</p><p className="mt-0.5 text-[10px] text-white/55">{encoreTierName}</p></div><span className="ml-auto rounded-full border border-amber-100/15 bg-amber-100/[.06] px-2 py-1 text-[10px] font-medium text-amber-50">{me.loyaltyPercent}% off</span></div>
            <p data-testid="account-encore-progress" className="mt-3 font-display text-lg leading-tight text-white">{encoreProgressLabel}</p>
            <div className="mt-3 grid grid-cols-3 gap-1.5" aria-hidden="true">
              {[0, 1, 2].map(step => <span key={step} className={`h-1.5 rounded-full ${step < encoreMilestones ? "bg-gradient-to-r from-amber-100/90 to-amber-300/70 shadow-[0_0_10px_rgba(235,199,158,.18)]" : "bg-white/10"}`} />)}
            </div>
            <p data-testid="account-encore-summary" className="mt-2 text-xs leading-5 text-white/55">{encoreNextStep}</p>
            <span className="sr-only">Each separate clean, completed rental counts after you submit an honest review. Every star rating counts equally; no subscription is needed.</span>
          </article>
          {account.token&&<div className="min-w-0 sm:col-span-2 lg:col-span-1"><ReferralPanel token={account.token}/></div>}
        </section>
        <RenterOverview bookings={bookings as any} token={account.token!}
          historyLoading={rentalPages.status !== "Exhausted"} unreadMessages={unreadMessages}
          onOpenChat={id=>{setChatBooking(id??null);navigateToTab("chat");}}
          onOpenCalendar={()=>navigateToTab("calendar")}/>
        <Favourites />
        <Link href="/rental-stories" className="mt-5 inline-flex items-center gap-2 text-xs text-amber-200/80">Your set story could win £{REVIEW_PRIZE_GBP} · enter &amp; track →</Link>
      </>}

      {/* CHAT */}
      {tab === "chat" && (
        <div className="tab-in mt-6" id="renter-chat">
          <RenterChat focusBookingId={chatBooking} />
        </div>
      )}

      {/* PROFILE & SETTINGS */}
      {tab === "profile" && (
        <div className="tab-in mt-6 space-y-6">
          <div className="grid gap-3 lg:grid-cols-2" data-testid="profile-membership-security">
            <details id="profile-membership" className="group rounded-2xl border border-white/10 bg-[#141414] p-5" data-testid="profile-membership-settings">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm text-white/80"><span><strong className="block font-medium">Membership</strong><span className="mt-1 block text-xs text-white/45">{me.membershipActive && me.membershipTier ? `${tierByKey(me.membershipTier)?.name ?? me.membershipTier} plan` : "Plans, billing and member benefits"}</span></span><span className="text-accent-200 transition group-open:rotate-45" aria-hidden="true">＋</span></summary>
              <div className="mt-5"><Membership /><p className="mt-4 text-xs text-white/45">Pro and Studio weekend deals apply automatically to eligible website rentals.</p></div>
            </details>

            <details id="profile-security" className="group rounded-2xl border border-white/10 bg-[#141414] p-5" data-testid="profile-security-settings">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm text-white/80"><span><strong className="block font-medium">Security &amp; privacy</strong><span className="mt-1 block text-xs text-white/45">Password, account access and private photo settings</span></span><span className="text-accent-200 transition group-open:rotate-45" aria-hidden="true">＋</span></summary>
              <div className="mt-5 space-y-4"><AccountSecurity />{account.token && <PrivatePortraitPreference key={account.token} token={account.token} />}</div>
            </details>
          </div>

          <section aria-label="Profile details" className="rounded-3xl border border-white/[0.07] bg-[#141414] p-6">
            <div className="mt-4">
              <AvatarUpload />
            </div>
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
              Email me offers and promotions

            </label>
            <p className="mt-2 text-xs text-white/45">Booking reminders are separate from promotional emails and may be sent for your rentals.</p>
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
    </ManagementShell>
  );
}

function Favourites() {
  const account = useAccount();
  const ids = (account.me?.favorites ?? []) as any[];
  const favs =
    useQuery(api.catalog.listingsByIds, ids.length ? { ids } : "skip") ?? [];
  return (
    <section id="favorites" className="mt-8" data-testid="renter-favourites">
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
          placeholder="New password (8+ chars)"
          minLength={8}
          maxLength={256}
          className="input"
        />
        {msg && <div className="text-xs text-emerald-300">{msg}</div>}
        {err && <div className="text-xs text-red-300">{err}</div>}
        <button
          onClick={changePw}
          disabled={!oldp || newp.length < 8 || newp.length > 256}
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
  const [billingError,setBillingError]=useState("");
  const tokenRef=useRef(account.token),mounted=useRef(true);
  tokenRef.current=account.token;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setBillingError("");setBusy(false);},[account.token]);
  const tier = account.me?.membershipActive
    ? tierByKey(account.me.membershipTier)
    : null;
  const hasBillingSubscription = account.me?.membershipHasBillingSubscription ?? !!account.me?.membershipBillingTier;

  async function manage() {
    const token=account.token;if(!token||busy)return;
    setBusy(true);
    setBillingError("");
    try {
      const { url } = await portal({
        token,
        origin: window.location.origin,
      });
      if(mounted.current&&tokenRef.current===token)window.location.href = url;
    } catch {
      if(mounted.current&&tokenRef.current===token)setBillingError("We couldn't open billing settings. Please try again or contact the team in chat.");
    } finally {
      if(mounted.current&&tokenRef.current===token)setBusy(false);
    }
  }
  async function join(_tierKey: string) { window.location.href = "/membership"; }

  // ── active member: what they're getting + manage ──
  if (tier) {
    return (
      <section>
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[.16em] text-accent-300">Your {tier.name} membership</p>
        <div className="max-w-md"><MembershipPlanCard tier={tier} compact onSelect={manage} disabled={busy || !!(account.me?.membershipAdminGranted && !hasBillingSubscription)} label={busy ? "Opening settings…" : account.me?.membershipAdminGranted && !hasBillingSubscription ? "Granted by DB Cinema" : "Membership settings / cancel"} /></div>
        {billingError && <p role="alert" className="mt-3 max-w-md rounded-xl border border-amber-200/25 bg-amber-200/5 p-3 text-sm text-amber-100">{billingError}</p>}
        {account.me?.membershipAdminGranted && <p className="mt-3 max-w-md text-xs leading-5 text-white/50">DB Cinema has granted this plan’s access. Monthly credit is issued only for paid subscription invoices; this access grant does not waive or authorise rental-security claims. {hasBillingSubscription ? `Your ${tierByKey(account.me.membershipBillingTier)?.name ?? "linked"} subscription is managed separately.` : "This grant does not start a subscription or monthly charges."}</p>}
        {account.me?.membershipStatus === "trialing" && <p className="mt-3 text-xs text-amber-200">Free week: membership billing only. Rental-security terms are set separately in each accepted rental agreement.</p>}
        {account.me?.membershipCancelAtPeriodEnd && <p className="mt-3 text-xs text-white/45">Cancellation scheduled. Your plan will not renew.</p>}
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-white/[0.07] bg-[#141414] p-5 sm:p-6">
      <div className="hud-label !text-accent-400/90">Db Cinema Membership</div>
      {hasBillingSubscription && <div className="my-4 max-w-md rounded-xl border border-white/10 p-4"><p className="text-xs leading-5 text-white/60">Your {tierByKey(account.me?.membershipBillingTier)?.name ?? "linked"} subscription billing can still be managed here, even when membership access is inactive.</p><button type="button" onClick={manage} disabled={busy} className="mt-3 text-xs text-accent-200 underline">{busy ? "Opening settings…" : "Manage / cancel paid subscription"}</button></div>}
      {billingError && <p role="alert" className="mt-3 max-w-md rounded-xl border border-amber-200/25 bg-amber-200/5 p-3 text-sm text-amber-100">{billingError}</p>}
      <h2 className="mt-2 font-display text-3xl font-bold text-white">More room for <span className="serif-accent gradient-text">your next story.</span></h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/55">Turn your monthly membership into rental credit, with extra credit on top. Keep it for your next shoot or let it build towards something bigger.</p>
      <div className="mt-6 grid items-stretch gap-4 lg:grid-cols-3" data-testid="account-membership-plans">
        {TIERS.map(t => <MembershipPlanCard key={t.key} tier={t} compact onSelect={() => join(t.key)} label={`Explore ${t.name}`} />)}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/40">
        <span>Monthly renewal · credits valid for one year · rental-security terms still apply</span>
        <Link href="/membership" className="text-accent-300 hover:underline">
          Compare plans in detail →
        </Link>
      </div>
    </section>
  );
}
