"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import type { Id } from "@cvx/_generated/dataModel";
import { AccountDocuments } from "./AccountDocuments";
import { SmartImage } from "@/components/SmartImage";
import { formatGbp } from "@/lib/pricing";
import styles from "./AccountAdmin.module.css";
import { AdminInvoiceLibrary } from "@/components/management/AdminInvoiceLibrary";
import {AccountCreditPanel} from "./AccountCreditPanel";
import { RentalConversation } from "@/components/rentals/RentalConversation";
import { RentalOrderTools } from "./RentalOrderTools";
import { PrivateVerificationPortrait } from "./PrivateVerificationPortrait";
import { RentalVerificationSummary } from "@/components/rentals/RentalVerificationSummary";
import { SavedCardCharges } from "@/components/rentals/SavedCardCharges";

const LEVELS = [
  ["automatic", "Automatic"],
  ["standard", "Standard"],
  ["plus", "Starter"],
  ["pro", "Pro"],
  ["studio", "Studio"],
] as const;
const ENCORE_LEVELS = [
  ["automatic", "Automatic · earned progress"],
  ["1", "Encore I · 2%"],
  ["2", "Encore II · 4%"],
  ["3", "Encore III · 10%"],
] as const;
const label = (value: string) =>
  LEVELS.find(([key]) => key === value)?.[1] ?? value;
const encoreLabel = (value: string) =>
  ENCORE_LEVELS.find(([key]) => key === value)?.[1] ?? value;
const encoreName = (level: number) => ["", "Encore I", "Encore II", "Encore III"][level] ?? "";
const billingStatus = (status: string | null | undefined) => ({
  active: "Active", trialing: "Free trial", past_due: "Payment overdue", unpaid: "Unpaid",
  canceled: "Canceled", incomplete: "Incomplete", incomplete_expired: "Expired", paused: "Paused", provider_missing: "Stripe record needs review",
} as Record<string, string>)[status ?? ""] ?? (status ? status.replaceAll("_", " ") : "Status unavailable");
function subscriptionSummary(detail: { hasBillingCustomer: boolean; membershipStatus?: string | null }) {
  if (!detail.hasBillingCustomer) return { label: "Not linked", tone: "muted" as const };
  if (!detail.membershipStatus) return { label: "No plan", tone: "muted" as const };
  if (detail.membershipStatus === "active" || detail.membershipStatus === "trialing")
    return { label: detail.membershipStatus === "trialing" ? "Trial" : "Active", tone: "ready" as const };
  if (["past_due", "unpaid", "incomplete", "incomplete_expired", "provider_missing"].includes(detail.membershipStatus ?? ""))
    return { label: detail.membershipStatus === "provider_missing" ? "Check Stripe" : "Payment due", tone: "attention" as const };
  return { label: billingStatus(detail.membershipStatus), tone: "muted" as const };
}
const actionPaths: Record<string, string> = {
  overview: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a8 8 0 0 1 16 0v2",
  rentals: "M4 5h16v15H4zM4 9h16M8 3v4m8-4v4",
  "rental-actions": "M4 6h16M7 3v6M17 3v6M4 13h16M9 10v6M4 20h16M15 17v6",
  payments: "M3 6h18v12H3zM3 10h18m-14 4h4m6 0h1",
  verification: "M12 3 4 6v5c0 5 3 8 8 10 5-2 8-5 8-10V6l-8-3Zm-3 9 2 2 4-4",
  documents: "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6",
  invoices: "M4 6h16v13H4zM4 10h16m-12 5h4",
  billing: "M3 6h18v12H3zM3 10h18m-14 4h3",
  membership: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a8 8 0 0 1 16 0v2m-5-8 2 2 4-4",
  credits: "M3 7h18v12H3zM3 10h18m-4 4h1",
  access: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  notes: "m5 19 1-4L17 4l3 3L9 18l-4 1zM14 7l3 3",
  restriction: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.6 18.4 18.4 5.6",
};
function ActionIcon({name}: {name: string}) {
  return <svg className={styles.actionIcon} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={actionPaths[name]}/></svg>;
}
function PossibleIdentityMatch({ token, bookingId }: { token: string; bookingId: string }) {
  const result = useQuery(api.accountAdmin.possibleRestrictedIdentityMatches, { token, bookingId: bookingId as any });
  if (!result?.matches.length) return null;
  return <section className={styles.identityWarning} role="status"><strong>Possible identity match</strong><p>Name + DOB match · compare manually.<span className={styles.visuallyHidden}> This never blocks a rental.</span></p>{result.matches.map((match: {id: string; name: string | null; email: string; blockedReason: string | null}) => <p key={match.id}>{match.name || "Unnamed customer"} · {match.email}{match.blockedReason ? ` · ${match.blockedReason}` : ""}</p>)}{result.more && <p>More matches · open customer directory.</p>}</section>;
}
type Level = (typeof LEVELS)[number][0];
type EncoreLevel = (typeof ENCORE_LEVELS)[number][0];
type ProfileDraft = {
  accountId: string;
  name: string;
  phone: string;
  address: string;
  reason: string;
  expected: { name: string | null; phone: string | null; address: string | null };
};

type AccountRentalOption = {id:string;title:string;status:string;start:number;end:number};
function AccountPayments({token,rentals}:{token:string;rentals:AccountRentalOption[]}) {
  const [bookingId,setBookingId]=useState(rentals[0]?.id??"");
  useEffect(()=>{if(!rentals.some(r=>r.id===bookingId))setBookingId(rentals[0]?.id??"");},[bookingId,rentals]);
  return <section className={styles.card} aria-label="Customer payments" data-testid="admin-account-payments">
    <header><h3>Payments &amp; saved-card claims</h3></header>
    {!rentals.length?<p className={styles.empty}>No rentals are linked to this account.</p>:<>
      <label className={styles.paymentRentalSelect}>Rental<select aria-label="Rental for payment controls" value={bookingId} onChange={e=>setBookingId(e.target.value)}>
        {rentals.map(r=><option key={r.id} value={r.id}>{r.title} · {new Date(r.start).toLocaleDateString("en-GB")}–{new Date(r.end).toLocaleDateString("en-GB")} · {r.status.replaceAll("_"," ")}</option>)}
      </select></label>
      {bookingId?<SavedCardCharges key={bookingId} token={token} bookingId={bookingId} admin/>:null}
    </>}
  </section>;
}

