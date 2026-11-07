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

const LEVELS = [
  ["automatic", "Automatic · subscription / existing grant"],
  ["standard", "Standard"],
  ["plus", "Starter"],
  ["pro", "Pro"],
  ["studio", "Studio"],
] as const;
const ENCORE_LEVELS = [
  ["automatic", "Automatic · earned progress"],
  ["1", "Encore I · 2% rental saving"],
  ["2", "Encore II · 4% rental saving"],
  ["3", "Encore III · 10% rental saving"],
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
type MembershipInvoiceInspection = {invoice:null|{id:string;status:string|null;amountPaidPence:number;currency:string;createdAt:number};receipt:null|{creditPence:number;bonusPence:number;revokedPence:number;paidMembershipPence:number;createdAt:number};tierCheck?:{state:string;tier?:string;earnedCreditPence?:number;reason?:string}};
const actionPaths: Record<string, string> = {
  overview: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a8 8 0 0 1 16 0v2",
  rentals: "M4 5h16v15H4zM4 9h16M8 3v4m8-4v4",
  "rental-actions": "M4 6h16M7 3v6M17 3v6M4 13h16M9 10v6M4 20h16M15 17v6",
  verification: "M12 3 4 6v5c0 5 3 8 8 10 5-2 8-5 8-10V6l-8-3Zm-3 9 2 2 4-4",
  documents: "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6",
  invoices: "M4 6h16v13H4zM4 10h16m-12 5h4",
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
  return <section className={styles.identityWarning} role="status"><strong>Possible match — compare manually</strong><p>A restricted account shares the verified name and date of birth. This is not proof of identity and does not automatically block this booking.</p>{result.matches.map((match: {id: string; name: string | null; email: string; blockedReason: string | null}) => <p key={match.id}>{match.name || "Unnamed customer"} · {match.email}{match.blockedReason ? ` · ${match.blockedReason}` : ""}</p>)}{result.more && <p>More matches exist; review the full customer directory.</p>}</section>;
}
type Level = (typeof LEVELS)[number][0];
type EncoreLevel = (typeof ENCORE_LEVELS)[number][0];

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
  const subscriptionRef = useRef<HTMLDivElement>(null);
  const [accessTarget, setAccessTarget] = useState<{ target: "membership" | "encore" | "subscription"; sequence: number } | null>(null);
  const [input, setInput] = useState(""),
    [email, setEmail] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("automatic"),
    [encoreLevel, setEncoreLevel] = useState<EncoreLevel>("automatic"),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [confirmBlock, setConfirmBlock] = useState<{ blockedAt: number | null; noticeId: Id<"account_restriction_notices"> | null; reason: string; revision: number } | null>(null);
  const [message, setMessage] = useState("");
  const [invoiceInspectionState,setInvoiceInspection]=useState<{scope:{token:string;accountId:string|undefined;panelClosed:boolean};data:MembershipInvoiceInspection;selection:"latest"|"paid"}|null>(null);
  const filter = "all" as const;
  const [tierFilter, setTierFilter] = useState<"all" | "standard" | "plus" | "pro" | "studio">("all"),
    [page, setPage] = useState(0);
  const [encoreFilter, setEncoreFilter] = useState<"all" | "automatic" | "1" | "2" | "3">("all");
  const [directoryView, setDirectoryView] = useState<"all" | "unread" | "starred">("all");
  const [selecting, setSelecting] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [verificationFilter, setVerificationFilter] = useState<"all" | "verified" | "pending">("all");
  const [checked, setChecked] = useState<string[]>([]);
  const [section, setSection] = useState("closed"),
    [panelClosed, setPanelClosed] = useState(false);
  useEffect(() => {
    setReason("");
    setConfirmBlock(null);
  }, [section]);
  useEffect(() => {
    if (section !== "access" || !accessTarget) return;
    const frame = requestAnimationFrame(() => {
      const target = accessTarget.target === "membership" ? membershipRef.current : accessTarget.target === "encore" ? encoreRef.current : subscriptionRef.current;
      target?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      if (target instanceof HTMLSelectElement) target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [section, accessTarget]);
  const openAccess = (target: "membership" | "encore" | "subscription") => {
    if (section === "access" && accessTarget?.target === target) {
      setSection("closed");
      return;
    }
    setSection("access");
    setAccessTarget(current => ({ target, sequence: (current?.sequence ?? 0) + 1 }));
  };
  const [note, setNote] = useState(""),
    [noteBusy, setNoteBusy] = useState(false);
  const addNote = useMutation(api.accountAdmin.addNote);
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
  const messageSearch = useQuery(api.accountAdmin.searchMessages,
    authorized && email.trim().length >= 2
      ? { token, search: email, filter, tier: tierFilter, encore: encoreFilter, verification: verificationFilter, view: directoryView } : "skip");
  const messageMatches = messageSearch?.items ?? [];
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
  const searchPending = input !== email || authorized === undefined || status === "LoadingFirstPage" || !!authorized && email.trim().length >= 2 && messageSearch === undefined;
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
  const invoiceInspection=invoiceInspectionState?.scope===currentScope?invoiceInspectionState.data:null;
  const detail = useQuery(
    api.accountAdmin.detail,
    selected && !panelClosed ? { token, accountId: selected.id } : "skip",
  );
  const reviewQueue = useQuery(api.accountAdmin.verificationReviews, selected && !panelClosed ? {token,accountId:selected.id as any} : "skip");
  const invoiceReviews = useQuery(api.membershipInvoiceReviews.adminList, selected?.hasSubscription && !panelClosed && section === "access" ? {token,accountId:selected.id as any} : "skip");
  const refundReviews = useQuery(api.membershipRefundJobs.adminList, selected && !panelClosed && section === "access" ? {token,accountId:selected.id as any} : "skip");
  const history = useQuery(
    api.accountAdmin.history,
    selected ? { token, accountId: selected.id } : "skip",
  );
  const setAccountLevel = useMutation(api.accountAdmin.setLevel);
  const setAccountEncoreLevel = useMutation(api.accountAdmin.setEncoreLevel);
  const setBlocked = useMutation(api.accountAdmin.setBlocked);
  const setStarred = useMutation(api.accountAdmin.setStarred);
  const openStripeBilling = useAction(api.checkout.adminBillingPortal);
  const refreshStripeMembership = useAction(api.checkout.adminRefreshMembership);
  const inspectStripeInvoice = useAction(api.checkout.adminInspectMembershipInvoice);
  const retryStripeInvoice = useAction(api.checkout.adminRetryMembershipInvoice);
  useEffect(()=>{setInvoiceInspection(null);},[selected?.id,token,panelClosed]);
  useEffect(() => {
    setLevel((selected?.override ?? "automatic") as Level);
    setEncoreLevel((selected?.encoreOverride ?? "automatic") as EncoreLevel);
    setReason("");
    setConfirmBlock(null);
  }, [selected?.id, selected?.override, selected?.encoreOverride, selected?.blocked, selected?.blockedAt, selected?.restrictionNoticeId, selected?.blockedReason, selected?.restrictionRevision, token, panelClosed]);
  useEffect(() => {
    setMessage("");
    setSection("closed");
    setNote("");
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
    if (window.matchMedia("(max-width:1100px)").matches)
      requestAnimationFrame(() =>
        profileRef.current?.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        }),
      );
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
  async function refreshBillingStatus() {
    if (!selected || panelClosed || busy || searchPending) return;
    const origin = scope.current;
    setBusy(true);setMessage("");
    try {
      await refreshStripeMembership({token,accountId:selected.id});
      if (scope.current === origin) setMessage("Stripe subscription status refreshed. Billing and credits were not changed.");
    } catch (error) {
      if (scope.current === origin) setMessage(error instanceof Error ? error.message : "Could not refresh Stripe status. No billing changes were made.");
    } finally { if (scope.current === origin) setBusy(false); }
  }
  async function inspectBillingInvoice(selection:"latest"|"paid", inspectTier = false) {
    if (!selected || panelClosed || busy || searchPending) return;
    const origin=scope.current;setBusy(true);setMessage("");setInvoiceInspection(null);
    try {const result=await inspectStripeInvoice({token,accountId:selected.id,selection,...(inspectTier?{inspectTier:true}:{})});if(scope.current===origin)setInvoiceInspection({scope:origin,data:result,selection});}
    catch(error){if(scope.current===origin)setMessage(error instanceof Error?error.message:"Could not check the Stripe invoice.");}
    finally{if(scope.current===origin)setBusy(false);}
  }
  async function retryInvoiceReview(invoiceId: string) {
    if (!selected || panelClosed || busy || searchPending) return;
    if (!window.confirm("Retry this invoice? Verified subscription credit may be added to this account.")) return;
    const origin = scope.current;
    setBusy(true); setMessage("");
    try {
      const result = await retryStripeInvoice({ token, accountId: selected.id, invoiceId });
      if (scope.current === origin) setMessage(result.state === "resolved" ? "Invoice credit has a matching receipt." : "Invoice still needs review. No unverified credit was issued.");
    } catch (error) {
      if (scope.current === origin) setMessage(error instanceof Error ? error.message : "Could not retry this invoice.");
    } finally { if (scope.current === origin) setBusy(false); }
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
            {(rental.items?.length ? rental.items : [{ title: rental.title, qty: rental.quantity, imageSources: rental.imageSources }]).map((item, index) => (
              <div className={styles.kitPhotoWrap} key={index} title={`${item.title}${item.qty > 1 ? ` ×${item.qty}` : ""}`}>
                <SmartImage fit="contain" src={item.imageSources[0]} fallbackSources={item.imageSources.slice(1)} alt={item.title} className={styles.kitPhoto} />
                {item.qty > 1 && <span className={styles.kitQuantity}>×{item.qty}</span>}
              </div>
            ))}
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
  const profileSections = [
    ["overview", "Account details"],
    ["rentals", "Rentals"],
    ["rental-actions", "Rental actions"],
    ...(reviewRentals.length ? [["verification", "Verification needs review"]] : []),
    ["documents", "Documents"],
    ["invoices", "Invoices"],
    ["credits", "Credits"],
    ["restriction", selected?.blocked ? "Unblock account" : "Restrict account"],
    ["notes", "Notes"],
  ];
  return (
    <section data-testid="admin-accounts" className={styles.root}>
      <h1 className={styles.srOnly}>Customers &amp; Members</h1>
      {checked.length > 0 && <div className={styles.pageTools}>
        <button type="button" className={styles.filterButton} onClick={() => {
          const csvValue = (value: string) => '"' + (/^[=+@\-\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""') + '"';
          const csv = ["Name,Email,Membership,Verified", ...displayRows.filter(a => checked.includes(a.id)).map(a => [a.name, a.email, label(a.tier), isCurrentlyVerified(a) ? "Verified" : "Pending"].map(csvValue).join(","))].join("\r\n");
          const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "db-cinema-customers.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Export {checked.length}</button>
      </div>}
      <div className={styles.directory} data-testid="admin-customer-directory">
        <div className={styles.directoryToolbar}>
          <label className={styles.directorySearch}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg><span className={styles.srOnly}>Search customers and chat messages</span><input data-testid="account-email-search" type="search" maxLength={254} placeholder="Name or chat…" value={input} onChange={e => { setInput(e.target.value); setSelectedId(null); setPanelClosed(false); }} /></label>
          <div className={styles.viewFilters} aria-label="Conversation views">{([['all','All'],['unread','Unread'],['starred','Starred']] as const).map(([value, title]) => <button key={value} type="button" aria-pressed={directoryView === value} onClick={() => { setDirectoryView(value); setSelectedId(null); }}>{value === 'starred' && <ActionIcon name="access" />}{title}</button>)}</div>
        </div>
        <div className={styles.filters}>
          <label>
            <span className={styles.filterLabel}>Membership</span>
            <select
              value={tierFilter}
              onChange={(e) => { setTierFilter(e.target.value as typeof tierFilter); setPage(0); setSelectedId(null); }}
            >
              <option value="all">All memberships</option>
              {LEVELS.filter(([key]) => key !== "automatic").map(
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
              <option value="all">All Encore tiers</option>
              <option value="automatic">Automatic / earned tier</option>
              <option value="1">Assigned Encore I</option>
              <option value="2">Assigned Encore II</option>
              <option value="3">Assigned Encore III</option>
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
              {messageSearch?.truncated ? "Chat matches are limited; use a more specific search." : exhausted ? "Matching accounts loaded. Chat search matches words, not partial substrings." : "Continue through the pages to search the rest of the directory."}
            </small>
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
          <nav className={styles.threadTabs} aria-label="Customer conversations">
            <button type="button" aria-pressed={!activeConversationId} onClick={() => setActiveConversationId(null)}>
              Account support
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
            workspaceIdentity={{ name: selected.name || selected.email, photo: selected.avatarUrl, privatePortrait: !selected.avatarUrl ? <PrivateVerificationPortrait token={token} accountId={selected.id} className={styles.privatePortrait} /> : undefined, verified: isCurrentlyVerified(selected), membershipLabel: label(selected.tier), encoreLabel: effectiveEncoreFor(selected) ? encoreName(effectiveEncoreFor(selected)!) : undefined }}
            starred={selected.starred}
            starDisabled={searchPending || pendingStars.has(JSON.stringify([token, selected.id]))}
            onStar={() => void toggleStar()}
            accountId={selected.id}
            bookingId={activeConversation?.bookingId ?? undefined}
            title={activeRental?.title ?? "Account support"}
            stage={activeRental?.status ?? "support"}
            stageLabel={activeRental?.status.replaceAll("_", " ") ?? "Account support"}
            bookingSummary={activeRental ? {
              image: activeRental.imageSources[0] ?? null,
              imageSources: activeRental.imageSources,
              dates: `${date(activeRental.start)} – ${date(activeRental.end)}`,
              count: activeRental.quantity,
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
            <span
              className={`${styles.profileAvatar} ${isCurrentlyVerified(selected) ? styles.profileAvatarVerified : ""}`}
              data-testid="admin-profile-avatar"
              role="img"
              aria-label={`${selected.name || "Customer"} profile photo${isCurrentlyVerified(selected) ? ", verified" : ""}`}
            >
              <span className={styles.profileAvatarCrop}>
                {selected.avatarUrl ? (
                  <SmartImage src={selected.avatarUrl} alt="" className={styles.profileAvatarImage} />
                ) : (
                  <>
                    <span className={styles.profileAvatarInitial} aria-hidden="true">
                      {(selected.name || selected.email).slice(0, 1).toUpperCase()}
                    </span>
                    {privatePortraitsAvailable && <PrivateVerificationPortrait token={token} accountId={selected.id} className={styles.privatePortrait} />}
                  </>
                )}
              </span>
              {isCurrentlyVerified(selected) && <span className={styles.profileVerificationCheck} aria-label="Verification active for 90 days">✓</span>}
            </span>
            <h2 className={styles.managementHeading}>Account Management</h2>
            {selected.avatarUrl ? (
              <SmartImage
                src={selected.avatarUrl}
                alt=""
                className={styles.avatarLarge}
              />
            ) : (
              <span className={styles.avatarLargeInitial}>
                {(selected.name || selected.email).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div>
              <div className={styles.profileIdentity}>
              <h2>{selected.name || "DB Cinema renter"}</h2>
              <span
                className={isCurrentlyVerified(selected) ? styles.verified : styles.pending}
              >
                {isCurrentlyVerified(selected) ? "✓ Verified" : "Verification pending"}
              </span>
              </div>
              <div className={styles.contacts}>
              <p><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h18v14H3z M3 5l9 7 9-7"/></svg> {selected.email}</p>
              {detail?.phone && <p><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 3h4l2 5-3 2c2 3 3 4 6 6l2-3 5 2v4c0 2-3 3-5 2C9 19 5 15 3 8 2 6 3 3 5 3Z"/></svg> {detail.phone}</p>}
              </div>
              {detail?.address && <p className={styles.address}>{detail.address}</p>}
            </div>
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
          <div className={styles.summary}>
            <button type="button" onClick={() => setSection("overview")}><span><ActionIcon name="overview"/> Account</span><strong className={selected.blocked ? styles.blocked : styles.verified}>{selected.blocked ? "Restricted" : "Active"}</strong></button>
            <button type="button" aria-expanded={section === "access" && accessTarget?.target !== "encore"} aria-controls="customer-action-content" onClick={() => openAccess(selected.hasSubscription ? "subscription" : "membership")}><span><ActionIcon name="invoices"/> Membership</span><strong>{label(selected.tier)} · {selected.hasSubscription ? detail ? billingStatus(detail.membershipStatus) : "Loading…" : "No paid plan"} ﹀</strong></button>
            <button type="button" aria-expanded={section === "access" && accessTarget?.target === "encore"} aria-controls="customer-action-content" onClick={() => openAccess("encore")}><span><ActionIcon name="access"/> Encore tier</span><strong>{effectiveEncoreFor(selected) ? `${selected.encoreOverride !== "automatic" ? "Assigned" : "Earned"} ${encoreName(effectiveEncoreFor(selected)!).replace("Encore ", "")}` : selected.encoreOverride === "automatic" && !metrics?.some(metric => metric.id === selected.id) ? "Loading…" : effectiveEncoreFor(selected) === null ? "Progress needs review" : "No Encore tier"} ﹀</strong></button>
            <button type="button" onClick={() => setSection("credits")}><span><ActionIcon name="credits"/> Available credit</span><strong>{detail ? formatGbp(detail.credit) : "…"}</strong></button>
          </div>
          {activeRental && <PossibleIdentityMatch key={activeRental.id} token={token} bookingId={activeRental.id}/>}
          <nav
            className={styles.profileTabs}
            aria-label="Customer profile sections"
          >
            {profileSections.map(([key, name], index) => (
              <button
                type="button"
                key={key}
                style={{order: index * 2 + 2}}
                aria-pressed={section === key}
                aria-expanded={section === key}
                aria-controls="customer-action-content"
                onClick={() => setSection(current => current === key ? "closed" : key)}
                className={`${section === key ? styles.active : ""} ${key === "restriction" ? styles.dangerAction : ""} ${key === "verification" ? styles.verificationAttention : ""}`}
              >
                <span className={styles.actionLabel}><ActionIcon name={key}/>{name}{key === "rentals" && detail ? ` (${detail.rentals.length}${detail.rentalsMore ? "+" : ""})` : ""}</span>
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
                {section==="credits"&&<AccountCreditPanel token={token} accountId={selected.id}/>}
                {section === "overview" && <section className={`${styles.card} ${styles.accountDetails}`}><h3>Account details</h3><dl><dt>Name</dt><dd>{selected.name || "Not supplied"}</dd><dt>Email</dt><dd><a href={`mailto:${selected.email}`}>{selected.email}</a></dd><dt>Phone</dt><dd>{detail.phone || "Not supplied"}</dd><dt>Address</dt><dd>{detail.address || "Not supplied"}</dd><dt>Account created</dt><dd>{date(detail.createdAt)}</dd></dl></section>}
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
                {section === "rental-actions" && <section className={styles.card}>{activeRental ? <RentalOrderTools key={activeRental.id} token={token} bookingId={activeRental.id} /> : <p className={styles.empty}>Select a rental conversation to manage its delivery, dates, payments and return.</p>}</section>}
                {section === "verification" && reviewRentals.map(rental => <section key={rental.id} className={styles.card}><h3>{rental.title}</h3><p>{date(rental.start)}</p><RentalVerificationSummary token={token} bookingId={rental.id} admin /></section>)}
                {section === "verification" && reviewQueue?.more && <p className={styles.empty}>More than 20 cases need review. Resolve the displayed cases to see the rest.</p>}
                {section === "notes" && (
                  <section className={styles.card}>
                    <header>
                      <h3>Internal customer notes</h3>
                    </header>
                    <label className={styles.noteLabel}>
                      Add a note
                      <textarea
                        maxLength={2000}
                        disabled={noteBusy}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Visible to admins only"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!note.trim() || noteBusy}
                      onClick={() => void saveNote()}
                      className="btn-primary mt-3 px-4 py-2 text-xs"
                    >
                      {noteBusy ? "Saving…" : "Save note"}
                    </button>
                    {detail.notes.map((n) => (
                      <article key={n.id} className={styles.noteEntry}>
                        <p>{n.text}</p>
                        <small>Added {date(n.at)}</small>
                      </article>
                    ))}
                  </section>
                )}
                {section === "access" && (
                  <section className={`${styles.card} ${styles.accessPanel}`}>
                    <div className={styles.accessCloseHeader}>
                      <button type="button" className={styles.accessClose} onClick={() => setSection("closed")} aria-label="Close membership and Encore controls">Close controls ×</button>
                    </div>
                    {selected.blocked && (
                      <p className="mt-3 rounded-xl bg-rose-500/10 p-3 text-xs text-rose-200">
                        Blocked · {selected.blockedReason}
                      </p>
                    )}
                    <label className="mt-5 block text-xs text-white/65">
                      Membership level
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
                    <p className={styles.accessHelp}>Manual access does not change Stripe billing or award subscription credit.</p>
                    <details className={styles.accessExplanation}><summary>How access works</summary><p>Standard removes membership access. Automatic restores the subscription or existing grant. Manual grants do not qualify for the paid security waiver.</p></details>
                    <label className="mt-5 block text-xs text-white/65">
                      Encore rental-saving level
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
                    <p className={styles.accessHelp}>An assigned Encore level changes rental savings, not first-rental security.</p>
                    <details className={styles.accessExplanation}><summary>How Encore works</summary><p>Assign Encore I, II or III, or restore Automatic earned progress. An override alone never waives security on a first rental.</p></details>
                    {!!refundReviews?.length && <div className="mt-3 rounded-xl border border-amber-200/30 bg-black/20 p-3 text-xs leading-5" aria-label="Subscription refund reviews"><p className="font-semibold text-amber-100">Refund needs review</p><p className="text-white/60">Credit remains on hold. Review the payment and refunds in Stripe; this cannot be cleared here yet.</p>{refundReviews.map(review => <div key={review.invoiceId} className="mt-2 min-w-0 break-all text-white/75">{review.invoiceId} · {review.refundId}</div>)}</div>}
                    {selected.hasSubscription && (
                      <div ref={subscriptionRef} className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[.04] p-3 text-xs leading-5 text-amber-100/80">
                        <p>{label(selected.subscriptionTier ?? "Stripe")} subscription · {detail ? billingStatus(detail.membershipStatus) : "Loading status…"}</p>
                        {detail?.trialEnd && detail.membershipStatus === "trialing" ? <p>Trial ends {date(detail.trialEnd)}.</p> : null}
                        {detail?.paidThrough ? <p>Paid through {date(detail.paidThrough)}{detail.cancelAtPeriodEnd ? " · renewal canceled" : ""}.</p> : null}
                        <p>Access changes and blocking do not change Stripe billing. Status reflects the last received update.</p>
                        {!!invoiceReviews?.length && <div className="mt-3 rounded-xl border border-amber-200/30 bg-black/20 p-3" aria-label="Subscription credit reviews"><p className="font-semibold text-amber-100">Credit needs review</p><p className="text-white/60">A historical plan could not be confirmed automatically.</p>{invoiceReviews.map(review => <div key={review.invoiceId} className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-all text-white/75">{review.invoiceId}</span><button type="button" disabled={busy || searchPending} onClick={() => void retryInvoiceReview(review.invoiceId)} className="rounded-full border border-amber-200/35 px-3 py-1 text-amber-100 disabled:opacity-40">Retry safely</button></div>)}</div>}
                        {detail?.membershipStatus === "provider_missing" && <p role="status">Stripe could not find this subscription. Check the Stripe account and subscription before changing billing; this does not confirm cancellation.</p>}
                        <button type="button" onClick={openBilling} disabled={busy || searchPending || !detail} className="mt-2 rounded-full border border-amber-200/35 px-3 py-1.5 text-amber-100 disabled:opacity-40">{busy ? "Opening…" : "Manage subscription in Stripe ↗"}</button>
                        <button type="button" onClick={refreshBillingStatus} disabled={busy || searchPending || !detail} className="mt-2 ml-2 rounded-full border border-amber-200/35 px-3 py-1.5 text-amber-100 disabled:opacity-40">Refresh Stripe status</button>
                        <button type="button" onClick={()=>void inspectBillingInvoice("latest")} disabled={busy || searchPending || !detail} className="mt-2 rounded-full border border-amber-200/35 px-3 py-1.5 text-amber-100 disabled:opacity-40">Check latest invoice & credit</button>
                        <button type="button" onClick={()=>void inspectBillingInvoice("paid")} disabled={busy || searchPending || !detail} className="mt-2 rounded-full border border-amber-200/35 px-3 py-1.5 text-amber-100 disabled:opacity-40">Check latest paid invoice</button>
                        <button type="button" onClick={()=>void inspectBillingInvoice("paid",true)} disabled={busy || searchPending || !detail} className="mt-2 rounded-full border border-amber-200/35 px-3 py-1.5 text-amber-100 disabled:opacity-40">Check historical plan credit</button>
                        {invoiceInspection?.tierCheck && <p role="status" className="mt-2 text-white/65">{invoiceInspection.tierCheck.state === "ready" ? `Historical price mapping: ${label(invoiceInspection.tierCheck.tier ?? "")} · calculated earned credit ${formatGbp((invoiceInspection.tierCheck.earnedCreditPence ?? 0)/100)}. Verify the recorded terms and any refunds before taking action.` : invoiceInspection.tierCheck.state === "not_applicable" ? "This invoice is not eligible for this check." : "Historical price evidence needs review. No credit has been changed."}</p>}
                        {invoiceInspection && <div aria-label="Latest subscription invoice" className="mt-3 rounded-lg border border-amber-200/20 bg-black/20 p-3 text-amber-50/85"><p className="font-semibold">{invoiceInspectionState?.selection === "paid" ? "Most recently created paid invoice" : "Latest invoice"}</p>{invoiceInspection.invoice ? <><p className="mt-1 break-all">Invoice {invoiceInspection.invoice.id} · {invoiceInspection.invoice.status ?? "status unavailable"}</p><p className="mt-1">Whole invoice paid: {formatGbp(invoiceInspection.invoice.amountPaidPence/100)} · created {date(invoiceInspection.invoice.createdAt)}</p><p className="text-white/55">Stripe’s paid amount may not reflect refunds.</p>{invoiceInspection.receipt ? <><p className="mt-1">Membership payment: {formatGbp(invoiceInspection.receipt.paidMembershipPence/100)} · credit recorded: {formatGbp(invoiceInspection.receipt.creditPence/100)}</p><p>Bonus: {formatGbp(invoiceInspection.receipt.bonusPence/100)} · reversed: {formatGbp(invoiceInspection.receipt.revokedPence/100)}</p><p className="mt-1 text-white/55">Receipt amounts are not the current available balance.</p></> : <p className="mt-1">No credit receipt is recorded for this invoice. A free trial or non-membership invoice may not create one.</p>}</> : <p>{invoiceInspectionState?.selection === "paid" ? "Stripe has no paid invoice with a positive payment in the checked history." : "Stripe has no latest invoice for this subscription."}</p>}<p className="mt-2 text-white/55">Read-only check. No payment or credit was changed.</p></div>}
                      </div>
                    )}
                    <label className="mt-4 block text-xs text-white/65">
                      Reason for this change
                      <textarea
                        value={reason}
                        disabled={busy}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                        data-testid="admin-account-reason"
                        className="input mt-2 min-h-20 w-full"
                        placeholder="Recorded in the account’s admin history"
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
                        {busy ? "Saving…" : "Apply level"}
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
                      <div className="mt-6 border-t border-white/10 pt-4">
                        <h4 className="text-xs text-white/65">
                          Recent admin changes
                        </h4>
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
                      </div>
                    )}
                  </section>
                )}
                {section === "restriction" && (
                  <section className={styles.card}>
                    <h3>{selected.blocked ? "Account restricted" : "Restrict account"}</h3>
                    <p className="mt-2 text-xs leading-5 text-white/65">{selected.blocked ? "This account cannot sign in or create bookings." : "This signs the customer out and prevents new bookings. Existing rentals, balances and refund controls remain available."} A restriction notice is queued for a verified email address; if it cannot be confirmed, the team is alerted.</p>
                    {selected.blocked && detail.restrictionNotice && <p role="status" className="mt-2 text-xs text-white/70">{detail.restrictionNotice.state === "sent" ? "Restriction email accepted by the mail service; delivery is not guaranteed." : detail.restrictionNotice.state === "attention" ? "Restriction email needs attention. Check the recipient and contact them manually if appropriate." : detail.restrictionNotice.state === "skipped" ? "Restriction email was not sent because the account changed." : "Restriction email is queued or being processed."}</p>}
                    {selected.blockedReason && <p className="mt-2 text-xs text-rose-200">Current reason: {selected.blockedReason}</p>}
                    <label className="mt-4 block text-xs text-white/65">Reason for this change<textarea value={reason} disabled={busy} maxLength={500} onChange={e => { setReason(e.target.value); setConfirmBlock(null); }} data-testid="admin-account-reason" className="input mt-2 min-h-20 w-full" placeholder="Recorded in the account’s admin history" /></label>
                    <button type="button" data-testid="admin-account-block" disabled={busy || searchPending || !reason.trim()} onClick={() => setConfirmBlock({blockedAt:selected.blockedAt ?? null,noticeId:selected.restrictionNoticeId ?? null,reason:selected.blockedReason,revision:selected.restrictionRevision ?? 0})} className="mt-3 rounded-lg border border-rose-300/35 px-4 py-2 text-xs text-rose-200 disabled:opacity-40">{selected.blocked ? "Review unblocking" : "Review restriction"}</button>
                    {confirmBlock && <div className="mt-4 rounded-xl border border-rose-300/25 p-4 text-xs leading-5 text-white/65" role="group" aria-label="Confirm account change"><p>{selected.blocked ? "Unblock" : "Restrict"} {selected.name || "customer"} ({selected.email})? {selected.blocked ? "They can sign in again; previously revoked sessions stay signed out." : "They will be signed out and cannot create new bookings."}</p><p className="mt-2 break-words">Reason: {reason.trim()}</p><div className="mt-3 flex gap-3"><button type="button" data-testid="admin-account-confirm-block" onClick={() => apply("block")} disabled={busy || searchPending || !reason.trim()} className="text-rose-200">{selected.blocked ? "Confirm unblocking" : "Confirm restriction"}</button><button type="button" onClick={() => setConfirmBlock(null)}>Cancel</button></div></div>}
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