export function AccountAdmin({
  token,
  onRental,
  onConversation,
  onDocumentsChange,
}: {
  token: string;
  onDocumentsChange?: (customer: string | null) => void;
  onRental?: (id: string) => void;
  onConversation?: (accountId: string, bookingId: string | null) => void;
}) {
  const profileRef = useRef<HTMLElement>(null);
  const verificationRef = useRef<HTMLSelectElement>(null);
  const membershipRef = useRef<HTMLSelectElement>(null);
  const encoreRef = useRef<HTMLSelectElement>(null);
  const [accessTarget, setAccessTarget] = useState<{ sequence: number } | null>(null);
  const [input, setInput] = useState(""),
    [email, setEmail] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("automatic"),
    [encoreLevel, setEncoreLevel] = useState<EncoreLevel>("automatic"),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [confirmBlock, setConfirmBlock] = useState<{ blockedAt: number | null; noticeId: Id<"account_restriction_notices"> | null; reason: string; revision: number } | null>(null);
  const [message, setMessage] = useState("");
  const filter = "all" as const;
  const [tierFilter, setTierFilter] = useState<"all" | "standard" | "plus" | "pro" | "studio">("all"),
    [page, setPage] = useState(0);
  const [encoreFilter, setEncoreFilter] = useState<"all" | "automatic" | "1" | "2" | "3">("all");
  const [directoryView, setDirectoryView] = useState<"all" | "unread" | "starred">("all");
  const [selecting, setSelecting] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"directory" | "conversation" | "profile">("directory");
  const [verificationFilter, setVerificationFilter] = useState<"all" | "verified" | "pending">("all");
  const [checked, setChecked] = useState<string[]>([]);
  const [section, setSection] = useState("closed"),
    [panelClosed, setPanelClosed] = useState(false);
  useEffect(() => {
    setReason("");
    setConfirmBlock(null);
    setMessage("");
  }, [section]);
  useEffect(() => {
    if (section !== "access" || !accessTarget) return;
    const frame = requestAnimationFrame(() => {
      const target = membershipRef.current;
      target?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [section, accessTarget]);
  const openAccess = () => {
    if (section === "access") {
      setSection("closed");
      return;
    }
    setSection("access");
    setAccessTarget(current => ({ sequence: (current?.sequence ?? 0) + 1 }));
  };
  const [note, setNote] = useState(""),
    [noteBusy, setNoteBusy] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const addNote = useMutation(api.accountAdmin.addNote);
  const updateProfile = useMutation(api.accountAdmin.updateProfile);
  useEffect(() => {
    const timer = setTimeout(() => setEmail(input), 200);
    return () => clearTimeout(timer);
  }, [input]);
  const authorized = useQuery(api.accountAdmin.directoryAccess, { token });
  const { results: visible, status, loadMore } = usePaginatedQuery(
    api.accountAdmin.directory,
    authorized ? { token, search: email, filter, tier: tierFilter, encore: encoreFilter, verification: verificationFilter, view: directoryView } : "skip",
    { initialNumItems: 100 },
  );
  const { results: messageSearchRows, status: messageSearchStatus, loadMore: loadMoreMessageMatches } = usePaginatedQuery(api.accountAdmin.searchMessages,
    authorized && email.trim().length >= 2
      ? { token, search: email, filter, tier: tierFilter, encore: encoreFilter, verification: verificationFilter, view: directoryView } : "skip",
    { initialNumItems: 100 },
  );
  // A customer may have many matching messages across cursor pages. Keep one
  // row per account while retaining the first (highest ranked) matching text.
  const messageMatches = [...new Map(messageSearchRows.map(account => [account.id, account])).values()];
  const messageSearchActive = authorized === true && email.trim().length >= 2;
  const messagesByAccount = new Map(messageMatches.map(account => [account.id, account.matchedMessage]));
  const matchingAccounts = [
    ...visible.map(account => ({ ...account, matchedMessage: messagesByAccount.get(account.id) })),
    ...messageMatches.filter(account => !visible.some(row => row.id === account.id)),
  ];
  const [verificationNow, setVerificationNow] = useState(() => Date.now());
  const nextVerificationExpiry = matchingAccounts.reduce<number | null>((next, account) => {
    const expiry = account.verifiedUntil;
    return account.verified && typeof expiry === "number" && expiry > verificationNow && (next === null || expiry < next) ? expiry : next;
  }, null);
  useEffect(() => {
    const refresh = () => setVerificationNow(Date.now());
    const timer = nextVerificationExpiry === null ? undefined : window.setTimeout(refresh, Math.min(2147483647, Math.max(1, nextVerificationExpiry - Date.now() + 1)));
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { if (timer !== undefined) window.clearTimeout(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [nextVerificationExpiry]);
  const isCurrentlyVerified = (account: { verified: boolean; verifiedUntil?: number | null }) => account.verified && typeof account.verifiedUntil === "number" && account.verifiedUntil > verificationNow;
  const searchPending = input !== email || authorized === undefined || status === "LoadingFirstPage" || messageSearchActive && messageSearchStatus === "LoadingFirstPage";
  const selected = !authorized || searchPending ? undefined :
    matchingAccounts.find((a) => a.id === selectedId) ?? matchingAccounts[0];
  // Replaced during render so a result cannot reach a different profile,
  // including closing and reopening the same account or changing admin session.
  const scope = useRef<{ token: string; accountId: string | undefined; panelClosed: boolean }>({ token, accountId: selected?.id, panelClosed });
  if (scope.current.token !== token || scope.current.accountId !== selected?.id || scope.current.panelClosed !== panelClosed)
    scope.current = { token, accountId: selected?.id, panelClosed };
  const currentScope = scope.current;
  const starInFlight = useRef(new Set<string>());
  const [pendingStars, setPendingStars] = useState<Set<string>>(() => new Set());
  const [starState, setStarState] = useState<{ scope: typeof currentScope; pending: boolean; error?: string } | null>(null);
  const detail = useQuery(
    api.accountAdmin.detail,
    selected && !panelClosed ? { token, accountId: selected.id } : "skip",
  );
  const reviewQueue = useQuery(api.accountAdmin.verificationReviews, selected && !panelClosed ? {token,accountId:selected.id as any} : "skip");
  const history = useQuery(
    api.accountAdmin.history,
    selected ? { token, accountId: selected.id } : "skip",
  );
  const setAccountLevel = useMutation(api.accountAdmin.setLevel);
  const setAccountEncoreLevel = useMutation(api.accountAdmin.setEncoreLevel);
  const setBlocked = useMutation(api.accountAdmin.setBlocked);
  const setStarred = useMutation(api.accountAdmin.setStarred);
  const openStripeBilling = useAction(api.checkout.adminBillingPortal);
  useEffect(() => {
    setLevel((selected?.override ?? "automatic") as Level);
    setEncoreLevel((selected?.encoreOverride ?? "automatic") as EncoreLevel);
    setReason("");
    setConfirmBlock(null);
    setProfileDraft(null);
  }, [selected?.id, selected?.override, selected?.encoreOverride, selected?.blocked, selected?.blockedAt, selected?.restrictionNoticeId, selected?.blockedReason, selected?.restrictionRevision, token, panelClosed]);
  useEffect(() => {
    setMessage("");
    setSection("closed");
    setNote("");
    setProfileDraft(null);
    setBusy(false);
    setNoteBusy(false);
  }, [currentScope]);
  useEffect(() => setPage(0), [email, filter, tierFilter, encoreFilter, verificationFilter, directoryView]);
  const pages = Math.max(1, Math.ceil(matchingAccounts.length / 10));
  const currentPage = page;
  const displayRows = searchPending ? [] : matchingAccounts.slice(page * 10, page * 10 + 10);
  const metrics = useQuery(api.accountAdmin.directoryMetrics, authorized && !searchPending
    ? { token, accountIds: [...new Set([...displayRows.map(a => a.id), ...(selected ? [selected.id] : [])])] } : "skip");
  const privatePortraitsAvailable = useQuery(api.privateVerificationPortrait.availability, authorized ? { token } : "skip");
  const effectiveEncoreFor = (account: { id: string; encoreOverride: string }) =>
    account.encoreOverride !== "automatic" ? Number(account.encoreOverride) : metrics?.find(metric => metric.id === account.id)?.encoreLevel ?? null;
  const unreadMessagesFor = (accountId: string) => metrics?.find(metric => metric.id === accountId)?.unreadMessages ?? 0;
  useEffect(() => setChecked([]), [token, page, email, filter, tierFilter, encoreFilter, verificationFilter]);
  const exhausted = status === "Exhausted";
  const loading = searchPending || status === "LoadingMore" || status === "CanLoadMore" && visible.length < (page + 1) * 10 + 1;
  useEffect(() => {
    if (authorized && input === email && status === "CanLoadMore" && visible.length < (page + 1) * 10 + 1)
      loadMore(100);
  }, [authorized, input, email, status, visible.length, page, loadMore]);
  useEffect(() => {
    if (exhausted && page >= pages) setPage(pages - 1);
  }, [exhausted, page, pages]);
  useEffect(() => {
    onDocumentsChange?.(null);
    return () => onDocumentsChange?.(null);
  }, [onDocumentsChange]);
  const date = (at: number | null) =>
    at
      ? new Date(at).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "Not recorded";
  function selectAccount(id: string) {
    if (scope.current.accountId !== id || scope.current.panelClosed)
      scope.current = { token, accountId: id, panelClosed: false };
    setSelectedId(id);
    setActiveConversationId(null);
    setPanelClosed(false);
    if (window.matchMedia("(max-width:1100px)").matches) {
      setMobilePane("conversation");
      requestAnimationFrame(() =>
        profileRef.current?.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        }),
      );
    }
  }
  async function saveNote() {
    if (!selected || panelClosed || searchPending || noteBusy || !note.trim()) return;
    const origin = scope.current;
    setNoteBusy(true);
    setMessage("");
    try {
      await addNote({ token, accountId: selected.id, text: note });
      if (scope.current === origin) setNote("");
    } catch (e) {
      if (scope.current === origin) setMessage(e instanceof Error ? e.message : "Could not save note.");
    } finally {
      if (scope.current === origin) setNoteBusy(false);
    }
  }
  async function saveProfile() {
    if (!selected || !detail || panelClosed || searchPending || busy || !profileDraft || profileDraft.accountId !== selected.id) return;
    const origin = scope.current;
    setBusy(true);
    setMessage("");
    try {
      await updateProfile({
        token,
        accountId: selected.id as any,
        name: profileDraft.name,
        phone: profileDraft.phone,
        address: profileDraft.address,
        expected: profileDraft.expected,
        reason: profileDraft.reason,
      });
      if (scope.current === origin) {
        setProfileDraft(null);
        setMessage("Account details saved.");
      }
    } catch (error) {
      if (scope.current === origin) setMessage(error instanceof Error ? error.message : "Could not save account details.");
    } finally {
      if (scope.current === origin) setBusy(false);
    }
  }
  async function toggleStar() {
    if (!selected || panelClosed || searchPending) return;
    const key = JSON.stringify([token, selected.id]);
    if (starInFlight.current.has(key)) return;
    const origin = scope.current;
    starInFlight.current.add(key);
    setPendingStars(previous => new Set(previous).add(key));
    setStarState({ scope: origin, pending: true });
    try {
      await setStarred({ token, accountId: selected.id, starred: !selected.starred });
      if (scope.current === origin) setStarState(null);
    } catch {
      if (scope.current === origin) setStarState({ scope: origin, pending: false, error: "Could not confirm the favourite update. Check the star before retrying." });
    } finally {
      starInFlight.current.delete(key);
      setPendingStars(previous => { const next = new Set(previous); next.delete(key); return next; });
    }
  }
  async function apply(kind: "level" | "encore" | "block") {
    if (!selected || panelClosed || busy || searchPending || (kind === "block" && (!confirmBlock || !reason.trim()))) return;
    const origin = scope.current;
    setBusy(true);
    setMessage("");
    try {
      if (kind === "level")
        await setAccountLevel({ token, accountId: selected.id, level, expectedLevel: selected.override as Level, reason });
      else if (kind === "encore")
        await setAccountEncoreLevel({
          token,
          accountId: selected.id,
          level: encoreLevel === "automatic" ? "automatic" : Number(encoreLevel) as 1 | 2 | 3,
          expectedLevel: selected.encoreOverride === "automatic" ? "automatic" : Number(selected.encoreOverride) as 1 | 2 | 3,
          reason,
        });
      else
        await setBlocked({
          token,
          accountId: selected.id,
          blocked: confirmBlock!.blockedAt === null,
          reason,
          expected: confirmBlock!,
        });
      if (scope.current !== origin) return;
      setMessage(
        kind === "level"
          ? "Account level updated."
          : kind === "encore"
            ? "Encore level updated."
            : selected.blocked
            ? "Account unblocked. They can sign in again."
            : "Account blocked. Sessions and sign-in links revoked.",
      );
      setConfirmBlock(null);
    } catch (error) {
      if (scope.current !== origin) return;
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update this account.",
      );
    } finally {
      if (scope.current === origin) setBusy(false);
    }
  }
  async function openBilling() {
    if (!selected || panelClosed || busy || searchPending) return;
    if (!detail?.hasBillingCustomer) {
      setMessage("No linked Stripe customer is available for this account.");
      return;
    }
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setMessage("Allow pop-ups to open Stripe billing settings.");
      return;
    }
    popup.opener = null;
    const origin = scope.current;
    setBusy(true);
    setMessage("");
    try {
      const result = await openStripeBilling({ token, accountId: selected.id });
      if (scope.current !== origin) { popup.close(); return; }
      popup.location.replace(result.url);
      setMessage("Stripe billing settings opened in a new tab.");
    } catch (error) {
      popup.close();
      if (scope.current === origin) setMessage(error instanceof Error ? error.message : "Could not open billing settings.");
    } finally {
      if (scope.current === origin) setBusy(false);
    }
  }
  function rentalRows(limit = 100) {
    return !detail?.rentals.length ? (
      <p className={styles.empty}>No rental requests linked to this account.</p>
    ) : (
      detail.rentals.slice(0, limit).map((rental) => (
        <button
          type="button"
          key={rental.id}
          className={styles.rental}
          onClick={() => onRental?.(rental.id)}
          disabled={!onRental}
        >
          <div className={styles.kitPhotos} aria-label="Booked equipment">
            {(rental.items?.length ? rental.items.map(item => ({ ...item, imageSources: item.imageSources?.length ? item.imageSources : item.heroImage ? [item.heroImage] : rental.items?.length === 1 ? rental.imageSources ?? [] : [] })) : [{ title: rental.title, qty: rental.quantity, imageSources: rental.imageSources }]).map((item, index) => {
              const imageSources = Array.isArray(item.imageSources) ? item.imageSources : [];
              return (
                <div className={styles.kitPhotoWrap} key={index} title={`${item.title}${item.qty > 1 ? ` ×${item.qty}` : ""}`}>
                  <SmartImage fit="contain" src={imageSources[0]} fallbackSources={imageSources.slice(1)} alt={item.title} className={styles.kitPhoto} />
                  {item.qty > 1 && <span className={styles.kitQuantity}>×{item.qty}</span>}
                </div>
              );
            })}
          </div>
          <span className={styles.rentalTitle}>
            <strong>{rental.title}</strong>
            <small>
              {date(rental.start)} · {rental.quantity} items
            </small>
          </span>
          <span className={styles.status}>
            {rental.status.replaceAll("_", " ")}
          </span>
        </button>
      ))
    );
  }
  const activeConversation = activeConversationId
    ? detail?.conversations.find(thread => thread.id === activeConversationId) ?? null
    : null;
  const activeRental = activeConversation?.bookingId
    ? detail?.rentals.find(rental => rental.id === activeConversation.bookingId) ?? null
    : null;
  const supportConversation = detail?.conversations.find(thread => !thread.bookingId) ?? null;
  const reviewRentals = reviewQueue?.items ?? [];
  const currentPlan = detail ? subscriptionSummary(detail) : null;
  const currentPlanLabel = currentPlan
    ? ["Not linked", "No plan"].includes(currentPlan.label) ? "No plan" : currentPlan.label
    : selected?.hasSubscription ? "Plan loading…" : "No plan";
  const profileSections = [
    ["overview", "Account details"],
    ["rentals", "Rentals"],
    ["rental-actions", "Rental actions"],
    ["payments", "Payments"],
    ...(reviewRentals.length ? [["verification", "Verification"]] : []),
    ["documents", "Documents"],
    ["invoices", "Invoices"],
    ["credits", "Credits"],
    ["restriction", selected?.blocked ? "Unblock account" : "Restrict account"],
    ["notes", "Notes"],
  ];
  return (
    <section data-testid="admin-accounts" className={styles.root} data-mobile-pane={mobilePane}>
      <h1 className={styles.srOnly}>Customers &amp; Members</h1>
      <nav className={styles.mobileWorkspaceNav} data-testid="admin-mobile-workspace-nav" aria-label="Customer workspace views">
        <button type="button" aria-pressed={mobilePane === "directory"} onClick={() => setMobilePane("directory")}>Customers</button>
        <button type="button" disabled={!selected} aria-pressed={mobilePane === "conversation"} onClick={() => setMobilePane("conversation")}>Chat{selected && unreadMessagesFor(selected.id) > 0 ? <span>{unreadMessagesFor(selected.id) > 99 ? "99+" : unreadMessagesFor(selected.id)}</span> : null}</button>
        <button type="button" disabled={!selected} aria-pressed={mobilePane === "profile"} onClick={() => { setPanelClosed(false); setMobilePane("profile"); }}>Profile</button>
      </nav>
      {checked.length > 0 && <div className={styles.pageTools}>
        <button type="button" className={styles.filterButton} onClick={() => {
          const csvValue = (value: string) => '"' + (/^[=+@\-\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""') + '"';
          const csv = ["Name,Email,Membership,Verified", ...displayRows.filter(a => checked.includes(a.id)).map(a => [a.name, a.email, label(a.tier), isCurrentlyVerified(a) ? "Verified" : "Pending"].map(csvValue).join(","))].join("\r\n");
          const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "db-cinema-customers.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Export {checked.length}</button>
      </div>}
      <div className={styles.directory} data-testid="admin-customer-directory">
        <div className={styles.directoryToolbar} data-testid="admin-directory-toolbar">
          <label className={styles.directorySearch} data-testid="admin-directory-search"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg><span className={styles.srOnly}>Search customers and chat messages</span><input data-testid="account-email-search" type="search" maxLength={254} placeholder="Name or chat…" value={input} onChange={e => { setInput(e.target.value); setSelectedId(null); setPanelClosed(false); }} /></label>
          <div className={styles.viewFilters} aria-label="Conversation views">{([['all','All'],['unread','Unread'],['starred','Starred']] as const).map(([value, title]) => <button key={value} type="button" aria-pressed={directoryView === value} onClick={() => { setDirectoryView(value); setSelectedId(null); }}>{value === 'starred' && <ActionIcon name="access" />}{title}</button>)}</div>
        </div>
        <div className={styles.filters}>
          <label>
            <span className={styles.filterLabel}>Membership tier</span>
            <select
              value={tierFilter}
              onChange={(e) => { setTierFilter(e.target.value as typeof tierFilter); setPage(0); setSelectedId(null); }}
            >
              <option value="all">All tiers</option>
              <option value="standard">Guest / no membership</option>
              {LEVELS.filter(([key]) => key !== "automatic" && key !== "standard").map(
                ([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            <span className={styles.filterLabel}>Encore Tier</span>
            <select aria-label="Encore Tier" value={encoreFilter} onChange={e => { setEncoreFilter(e.target.value as typeof encoreFilter); setPage(0); setSelectedId(null); }}>
              <option value="all">All Encore</option>
              <option value="automatic">Automatic / earned tier</option>
              <option value="1">Encore I</option>
              <option value="2">Encore II</option>
              <option value="3">Encore III</option>
            </select>
          </label>
          <div className={styles.filterActions} data-testid="admin-account-filter-actions"><button className={styles.clearFilters} type="button" onClick={() => { setTierFilter("all"); setEncoreFilter("all"); setVerificationFilter("all"); setDirectoryView("all"); setInput(""); setSelectedId(null); }}>Clear filters</button><details><summary>Verification{verificationFilter !== "all" ? ` · ${verificationFilter}` : ""}</summary><label><span className={styles.srOnly}>Verification filter</span><select ref={verificationRef} aria-label="Verification status" value={verificationFilter} onChange={e => { setVerificationFilter(e.target.value as typeof verificationFilter); setPage(0); setSelectedId(null); }}><option value="all">All verification status</option><option value="verified">Verified</option><option value="pending">Pending</option></select></label></details></div>
        </div>
        <div className={styles.customerList}>
          {selecting && <div className={styles.selectionTools}><label className={styles.selectAll}><input type="checkbox" aria-label="Select customers on this page" checked={displayRows.length > 0 && displayRows.every(a => checked.includes(a.id))} onChange={e => setChecked(e.target.checked ? displayRows.map(a => a.id) : [])} /> Select page</label></div>}
          <ul>
              {displayRows.map((account) => (
                <li
                  key={account.id}
                  className={`${styles.customerRow} ${!panelClosed && selected?.id === account.id ? styles.selectedRow : ""}`}
                >
                  {selecting && <input type="checkbox" aria-label={`Select ${account.name || account.email}`} checked={checked.includes(account.id)} onChange={e => setChecked(old => e.target.checked ? [...old, account.id] : old.filter(id => id !== account.id))} />}
                    <button
                      type="button"
                      data-testid="admin-account-row"
                      onClick={() => selectAccount(account.id)}
                      aria-current={!panelClosed && selected?.id === account.id ? "true" : undefined}
                      className={`${styles.customer} ${styles[metrics?.find(metric => metric.id === account.id)?.visualTier ?? account.visualTier]}`}
                    >
                      <span className={`${styles.directoryAvatar} ${isCurrentlyVerified(account) ? styles.directoryAvatarVerified : ""}`} role="img" aria-label={isCurrentlyVerified(account) ? "Verification current" : "Not currently verified"}>
                      {account.avatarUrl ? (
                        <SmartImage
                          fit="cover"
                          src={account.avatarUrl}
                          alt=""
                          className={styles.avatarSmall}
                        />
                      ) : (
                        <span className={styles.initials}>
                          {(account.name || account.email)
                            .slice(0, 1)
                            .toUpperCase()}
                          {privatePortraitsAvailable && <PrivateVerificationPortrait token={token} accountId={account.id} className={styles.privatePortrait} />}
                        </span>
                      )}
                      {isCurrentlyVerified(account) && <span className={styles.directoryVerificationCheck} aria-hidden="true">✓</span>}
                      </span>
                      <span className={styles.customerDetails}>
                        <span className={styles.customerNameLine}><strong>{account.name || "DB Cinema renter"}</strong>
                          <span className={styles.tier}>{label(account.tier)}</span>
                          {(effectiveEncoreFor(account) ?? 0) > 0 && <span className={styles.encoreBadge}>★ {encoreName(effectiveEncoreFor(account)!)}</span>}{metrics?.find(metric => metric.id === account.id)?.encoreLevel === null && <span className={styles.tier}>Encore needs review</span>}</span>
                        {(account.matchedMessage ?? metrics?.find(metric => metric.id === account.id)?.lastMessage) && <small className={styles.messageMatch}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10.5c0 4.1-3.6 7.5-8 7.5-1.1 0-2.2-.2-3.1-.6L4 19l1.2-4A7 7 0 0 1 4 10.5C4 6.4 7.6 3 12 3s8 3.4 8 7.5Z"/></svg><span>{account.matchedMessage ?? metrics?.find(metric => metric.id === account.id)?.lastMessage}</span></small>}
                        <small className={styles.mobileEmail}>{account.email}</small>
                        {(account.blocked || unreadMessagesFor(account.id) > 0) && <span className={styles.customerMeta}>
                          {account.blocked && <span className={styles.blocked}>Blocked</span>}
                          {unreadMessagesFor(account.id) > 0 && <span className={styles.unreadBadge} aria-label={`${unreadMessagesFor(account.id) >= 100 ? "99 or more" : unreadMessagesFor(account.id)} unread messages`}>{unreadMessagesFor(account.id) >= 100 ? "99+" : unreadMessagesFor(account.id)}</span>}
                        </span>}
                      </span>
                    </button>
                </li>
              ))}
          </ul>
        </div>
        {authorized === false ? (
          <p role="alert" className={styles.empty}>Admin access required.</p>
        ) : loading && !displayRows.length ? (
          <p role="status" className={styles.empty}>
            Loading customers…
          </p>
        ) : !displayRows.length && exhausted ? (
          <p className={styles.empty}>No accounts match these filters.</p>
        ) : null}
        <footer className={styles.directoryFooter}>
          <p>
            {email ? "Customer search" : "All accounts"} ·{" "}
            {displayRows.length
              ? `${currentPage * 10 + 1}–${Math.min((currentPage + 1) * 10, matchingAccounts.length)} of ${matchingAccounts.length}${exhausted ? "" : " loaded"}`
              : loading ? "Searching…" : "0 results"}
            <small>
              {!messageSearchActive ? "Chat search matches words, not partial substrings." : messageSearchStatus === "LoadingFirstPage" ? "Searching chat history…" : messageSearchStatus === "LoadingMore" ? "Loading older chat matches…" : messageSearchStatus === "CanLoadMore" ? `${messageMatches.length} matching accounts found; older chat matches remain.` : messageMatches.length ? "All matching chat messages searched." : "No matching chat messages."}
            </small>
            {messageSearchActive && messageSearchStatus === "CanLoadMore" && <button type="button" className={styles.loadOlderChatMatches} data-testid="load-older-chat-matches" onClick={() => loadMoreMessageMatches(100)}>Load older chat matches</button>}
            <button type="button" onClick={() => { setSelecting(!selecting); setChecked([]); }}>{selecting ? "Done selecting" : "Select customers"}</button>
          </p>
          <div>
            <button
              type="button"
              aria-label="Previous customer page"
              disabled={currentPage === 0 || searchPending}
              onClick={() => setPage(currentPage - 1)}
            >
              ‹
            </button>
            {Array.from({ length: Math.min(5, pages) }, (_, i) => Math.max(0, Math.min(currentPage - 2, pages - 5)) + i).map(n => <button key={n} type="button" aria-label={`Customer page ${n + 1}`} aria-current={n === currentPage ? "page" : undefined} disabled={searchPending} onClick={() => setPage(n)}>{n + 1}</button>)}
            <button
              type="button"
              aria-label="Next customer page"
              disabled={loading || exhausted && currentPage + 1 >= pages || authorized !== true}
              onClick={() => setPage(currentPage + 1)}
            >
              ›
            </button>
          </div>
        </footer>
      </div>
      {selected && !panelClosed ? (
        <section ref={profileRef} className={styles.conversationPane} data-testid="admin-customer-conversation-pane" aria-label={`${selected.name || selected.email} conversation`}>
          <div className={styles.mobileConversationTools} data-testid="admin-mobile-conversation-tools">
            <button type="button" onClick={() => setMobilePane("directory")}>‹ Customers</button>
            <button type="button" onClick={() => { setPanelClosed(false); setMobilePane("profile"); }}>Profile</button>
          </div>
          <nav className={styles.threadTabs} aria-label="Customer conversations" aria-description="Scroll horizontally to see every rental">
            <button type="button" aria-pressed={!activeConversationId} onClick={() => setActiveConversationId(null)}>
              <span>Account support</span>
              {supportConversation?.unread ? <span>{supportConversation.unread}</span> : null}
            </button>
            {detail?.conversations.filter(thread => !!thread.bookingId).map(thread => {
              const rental = detail.rentals.find(row => row.id === thread.bookingId);
              return <button key={thread.id} type="button" aria-pressed={activeConversationId === thread.id} onClick={() => setActiveConversationId(thread.id)}>
                <span>{rental?.title ?? `Rental ${thread.bookingId!.slice(-8)}`}</span>
                {thread.unread > 0 && <span>{thread.unread}</span>}
              </button>;
            })}
          </nav>
          {starState?.scope === currentScope && starState.error && <p className={styles.starError} role="alert">{starState.error}</p>}
          <RentalConversation
            key={`${selected.id}:${activeConversation?.id ?? "account-support"}`}
            token={token}
            admin
            workspaceIdentity={{ name: selected.name || selected.email, phone: detail?.phone, photo: selected.avatarUrl, privatePortrait: !selected.avatarUrl ? <PrivateVerificationPortrait token={token} accountId={selected.id} className={styles.privatePortrait} /> : undefined, verified: isCurrentlyVerified(selected), membershipLabel: label(selected.tier), encoreLabel: effectiveEncoreFor(selected) ? encoreName(effectiveEncoreFor(selected)!) : undefined }}
            starred={selected.starred}
            starDisabled={searchPending || pendingStars.has(JSON.stringify([token, selected.id]))}
            onStar={() => void toggleStar()}
            accountId={selected.id}
            bookingId={activeConversation?.bookingId ?? undefined}
            title={activeRental?.title ?? "Account support"}
            stage={activeRental?.status ?? "support"}
            stageLabel={activeRental?.status.replaceAll("_", " ") ?? "Account support"}
            bookingSummary={activeRental ? {
              items: (activeRental.items ?? []).map(item => ({
                title: item.title,
                qty: item.qty,
                heroImage: item.heroImage ?? item.imageSources?.[0] ?? null,
                imageSources: item.imageSources?.length ? item.imageSources : item.heroImage ? [item.heroImage] : [],
              })),
              dates: `${date(activeRental.start)} – ${date(activeRental.end)}`,
              count: activeRental.items?.length || activeRental.quantity,
            } : undefined}
          />
          {onConversation && <button type="button" className={styles.openFullInbox} onClick={() => onConversation(selected.id, activeConversation?.bookingId ?? null)}>Open in full inbox ↗</button>}
        </section>
      ) : (
        <section className={styles.conversationEmpty} aria-label="Customer conversation">
          <p>Select a customer to open their account support chat.</p>
        </section>
      )}
      {selected && !panelClosed ? (
        <aside
          className={styles.detail}
          data-testid="admin-account-action-rail"
          aria-label="Customer profile"
        >
          <header className={styles.profileHeader}>
            <h2 className={styles.managementHeading} data-testid="admin-account-management-heading">Account management</h2>
            <button
              type="button"
              aria-label="Close customer profile"
              onClick={() => {
                scope.current = { token, accountId: selected.id, panelClosed: true };
                setPanelClosed(true);
              }}
              className={styles.close}
            >
              ×
            </button>
          </header>
          <div className={styles.summary} data-testid="admin-account-summary">
            <button type="button" onClick={() => setSection("overview")}><span><ActionIcon name="overview"/> Account</span><strong className={selected.blocked ? styles.blocked : styles.verified}>{selected.blocked ? "Restricted" : "Active"}</strong></button>
            <button type="button" data-testid="admin-membership-summary" aria-label={`Manage membership: ${label(selected.tier)}${effectiveEncoreFor(selected) ? `, ${selected.encoreOverride === "automatic" ? "earned" : "assigned"} ${encoreName(effectiveEncoreFor(selected)!)}` : ""}, monthly plan ${currentPlanLabel}`} aria-expanded={section === "access"} aria-controls="customer-action-content" onClick={openAccess}>
              <span><ActionIcon name="membership"/> Access</span>
              <strong>
                <><span data-testid="admin-membership-summary-value" className={styles.summaryValue} title={`${label(selected.tier)} · ${effectiveEncoreFor(selected) ? encoreName(effectiveEncoreFor(selected)!) : "No Encore"} · ${currentPlanLabel}`} aria-hidden="true">{`${label(selected.tier)} · ${effectiveEncoreFor(selected) ? `Encore ${effectiveEncoreFor(selected)}` : selected.encoreOverride === "automatic" && !metrics?.some(metric => metric.id === selected.id) ? "Encore loading…" : "No Encore"} · ${currentPlanLabel}`}</span>{effectiveEncoreFor(selected) ? <span className={styles.visuallyHidden}>{`${selected.encoreOverride === "automatic" ? "Earned" : "Assigned"} ${encoreName(effectiveEncoreFor(selected)!)}`}</span> : null}</>
                <span className={styles.summaryCaret} aria-hidden="true">{section === "access" ? "↑" : "↗"}</span>
              </strong>
            </button>
          </div>
          {activeRental && <PossibleIdentityMatch key={activeRental.id} token={token} bookingId={activeRental.id}/>}
          <nav
            className={styles.profileTabs}
            data-testid="admin-account-profile-sections"
            aria-label="Customer profile sections"
          >
            {profileSections.map(([key, name], index) => (
              <button
                type="button"
                key={key}
                style={{order: index * 2 + 2}}
                data-testid={key === "verification" ? "admin-verification-review-action" : undefined}
                aria-label={key === "verification" ? `${reviewRentals.length} Didit verification case${reviewRentals.length === 1 ? "" : "s"} need manual review` : undefined}
                title={key === "verification" ? `${reviewRentals.length} Didit case${reviewRentals.length === 1 ? "" : "s"} need manual review` : undefined}
                aria-pressed={section === key}
                aria-expanded={section === key}
                aria-controls="customer-action-content"
                onClick={() => setSection(current => current === key ? "closed" : key)}
                className={`${section === key ? styles.active : ""} ${key === "restriction" ? styles.dangerAction : ""} ${key === "verification" ? styles.verificationAttention : ""}`}
              >
                <span className={styles.actionLabel}><ActionIcon name={key}/>{key === "verification" ? <>{name}<span className={styles.reviewCount}>{reviewRentals.length}</span></> : <>{name}{key === "rentals" && detail ? ` · ${detail.rentals.length}${detail.rentalsMore ? "+" : ""}` : ""}</>}</span>
                {key === "credits" && detail && <span className={styles.actionBalance}>{formatGbp(detail.credit)}</span>}
                <span aria-hidden>{section === key ? "−" : "+"}</span>
              </button>
            ))}
          </nav>
          <div id="customer-action-content" className={styles.profileBody} hidden={section === "closed" || (section !== "access" && !profileSections.some(([key]) => key === section))} style={{order: section === "access" ? -1 : Math.max(0, profileSections.findIndex(([key]) => key === section)) * 2 + 3}}>
            {!detail ? (
              <p role="status" className={styles.empty}>
                Loading account details…
              </p>
            ) : (
              <>
                {section === "invoices" && <AdminInvoiceLibrary key={selected.id} token={token} accountId={selected.id}/>}
                {section === "documents" && <AccountDocuments embedded key={selected.id} token={token} accountId={selected.id} verificationExpiresAt={detail.verificationExpiresAt ?? null} customer={{name:selected.name || "DB Cinema renter",email:selected.email,avatarUrl:selected.avatarUrl,verified:isCurrentlyVerified(selected)}} onBack={() => setSection("overview")} onSection={setSection} onRental={onRental} />}
                {section === "credits" && <AccountCreditPanel token={token} accountId={selected.id}/>}
                {section === "overview" && <section className={`${styles.card} ${styles.accountDetails}`} aria-label="Account details">
                  <header className={styles.accountDetailsHeader}><h3>Contact</h3>{!profileDraft && <button type="button" className={styles.billingPortalButton} disabled={!detail || busy} onClick={() => setProfileDraft({accountId:selected.id,name:detail.name ?? "",phone:detail.phone ?? "",address:detail.address ?? "",reason:"",expected:{name:detail.name ?? null,phone:detail.phone ?? null,address:detail.address ?? null}})}>Edit</button>}</header>
                  {profileDraft?.accountId === selected.id ? <form className={styles.profileEditForm} onSubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
                    <label>Name<input autoComplete="off" maxLength={120} className="input mt-1 w-full" value={profileDraft.name} disabled={busy} onChange={event => setProfileDraft(current => current?.accountId === selected.id ? {...current,name:event.target.value} : current)}/></label>
                    <label>Phone<input autoComplete="off" inputMode="tel" maxLength={40} className="input mt-1 w-full" value={profileDraft.phone} disabled={busy} onChange={event => setProfileDraft(current => current?.accountId === selected.id ? {...current,phone:event.target.value} : current)}/></label>
                    <label>Address<input autoComplete="street-address" maxLength={300} className="input mt-1 w-full" value={profileDraft.address} disabled={busy} onChange={event => setProfileDraft(current => current?.accountId === selected.id ? {...current,address:event.target.value} : current)}/></label>
                    <label>Reason<textarea maxLength={500} className="input mt-1 min-h-14 w-full" value={profileDraft.reason} disabled={busy} onChange={event => setProfileDraft(current => current?.accountId === selected.id ? {...current,reason:event.target.value} : current)} placeholder="Saved to account history"/></label>
                    <p className={styles.profileEditHint}>Login email is managed separately.</p>
                    <div className={styles.profileEditActions}><button type="submit" className="btn-primary px-4 py-2 text-xs" disabled={busy || profileDraft.reason.trim().length < 3}>{busy ? "Saving…" : "Save details"}</button><button type="button" className={styles.profileCancel} disabled={busy} onClick={() => setProfileDraft(null)}>Cancel</button></div>
                  </form> : <dl><dt>Name</dt><dd>{detail.name || "Not supplied"}</dd><dt>Email</dt><dd><a href={`mailto:${selected.email}`}>{selected.email}</a></dd><dt>Phone</dt><dd>{detail.phone ? <a href={`tel:${detail.phone.replace(/[^\d+]/g, "")}`}>{detail.phone}</a> : "Not supplied"}</dd><dt>Address</dt><dd>{detail.address || "Not supplied"}</dd><dt>Account created</dt><dd>{date(detail.createdAt)}</dd></dl>}
                </section>}
                {section === "rentals" && (
                  <section className={styles.card}>
                    <header>
                      <h3>Rental history</h3>
                    </header>
                    {rentalRows()}
                    {detail.rentalsMore && (
                      <p className={styles.empty}>
                        Showing the latest 100 rental requests.
                      </p>
                    )}
                  </section>
                )}
                {section === "rental-actions" && <section className={styles.card}>{activeRental ? <RentalOrderTools key={activeRental.id} token={token} bookingId={activeRental.id} showSavedCardTools={false} /> : <p className={styles.empty}>Select a rental conversation to manage delivery, dates, item changes and return.</p>}</section>}
                {section === "payments" && <AccountPayments token={token} rentals={detail.rentals as AccountRentalOption[]}/>}
                {section === "verification" && reviewRentals.map(rental => <section key={rental.id} className={styles.card}><h3>{rental.title}</h3><p>{date(rental.start)}</p><RentalVerificationSummary token={token} bookingId={rental.id} admin /></section>)}
                {section === "verification" && reviewQueue?.more && <p className={styles.empty}>More than 20 cases need review. Resolve the displayed cases to see the rest.</p>}
                {section === "notes" && (
                  <section className={styles.card}>
                    <header><h3>Internal customer notes</h3></header>
                    <label className={styles.noteLabel}>Add a note<textarea maxLength={2000} disabled={noteBusy} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to admins only" /></label>
                    <button type="button" disabled={!note.trim() || noteBusy} onClick={() => void saveNote()} className="btn-primary mt-3 px-4 py-2 text-xs">{noteBusy ? "Saving…" : "Save note"}</button>
                    {detail.notes.map((n) => <article key={n.id} className={styles.noteEntry}><p>{n.text}</p><small>Added {date(n.at)}</small></article>)}
                  </section>
                )}
                {section === "access" && (
                  <section className={`${styles.card} ${styles.accessPanel}`} data-testid="admin-membership-controls">
                    <div className={styles.accessCloseHeader}>
                      <div><h3>Membership</h3><p>Rental tier · Encore · monthly plan</p></div>
                      <button type="button" className={styles.accessClose} onClick={() => setSection("closed")} aria-label="Close rental access controls">×</button>
                    </div>
                    {selected.blocked && (
                      <p className="mt-3 rounded-xl bg-rose-500/10 p-3 text-xs text-rose-200">
                        Blocked · {selected.blockedReason}
                      </p>
                    )}
                    <label className="mt-3 block text-xs text-white/65">
                      Rental tier
                      <select
                        ref={membershipRef}
                        value={level}
                        disabled={busy}
                        onChange={(e) => {
                          setLevel(e.target.value as Level);
                          setMessage("");
                        }}
                        data-testid="admin-account-level"
                        className="input mt-2 w-full"
                      >
                        {LEVELS.map(([key, name]) => (
                          <option key={key} value={key}>
                            {key === "automatic" ? "Automatic" : name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="mt-3 block text-xs text-white/65">
                      Encore tier
                      <select
                        ref={encoreRef}
                        value={encoreLevel}
                        disabled={busy}
                        onChange={(e) => {
                          setEncoreLevel(e.target.value as EncoreLevel);
                          setMessage("");
                        }}
                        data-testid="admin-account-encore-level"
                        className="input mt-2 w-full"
                      >
                        {ENCORE_LEVELS.map(([key, name]) => (
                          <option key={key} value={key}>{key === "automatic" ? "Automatic" : name}</option>
                        ))}
                      </select>
                    </label>
                    <p className={styles.accessHelp}>Encore changes rental pricing, never deposits.</p>
                    <label className="mt-4 block text-xs text-white/65">
                      Admin reason
                      <textarea
                        value={reason}
                        disabled={busy}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                        data-testid="admin-account-reason"
                        className="input mt-2 min-h-14 w-full"
                        placeholder="Saved to account history"
                      />
                    </label>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid="admin-account-save-level"
                        disabled={
                          busy ||
                          searchPending ||
                          !reason.trim() ||
                          level === selected.override
                        }
                        onClick={() => apply("level")}
                        className="btn-primary px-5 py-2 text-xs disabled:opacity-40"
                      >
                        {busy ? "Saving…" : "Apply membership"}
                      </button>
                      <button
                        type="button"
                        data-testid="admin-account-save-encore-level"
                        disabled={
                          busy ||
                          searchPending ||
                          !reason.trim() ||
                          encoreLevel === selected.encoreOverride
                        }
                        onClick={() => apply("encore")}
                        className="rounded-full border border-accent-300/30 bg-accent-300/10 px-5 py-2 text-xs text-accent-100 disabled:opacity-40"
                      >
                        {busy ? "Saving…" : "Apply Encore level"}
                      </button>
                    </div>
                    {message && (
                      <p role="status" className="mt-4 text-xs text-accent-200">
                        {message}
                      </p>
                    )}
                    {!!history?.length && (
                      <details className="mt-5 rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
                        <summary className="cursor-pointer text-xs font-medium text-white/65">Recent changes · {history.length}</summary>
                        <ul className="mt-3 space-y-3">
                          {history.map((change) => (
                            <li
                              key={change._id}
                              className="text-[11px] leading-5 text-white/45"
                            >
                              <span className="text-white/70">
                                {change.kind === "encore_level"
                                  ? `${encoreLabel(change.before)} → ${encoreLabel(change.after)}`
                                  : change.kind === "level"
                                  ? `${label(change.before)} → ${label(change.after)}`
                                  : change.kind === "credit_grant"
                                    ? `Credit issued · ${change.after}`
                                  : change.kind === "credit_grant_acknowledged"
                                    ? "Credit receipt reviewed"
                                  : change.kind === "profile_update"
                                    ? `Profile details updated · ${change.before}`
                                  : change.after === "blocked"
                                    ? "Account blocked"
                                    : "Account unblocked"}
                              </span>
                              <span className="ml-2">
                                {new Date(change.at).toLocaleDateString(
                                  "en-GB",
                                )}
                              </span>
                              <p>{change.reason}</p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <section className={`${styles.card} ${styles.billingCard}`} aria-label="Monthly plan" data-testid="admin-membership-plan">
                      <header className={styles.billingHeader}>
                        <div><h3>Monthly plan</h3><p>{detail.hasBillingCustomer ? "Stripe billing" : "No paid plan linked"}</p></div>
                        {currentPlan && <span className={`${styles.billingChip} ${currentPlan.tone === "ready" ? styles.billingChipReady : currentPlan.tone === "attention" ? styles.actionStatusAttention : styles.billingChipMuted}`} data-testid="admin-plan-detail-status">{currentPlan.label}</span>}
                      </header>
                      {detail.hasBillingCustomer ? (
                        <button type="button" data-testid="admin-billing-controls" aria-label="Manage subscription billing in Stripe" onClick={openBilling} disabled={busy || searchPending} className={styles.billingPortalButton}>
                          <ActionIcon name="billing"/><span>{busy ? "Opening Stripe…" : "Manage in Stripe"}</span><span aria-hidden="true">↗</span>
                        </button>
                      ) : (
                        <div role="status" className={styles.billingNotice}><ActionIcon name="billing"/><span>No paid plan linked</span></div>
                      )}
                      {selected.hasSubscription ? (
                        <div className={styles.billingStatusCard}>
                          <div className={styles.billingStatusTitle}>
                            <span>Plan status</span>
                            <strong>{billingStatus(detail.membershipStatus)}</strong>
                          </div>
                          <div className={styles.billingDates}>
                            {detail.trialEnd && detail.membershipStatus === "trialing" ? <div><span>Trial ends</span><strong>{date(detail.trialEnd)}</strong></div> : null}
                            {detail.paidThrough ? <div><span>{detail.cancelAtPeriodEnd ? "Ends" : "Paid through"}</span><strong>{date(detail.paidThrough)}</strong></div> : null}
                          </div>
                          {detail.membershipStatus === "provider_missing" && <div role="status" className={styles.billingNotice}><span className={styles.billingNoticeGlyph}>!</span><span>Subscription not found in Stripe</span></div>}
                        </div>
                      ) : (
                        <div role="status" className={styles.billingNotice}><ActionIcon name="membership"/><span>No paid monthly plan</span></div>
                      )}
                    </section>
                  </section>
                )}
                {section === "restriction" && (
                  <section className={styles.card}>
                    <h3>{selected.blocked ? "Account restricted" : "Restrict account"}</h3>
                    <p className="mt-2 text-xs leading-5 text-white/65">{selected.blocked ? "Sign-in and new bookings are blocked. Existing rentals and balances remain." : "Signs out and blocks new bookings. Existing rentals remain."} Email notice is sent when possible.</p>
                    {selected.blocked && detail.restrictionNotice && <p role="status" className="mt-2 text-xs text-white/70">{detail.restrictionNotice.state === "sent" ? "Notice accepted · delivery unconfirmed." : detail.restrictionNotice.state === "attention" ? "Notice needs attention." : detail.restrictionNotice.state === "skipped" ? "Notice skipped · account changed." : "Notice queued."}</p>}
                    {selected.blockedReason && <p className="mt-2 text-xs text-rose-200">Current reason: {selected.blockedReason}</p>}
                    <label className="mt-4 block text-xs text-white/65">Reason for this change<textarea value={reason} disabled={busy} maxLength={500} onChange={e => { setReason(e.target.value); setConfirmBlock(null); }} data-testid="admin-account-reason" className="input mt-2 min-h-20 w-full" placeholder="Recorded in the account’s admin history" /></label>
                    <button type="button" data-testid="admin-account-block" disabled={busy || searchPending || !reason.trim()} onClick={() => setConfirmBlock({blockedAt:selected.blockedAt ?? null,noticeId:selected.restrictionNoticeId ?? null,reason:selected.blockedReason,revision:selected.restrictionRevision ?? 0})} className="mt-3 rounded-lg border border-rose-300/35 px-4 py-2 text-xs text-rose-200 disabled:opacity-40">{selected.blocked ? "Review unblocking" : "Review restriction"}</button>
                    {confirmBlock && <div className="mt-4 rounded-xl border border-rose-300/25 p-4 text-xs leading-5 text-white/65" role="group" aria-label="Confirm account change"><p>{selected.blocked ? "Restore access for" : "Restrict"} {selected.name || "customer"}?</p><p className="mt-2">{selected.blocked ? "Restores sign-in; old sessions stay signed out." : "Blocks sign-in and new bookings; active rentals stay."}</p><p className="mt-2 break-words">Reason: {reason.trim()}</p><div className="mt-3 flex gap-3"><button type="button" data-testid="admin-account-confirm-block" onClick={() => apply("block")} disabled={busy || searchPending || !reason.trim()} className="text-rose-200">{selected.blocked ? "Confirm restore" : "Confirm restriction"}</button><button type="button" onClick={() => setConfirmBlock(null)}>Cancel</button></div></div>}
                  </section>
                )}
              </>
            )}
            {message && section !== "access" && (
              <p role="status" className={styles.message}>
                {message}
              </p>
            )}
          </div>
        </aside>
      ) : (
        <aside className={styles.detail}>
          <p className={styles.empty}>
            Select a customer to view their profile, rentals and documents.
          </p>
        </aside>
      )}
    </section>
  );
}
