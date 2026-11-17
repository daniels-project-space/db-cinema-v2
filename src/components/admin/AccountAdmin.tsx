"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { RentalExtensionPanel } from "@/components/rentals/RentalExtensionPanel";
import { RentalOrderTools } from "./RentalOrderTools";
import { PrivateVerificationPortrait } from "./PrivateVerificationPortrait";
import { RentalVerificationSummary } from "@/components/rentals/RentalVerificationSummary";
import { SavedCardCharges } from "@/components/rentals/SavedCardCharges";
import { MembershipInvoiceRecovery } from "./MembershipInvoiceRecovery";
import { PossibleRestrictedIdentityAccountMatches } from "./PossibleRestrictedIdentityMatch";

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

type AccountRentalOption = {id:string;title:string;start:number};
function rentalPickerLabel(rental: {title:string;start:number|null}) {
  const dateLabel = rental.start == null ? "Date pending" : new Date(rental.start).toLocaleDateString("en-GB", {day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
  const compactTitle = rental.title.replace(/\s+(?:cinema\s+)?(?:camera|lens)$/i, "").trim() || rental.title;
  const visibleTitle = compactTitle.length <= 26 ? compactTitle : `${compactTitle.slice(0, 25).trimEnd()}…`;
  return {label:`${dateLabel} · ${visibleTitle}`, fullLabel:`${rental.title} · ${dateLabel}`};
}
function AccountPayments({token,rentals}:{token:string;rentals:AccountRentalOption[]}) {
  const [bookingId,setBookingId]=useState(rentals[0]?.id??"");
  const selectedBookingId=rentals.some(r=>r.id===bookingId)?bookingId:rentals[0]?.id??"";
  useEffect(()=>{if(bookingId!==selectedBookingId)setBookingId(selectedBookingId);},[bookingId,selectedBookingId]);
  return <section className={styles.card} aria-label="Customer card claims" data-testid="admin-account-payments">
    <header><h3>Saved-card claims</h3></header>
    {!rentals.length?<p className={styles.empty}>No rentals are linked to this account.</p>:<>
      <label className={styles.paymentRentalSelect}>Rental<select aria-label="Rental for payment controls" value={selectedBookingId} onChange={e=>setBookingId(e.target.value)}>
        {rentals.map(r=>{const option=rentalPickerLabel(r);return <option key={r.id} value={r.id} title={option.fullLabel}>{option.label}</option>})}
      </select></label>
      {selectedBookingId?<SavedCardCharges key={selectedBookingId} token={token} bookingId={selectedBookingId} admin/>:null}
    </>}
  </section>;
}

export function AccountAdmin({
  token,
  onRental,
  onConversation,
  onEmail,
  onDocumentsChange,
}: {
  token: string;
  onDocumentsChange?: (customer: string | null) => void;
  onRental?: (id: string) => void;
  onConversation?: (accountId: string, bookingId: string | null) => void;
  onEmail?: (email: string) => void;
}) {
  const profileRef = useRef<HTMLElement>(null);
  const actionRailRef = useRef<HTMLElement>(null);
  const verificationRef = useRef<HTMLSelectElement>(null);
  const membershipRef = useRef<HTMLSelectElement>(null);
  const encoreRef = useRef<HTMLSelectElement>(null);
  const [accessTarget, setAccessTarget] = useState<{ sequence: number } | null>(null);
  const [input, setInput] = useState(""),
    [email, setEmail] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("automatic"),
    [encoreLevel, setEncoreLevel] = useState<EncoreLevel>("automatic"),
    [accessReason, setAccessReason] = useState(""),
    [restrictionReason, setRestrictionReason] = useState("");
  const [restrictionClass, setRestrictionClass] = useState<"" | "access_only" | "identity_safety_blacklist">("");
  const [busy, setBusy] = useState(false),
    [confirmBlock, setConfirmBlock] = useState<{ blockedAt: number | null; action: "restrict" | "restore" | "reclassify"; restrictionClass: "access_only" | "identity_safety_blacklist"; expectedRestrictionClass: "access_only" | "identity_safety_blacklist" | null; noticeId: Id<"account_restriction_notices"> | null; reason: string; revision: number } | null>(null);
  const [message, setMessage] = useState("");
  const filter = "all" as const;
  const [tierFilter, setTierFilter] = useState<"all" | "standard" | "plus" | "pro" | "studio">("all"),
    [page, setPage] = useState(0);
  const [encoreFilter, setEncoreFilter] = useState<"all" | "automatic" | "1" | "2" | "3">("all");
  const [directoryView, setDirectoryView] = useState<"all" | "unread" | "starred">("all");
  const [selecting, setSelecting] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"directory" | "conversation" | "profile">("directory");
  useEffect(() => {
    if (mobilePane !== "profile") return;
    const frame = requestAnimationFrame(() => actionRailRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    return () => cancelAnimationFrame(frame);
  }, [mobilePane, selectedId]);
  const [verificationFilter, setVerificationFilter] = useState<"all" | "verified" | "pending">("all");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const activeFilterCount = Number(tierFilter !== "all") + Number(encoreFilter !== "all") + Number(verificationFilter !== "all");
  const [checked, setChecked] = useState<string[]>([]);
  const [section, setSection] = useState("closed"),
    [panelClosed, setPanelClosed] = useState(false);
  const [rentalView, setRentalView] = useState<"history" | "actions">("history");
  const [managedRentalSelection, setManagedRentalSelection] = useState<{ accountId: string; bookingId: string } | null>(null);
  const [billingView, setBillingView] = useState<"payments" | "invoices" | "credits">("payments");
  const [safetyView, setSafetyView] = useState<"notes" | "restriction">("notes");
  useEffect(() => {
    setAccessReason("");
    setRestrictionReason("");
    setConfirmBlock(null);
    setMessage("");
  }, [section]);
  useEffect(() => {
    if (section !== "membership" || !accessTarget) return;
    const frame = requestAnimationFrame(() => {
      const target = membershipRef.current;
      target?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [section, accessTarget]);
  const openMembership = () => {
    if (section === "membership") {
      setSection("closed");
      return;
    }
    setSection("membership");
    setAccessTarget(current => ({ sequence: (current?.sequence ?? 0) + 1 }));
  };
  const openMobileProfile = () => {
    setPanelClosed(false);
    setMobilePane("profile");
    requestAnimationFrame(() => requestAnimationFrame(() => actionRailRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" })));
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
  useEffect(() => {
    setRestrictionClass(selected?.restrictionClass ?? "");
    setConfirmBlock(null);
  }, [selectedId, selected?.restrictionClass]);
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
  // Convex detail data can lag during a profile switch. Never feed the prior
  // renter's rentals into payment controls under the newly selected profile.
  const paymentRentals = selected && detail?.id === selected.id ? detail.rentals as AccountRentalOption[] : [];
  const reviewQueue = useQuery(api.accountAdmin.verificationReviews, selected && !panelClosed ? {token,accountId:selected.id as any} : "skip");
  const history = useQuery(
    api.accountAdmin.history,
    selected ? { token, accountId: selected.id } : "skip",
  );
  // Credit issues and receipts have a dedicated Billing → Credits view. Keep
  // the Access history focused on account and rental-access changes so the
  // same credit action is not presented twice in the side panel.
  const accessHistory = history?.filter(change =>
    change.kind !== "credit_grant" && change.kind !== "credit_grant_acknowledged",
  ) ?? [];
  const setRentalAccess = useMutation(api.accountAdmin.setRentalAccess);
  const setBlocked = useMutation(api.accountAdmin.setBlocked);
  const setStarred = useMutation(api.accountAdmin.setStarred);
  const openStripeBilling = useAction(api.checkout.adminBillingPortal);
  const refreshStripeMembership = useAction(api.checkout.adminRefreshMembership);
  useEffect(() => {
    setLevel((selected?.override ?? "automatic") as Level);
    setEncoreLevel((selected?.encoreOverride ?? "automatic") as EncoreLevel);
    setAccessReason("");
    setRestrictionReason("");
    setConfirmBlock(null);
    setProfileDraft(null);
  }, [selected?.id, selected?.override, selected?.encoreOverride, selected?.blocked, selected?.blockedAt, selected?.restrictionNoticeId, selected?.blockedReason, selected?.restrictionRevision, token, panelClosed]);
  useEffect(() => {
    setMessage("");
    setSection("closed");
    setNote("");
    setRentalView("history");
    setBillingView("payments");
    setSafetyView("notes");
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
  function selectAccount(id: string, clearSearch = false) {
    if (clearSearch) {
      setInput("");
      setEmail("");
    }
    if (scope.current.accountId !== id || scope.current.panelClosed)
      scope.current = { token, accountId: id, panelClosed: false };
    setSelectedId(id);
    setActiveConversationId(null);
    setManagedRentalSelection(null);
    setPanelClosed(false);
    if (window.matchMedia("(max-width:1350px)").matches) {
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
  async function apply(kind: "access" | "block") {
    const actionReason = kind === "access" ? accessReason : restrictionReason;
    if (!selected || panelClosed || busy || searchPending || (kind === "block" && (!confirmBlock || !actionReason.trim()))) return;
    const origin = scope.current;
    setBusy(true);
    setMessage("");
    try {
      if (kind === "access")
        await setRentalAccess({
          token,
          accountId: selected.id,
          level,
          expectedLevel: selected.override as Level,
          encoreLevel: encoreLevel === "automatic" ? "automatic" : Number(encoreLevel) as 1 | 2 | 3,
          expectedEncoreLevel: selected.encoreOverride === "automatic" ? "automatic" : Number(selected.encoreOverride) as 1 | 2 | 3,
          reason: actionReason,
        });
      else
        await setBlocked({
          token,
          accountId: selected.id,
          blocked: confirmBlock!.action !== "restore",
          restrictionClass: confirmBlock!.restrictionClass,
          reason: actionReason,
          expected: { blockedAt: confirmBlock!.blockedAt, restrictionClass: confirmBlock!.expectedRestrictionClass, noticeId: confirmBlock!.noticeId, reason: confirmBlock!.reason, revision: confirmBlock!.revision },
        });
      if (scope.current !== origin) return;
      setMessage(
        kind === "access"
          ? "Rental tier and Encore saved."
          : confirmBlock?.action === "reclassify"
            ? "Restriction type updated. The account remains blocked."
          : selected.blocked
            ? "Account unblocked. They can sign in again."
            : "Account blocked. Sessions and sign-in links revoked.",
      );
      setConfirmBlock(null);
      if (kind === "block") setRestrictionReason("");
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
  async function refreshMembershipStatus() {
    if (!selected || panelClosed || busy || searchPending || !selected.hasSubscription) return;
    const origin = scope.current;
    setBusy(true);
    setMessage("");
    try {
      const result = await refreshStripeMembership({ token, accountId: selected.id });
      if (scope.current === origin) setMessage(`Subscription refreshed · ${result.status}.`);
    } catch (error) {
      if (scope.current === origin) setMessage(error instanceof Error ? error.message : "Could not refresh the Stripe subscription.");
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
          data-testid="admin-rental-history-row"
          onClick={() => onRental?.(rental.id)}
          disabled={!onRental}
        >
          <div className={styles.kitPhotos} aria-label="Booked equipment" data-testid="admin-rental-history-images">
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
          <span className={styles.rentalTitle} data-testid="admin-rental-history-title">
            <strong title={rental.title}>{rental.title}</strong>
            <small>
              {date(rental.start)} · {rental.quantity} items
            </small>
          </span>
          <span className={styles.status} data-testid="admin-rental-history-status">
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
  const upcomingRental = detail?.rentals
    .filter(rental => typeof rental.start === "number" && rental.start >= Date.now() && !["cancelled", "declined", "rejected", "expired", "failed"].includes(rental.status))
    .sort((left, right) => (left.start ?? 0) - (right.start ?? 0))[0] ?? null;
  const supportConversation = detail?.conversations.find(thread => !thread.bookingId) ?? null;
  // Booking conversations already show their date/status and real item photos
  // in the center pane. Use the spare profile rail only for a support thread.
  const contextRental = !activeConversationId && supportConversation ? upcomingRental : null;
  const managedRental = detail?.rentals.find(rental =>
    managedRentalSelection !== null && managedRentalSelection.accountId === selected?.id && rental.id === managedRentalSelection.bookingId,
  ) ?? detail?.rentals.find(rental => rental.id === activeRental?.id) ?? detail?.rentals[0] ?? null;
  // Keep a selected rental visible in the message timeline while the support
  // thread is open. A rental thread always uses its own booking context.
  const conversationRental = activeConversationId ? activeRental : managedRental;
  const reviewRentals = reviewQueue?.items ?? [];
  // Check the account's bounded set of verified rentals in one admin query;
  // do not tie the safety alert to whichever chat happens to be selected.
  const currentPlan = detail ? subscriptionSummary(detail) : null;
  const currentPlanLabel = currentPlan
    ? ["Not linked", "No plan"].includes(currentPlan.label) ? "No plan" : currentPlan.label
    : selected?.hasSubscription ? "Plan loading…" : "No plan";
  const selectedEncore = selected ? effectiveEncoreFor(selected) : null;
  const selectedEncoreMetric = selected ? metrics?.find(metric => metric.id === selected.id) : undefined;
  const selectedEncoreLabel = selectedEncore
    ? `Encore ${selectedEncore}`
    : !selectedEncoreMetric ? "Encore loading…" : selectedEncoreMetric.encoreLevel === null ? "Encore needs review" : "No Encore";
  const selectedEncoreAccessible = selectedEncore
    ? `${selected?.encoreOverride === "automatic" ? "earned" : "assigned"} ${encoreName(selectedEncore)}`
    : !selectedEncoreMetric ? "Encore loading" : selectedEncoreMetric.encoreLevel === null ? "Encore needs review" : "no Encore tier";
  const profileSections = [
    ["overview", "Contact"],
    ["rentals", "Rentals"],
    ...(reviewRentals.length ? [["verification", "Verification"]] : []),
    ["documents", "Documents"],
    ["billing", "Billing"],
    ["safety", "Notes & safety"],
  ];
  function openRentalManagement(bookingId: string) {
    if (!selected || panelClosed || searchPending) return;
    setManagedRentalSelection({ accountId: selected.id, bookingId });
    setRentalView("actions");
    setSection("rentals");
  }
  return (
    <section data-testid="admin-accounts" className={styles.root} data-mobile-pane={mobilePane}>
      <h1 className={styles.srOnly}>Customers &amp; Members</h1>
      <nav className={styles.mobileWorkspaceNav} data-testid="admin-mobile-workspace-nav" aria-label="Customer workspace views">
        <button type="button" aria-pressed={mobilePane === "directory"} onClick={() => setMobilePane("directory")}>Customers</button>
        <button type="button" disabled={!selected} aria-pressed={mobilePane === "conversation"} onClick={() => setMobilePane("conversation")}>Chat{selected && unreadMessagesFor(selected.id) > 0 ? <span>{unreadMessagesFor(selected.id) > 99 ? "99+" : unreadMessagesFor(selected.id)}</span> : null}</button>
        <button type="button" disabled={!selected} aria-pressed={mobilePane === "profile"} onClick={openMobileProfile}>Profile</button>
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
        <div className={styles.filters} data-mobile-open={mobileFiltersOpen}>
          <button type="button" className={styles.mobileFilterToggle} data-testid="account-mobile-filter-toggle" aria-controls="admin-account-filter-fields" aria-expanded={mobileFiltersOpen} onClick={() => setMobileFiltersOpen(open => !open)}>
            <span>{mobileFiltersOpen ? "Hide filters" : "Filters"}</span>
            {activeFilterCount > 0 && <span className={styles.activeFilterCount}>{activeFilterCount} active</span>}
            <span aria-hidden="true">{mobileFiltersOpen ? "−" : "+"}</span>
          </button>
          <div id="admin-account-filter-fields" className={styles.filterFields}>
          <label>
            <span className={styles.filterLabel}>Rental tier</span>
            <select
              value={tierFilter}
              onChange={(e) => { setTierFilter(e.target.value as typeof tierFilter); setPage(0); setSelectedId(null); }}
            >
              <option value="all">All rental tiers</option>
              <option value="standard">Standard · no paid plan</option>
              {LEVELS.filter(([key]) => key !== "automatic" && key !== "standard").map(
                ([key, name]) => (
                  <option key={key} value={key}>
                    {name === "Starter" ? "Starter plan" : `${name} plan`}
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
        </div>
        <div className={styles.customerList} data-testid="admin-customer-list">
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
        <footer className={styles.directoryFooter} data-testid="admin-directory-footer">
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
            <button type="button" onClick={openMobileProfile}>Profile</button>
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
            bookingSummary={conversationRental ? {
              heading: activeConversationId ? "Items in this rental" : "Selected rental",
              items: (conversationRental.items ?? []).map(item => ({
                title: item.title,
                qty: item.qty,
                heroImage: item.heroImage ?? item.imageSources?.[0] ?? null,
                imageSources: item.imageSources?.length ? item.imageSources : item.heroImage ? [item.heroImage] : [],
              })),
              dates: `${date(conversationRental.start)} – ${date(conversationRental.end)}`,
              count: conversationRental.items?.length || conversationRental.quantity,
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
          ref={actionRailRef}
          className={styles.detail}
          data-testid="admin-account-action-rail"
          aria-label="Customer profile"
        >
          <header className={styles.profileHeader}>
            <div className={styles.profileContact} data-testid="admin-profile-contact">
              <h2 className={styles.visuallyHidden} data-testid="admin-account-management-heading">Account management</h2>
              <div className={styles.profileIdentity}>
                <span className={`${styles.profileAvatar} ${isCurrentlyVerified(selected) ? styles.profileAvatarVerified : ""}`} data-testid="admin-profile-avatar" role="img" aria-label={isCurrentlyVerified(selected) ? "Verification current" : "Customer profile photo"}>
                  <span className={styles.profileAvatarCrop}>
                    {selected.avatarUrl ? <SmartImage fit="cover" src={selected.avatarUrl} alt="" className={styles.profileAvatarImage} /> : <span className={styles.profileAvatarInitial}>{(selected.name || selected.email).slice(0, 1).toUpperCase()}</span>}
                    {!selected.avatarUrl && privatePortraitsAvailable && <PrivateVerificationPortrait token={token} accountId={selected.id} className={styles.privatePortrait} />}
                  </span>
                  {isCurrentlyVerified(selected) && <span className={styles.profileVerificationCheck} aria-hidden="true">✓</span>}
                </span>
                <div className={styles.profileIdentityDetails}>
                  <h2 data-testid="admin-profile-name">{selected.name || "DB Cinema renter"}</h2>
                  <span className={styles.profilePhone} data-testid="admin-profile-phone">{detail?.phone || "No phone on file"}</span>
                </div>
                {detail?.phone && <a className={styles.profileCall} data-testid="admin-profile-call" href={`tel:${detail.phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${selected.name || "customer"}`}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.7a15 15 0 0 0 4.8 4.8L15 13l5 2v4c0 1.1-.9 2-2 2C10.3 21 3 13.7 3 6c0-1.1.9-2 2-2Z"/></svg>
                  Call
                </a>}
              </div>
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
          <div className={styles.summary} data-testid="admin-account-summary">
          <div className={styles.summaryStatus} role="status" aria-label={selected.blocked ? "Account status: restricted" : "Account status: unrestricted"} title="Sign-in and booking access. Verification and rental approval are shown separately."><span><ActionIcon name="overview"/> Account status</span><strong className={selected.blocked ? styles.blocked : styles.verified}>{selected.blocked ? "Restricted" : "Unrestricted"}</strong></div>
          <button type="button" data-testid="admin-membership-summary" aria-label={`Membership: ${label(selected.tier)}, ${selectedEncoreAccessible}; Stripe subscription ${currentPlanLabel}`} aria-expanded={section === "membership"} aria-controls="customer-action-content" onClick={openMembership}>
              <span><ActionIcon name="membership"/> Membership</span>
              <strong>
                <><span data-testid="admin-membership-summary-value" className={`${styles.summaryValue} ${selectedEncoreMetric?.encoreLevel === null && !selectedEncore ? styles.summaryValueReview : ""}`} title={`${label(selected.tier)} · ${selectedEncoreLabel}`} aria-hidden="true">{`${label(selected.tier)} · ${selectedEncoreLabel}`}</span><span data-testid="admin-subscription-summary" className={`${styles.summaryPlan} ${currentPlan?.tone === "ready" ? styles.summaryPlanReady : currentPlan?.tone === "attention" ? styles.summaryPlanAttention : styles.summaryPlanMuted}`} title={`Paid plan · ${currentPlanLabel}`} aria-hidden="true">{currentPlanLabel}</span>{selectedEncore ? <span className={styles.visuallyHidden}>{`${selected.encoreOverride === "automatic" ? "Earned" : "Assigned"} ${encoreName(selectedEncore)}`}</span> : null}</>
                <span className={styles.summaryCaret} aria-hidden="true">{section === "membership" ? "↑" : "↗"}</span>
              </strong>
            </button>
          </div>
          {!panelClosed && <PossibleRestrictedIdentityAccountMatches key={selected.id} token={token} accountId={selected.id as any} onOpenAccount={id => selectAccount(id, true)}/>}
          <nav
            className={styles.profileTabs}
            data-testid="admin-account-profile-sections"
            data-context-rental-id={contextRental?.id ?? "none"}
            aria-label="Customer profile sections"
          >
            {profileSections.map(([key, name], index) => (
              <button
                type="button"
                key={key}
                style={{order: index * 2 + 2}}
                data-testid={key === "verification" ? "admin-verification-review-action" : `admin-account-section-${key}`}
                aria-label={key === "verification" ? `${reviewRentals.length} Didit verification case${reviewRentals.length === 1 ? "" : "s"} need manual review` : undefined}
                title={key === "verification" ? `${reviewRentals.length} Didit case${reviewRentals.length === 1 ? "" : "s"} need manual review` : undefined}
                aria-pressed={section === key}
                aria-expanded={section === key}
                aria-controls="customer-action-content"
                onClick={() => setSection(current => current === key ? "closed" : key)}
                className={`${section === key ? styles.active : ""} ${key === "verification" ? styles.verificationAttention : ""}`}
              >
                <span className={styles.actionLabel}><ActionIcon name={key === "billing" ? "billing" : key === "safety" ? "notes" : key}/>{key === "verification" ? <>{name}<span className={styles.reviewCount}>{reviewRentals.length}</span></> : <>{name}{key === "rentals" && detail ? ` · ${detail.rentals.length}${detail.rentalsMore ? "+" : ""}` : ""}</>}</span>
                <span aria-hidden>{section === key ? "−" : "+"}</span>
              </button>
            ))}
          </nav>
          {section === "closed" && contextRental && <section className={`${styles.card} ${styles.currentRentalCard}`} aria-label="Next upcoming rental" data-testid="admin-current-rental-card">
            <header>
              <div className={styles.currentRentalHeading}>
                <h3>Next rental</h3>
                <strong>{contextRental.title}</strong>
              </div>
              <span className={styles.status} data-testid="admin-current-rental-status">{contextRental.status.replaceAll("_", " ")}</span>
            </header>
            <div className={styles.currentRentalPhotos} aria-label="Booked listing images">
              {(contextRental.items?.length ? contextRental.items : [{ title: contextRental.title, qty: contextRental.quantity, heroImage: undefined, imageSources: contextRental.imageSources ?? [] }]).slice(0, 4).map((item, index) => {
                const sources = item.imageSources?.length ? item.imageSources : item.heroImage ? [item.heroImage] : [];
                return <div className={styles.kitPhotoWrap} key={`${contextRental.id}-${index}`} title={`${item.title}${item.qty > 1 ? ` ×${item.qty}` : ""}`}>
                  <SmartImage fit="contain" src={sources[0]} fallbackSources={sources.slice(1)} alt={item.title} className={styles.currentRentalPhoto} />
                  {item.qty > 1 && <span className={styles.kitQuantity}>×{item.qty}</span>}
                </div>;
              })}
              {(contextRental.items?.length ?? 1) > 4 && <span className={styles.currentRentalOverflow}>+{(contextRental.items?.length ?? 1) - 4}</span>}
            </div>
            <p className={styles.currentRentalDates} data-testid="admin-current-rental-dates">{contextRental.start ? date(contextRental.start) : "Date unavailable"}{contextRental.end ? ` – ${date(contextRental.end)}` : ""} · {contextRental.quantity} item{contextRental.quantity === 1 ? "" : "s"}</p>
            <button type="button" className={styles.currentRentalManage} data-testid="admin-current-rental-manage" onClick={() => openRentalManagement(contextRental.id)}>
              Manage rental <span aria-hidden="true">↗</span>
            </button>
          </section>}
          <div id="customer-action-content" className={styles.profileBody} hidden={section === "closed" || (section !== "membership" && !profileSections.some(([key]) => key === section))} style={{order: section === "membership" ? -1 : Math.max(0, profileSections.findIndex(([key]) => key === section)) * 2 + 3}}>
            {!detail ? (
              <p role="status" className={styles.empty}>
                Loading account details…
              </p>
            ) : (
              <>
                {section === "documents" && <AccountDocuments embedded key={selected.id} token={token} accountId={selected.id} verificationExpiresAt={detail.verificationExpiresAt ?? null} customer={{name:selected.name || "DB Cinema renter",email:selected.email,avatarUrl:selected.avatarUrl,verified:isCurrentlyVerified(selected)}} onRental={onRental} />}
                {section === "overview" && <section className={`${styles.card} ${styles.accountDetails}`} aria-label="Account details">
                  <header className={styles.accountDetailsHeader}><h3>Contact</h3>{!profileDraft && <button type="button" className={styles.billingPortalButton} disabled={!detail || busy} onClick={() => setProfileDraft({accountId:selected.id,name:detail.name ?? "",phone:detail.phone ?? "",address:detail.address ?? "",reason:"",expected:{name:detail.name ?? null,phone:detail.phone ?? null,address:detail.address ?? null}})}>Edit</button>}</header>
                  {profileDraft?.accountId === selected.id ? <form className={styles.profileEditForm} onSubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
                    <label>Name<input autoComplete="off" maxLength={120} className="input mt-1 w-full" value={profileDraft.name} disabled={busy} onChange={event => setProfileDraft(current => current?.accountId === selected.id ? {...current,name:event.target.value} : current)}/></label>
                    <label>Phone<input autoComplete="off" inputMode="tel" maxLength={40} className="input mt-1 w-full" value={profileDraft.phone} disabled={busy} onChange={event => setProfileDraft(current => current?.accountId === selected.id ? {...current,phone:event.target.value} : current)}/></label>
                    <label>Address<input autoComplete="street-address" maxLength={300} className="input mt-1 w-full" value={profileDraft.address} disabled={busy} onChange={event => setProfileDraft(current => current?.accountId === selected.id ? {...current,address:event.target.value} : current)}/></label>
                    <label>Reason<textarea maxLength={500} className="input mt-1 min-h-14 w-full" value={profileDraft.reason} disabled={busy} onChange={event => setProfileDraft(current => current?.accountId === selected.id ? {...current,reason:event.target.value} : current)} placeholder="Saved to account history"/></label>
                    <p className={styles.profileEditHint}>Login email is managed separately.</p>
                    <div className={styles.profileEditActions}><button type="submit" className="btn-primary px-4 py-2 text-xs" disabled={busy || profileDraft.reason.trim().length < 3}>{busy ? "Saving…" : "Save details"}</button><button type="button" className={styles.profileCancel} disabled={busy} onClick={() => setProfileDraft(null)}>Cancel</button></div>
                  </form> : <dl><dt>Name</dt><dd>{detail.name || "Not supplied"}</dd><dt>Email</dt><dd>{onEmail ? <button type="button" data-testid="admin-open-email-thread" aria-label={`Open tracked email conversations for ${selected.email}`} onClick={() => onEmail(selected.email)} className="text-left text-sky-200/80 underline decoration-sky-200/25 underline-offset-2 hover:text-sky-100">{selected.email}</button> : selected.email}</dd><dt>Phone</dt><dd>{detail.phone || "Not supplied"}</dd><dt>Address</dt><dd>{detail.address || "Not supplied"}</dd><dt>Account created</dt><dd>{date(detail.createdAt)}</dd></dl>}
                </section>}
                {section === "rentals" && <>
                  <nav className={styles.profileSubtabs} aria-label="Rental view">
                    <button type="button" data-testid="admin-rental-view-history" className={styles.profileSubtab} aria-pressed={rentalView === "history"} onClick={() => setRentalView("history")}>History</button>
                    <button type="button" data-testid="admin-rental-view-actions" className={styles.profileSubtab} aria-pressed={rentalView === "actions"} disabled={!detail.rentals.length} onClick={() => setRentalView("actions")}>Manage rental</button>
                  </nav>
                  {rentalView === "history" ? <section className={styles.card}>
                    <header><h3>Rental history</h3></header>
                    {rentalRows()}
                    {detail.rentalsMore && <p className={styles.empty}>Showing the latest 100 rental requests.</p>}
                  </section> : managedRental ? <section className={styles.card} data-testid="admin-selected-rental-actions" aria-label={`Manage ${managedRental.title}`}>
                    {detail.rentals.length > 1 && <label className={styles.paymentRentalSelect}>Rental to manage<select aria-label="Rental to manage" data-testid="admin-managed-rental-select" value={managedRental.id} onChange={event => setManagedRentalSelection({ accountId: selected.id, bookingId: event.target.value })}>
                      {detail.rentals.map(rental => {const option=rentalPickerLabel(rental);return <option key={rental.id} value={rental.id} title={option.fullLabel}>{option.label}</option>})}
                    </select></label>}
                    <RentalExtensionPanel key={`extension-${managedRental.id}`} token={token} bookingId={managedRental.id} admin />
                    <RentalOrderTools key={managedRental.id} token={token} bookingId={managedRental.id} showSavedCardTools={false} compactControls />
                  </section> : <p className={styles.empty}>No rentals linked to this account.</p>}
                </>}
                {section === "billing" && <>
                  <nav className={styles.profileSubtabs} aria-label="Billing view">
                    <button type="button" data-testid="admin-billing-view-payments" className={styles.profileSubtab} aria-pressed={billingView === "payments"} onClick={() => setBillingView("payments")}>Card claims</button>
                    <button type="button" data-testid="admin-billing-view-invoices" className={styles.profileSubtab} aria-pressed={billingView === "invoices"} onClick={() => setBillingView("invoices")}>Invoices</button>
                    <button type="button" data-testid="admin-billing-view-credits" className={styles.profileSubtab} aria-pressed={billingView === "credits"} onClick={() => setBillingView("credits")}>Credits</button>
                  </nav>
                  {billingView === "payments" && <>
                    <AccountPayments key={`${token}:${selected.id}`} token={token} rentals={paymentRentals}/>
                  </>}
                  {billingView === "invoices" && <>
                    <MembershipInvoiceRecovery key={`membership-credit-${selected.id}`} token={token} accountId={selected.id as Id<"accounts">} />
                    <AdminInvoiceLibrary key={selected.id} token={token} accountId={selected.id}/>
                  </>}
                  {billingView === "credits" && <AccountCreditPanel token={token} accountId={selected.id}/>}
                </>}
                {section === "verification" && reviewRentals.map(rental => <section key={rental.id} className={styles.card}><h3>{rental.title}</h3><p>{date(rental.start)}</p><RentalVerificationSummary token={token} bookingId={rental.id} admin /></section>)}
                {section === "verification" && reviewQueue?.more && <p className={styles.empty}>More than 20 cases need review. Resolve the displayed cases to see the rest.</p>}
                {section === "safety" && <>
                  <nav className={styles.profileSubtabs} aria-label="Safety view">
                    <button type="button" data-testid="admin-safety-view-notes" className={styles.profileSubtab} aria-pressed={safetyView === "notes"} onClick={() => setSafetyView("notes")}>Notes</button>
                    <button type="button" data-testid="admin-safety-view-restriction" className={`${styles.profileSubtab} ${selected.blocked ? styles.profileSubtabDanger : ""}`} aria-pressed={safetyView === "restriction"} onClick={() => setSafetyView("restriction")}>{selected.blocked ? "Restore access" : "Restrict account"}</button>
                  </nav>
                  {safetyView === "notes" && (
                  <section className={styles.card}>
                    <header><h3>Internal customer notes</h3></header>
                    <label className={styles.noteLabel}>Add a note<textarea maxLength={2000} disabled={noteBusy} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to admins only" /></label>
                    <button type="button" disabled={!note.trim() || noteBusy} onClick={() => void saveNote()} className="btn-primary mt-3 px-4 py-2 text-xs">{noteBusy ? "Saving…" : "Save note"}</button>
                    {detail.notes.map((n) => <article key={n.id} className={styles.noteEntry}><p>{n.text}</p><small>Added {date(n.at)}</small></article>)}
                  </section>
                  )}
                </>}
                {section === "membership" && <div className={styles.membershipPanel} data-testid="admin-membership-panel">
                  <section className={`${styles.card} ${styles.accessPanel}`} data-testid="admin-membership-controls">
                    <div className={styles.accessCloseHeader}>
                      <div><h3>Rental access</h3></div>
                      <button type="button" className={styles.accessClose} onClick={() => setSection("closed")} aria-label="Close membership controls">×</button>
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
                            {key === "automatic" ? "Automatic from plan" : name}
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
                    <p className={styles.accessHelp} data-testid="admin-account-level-help">Uses the plan · no billing or deposit change.</p>
                    <label className="mt-4 block text-xs text-white/65">
                      Reason for access change
                      <textarea
                        value={accessReason}
                        disabled={busy}
                        maxLength={500}
                        onChange={(e) => setAccessReason(e.target.value)}
                        data-testid="admin-account-access-reason"
                        className="input mt-2 min-h-14 w-full"
                        placeholder="Saved to account history"
                      />
                    </label>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid="admin-account-save-access"
                        disabled={
                          busy ||
                          searchPending ||
                          !accessReason.trim() ||
                          level === selected.override && encoreLevel === selected.encoreOverride
                        }
                        onClick={() => apply("access")}
                        className="btn-primary px-5 py-2 text-xs disabled:opacity-40"
                      >
                        {busy ? "Saving…" : "Save rental access"}
                      </button>
                    </div>
                    {message && (
                      <p role="status" className="mt-4 text-xs text-accent-200">
                        {message}
                      </p>
                    )}
                    {!!accessHistory.length && (
                      <details className="mt-5 rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
                        <summary className="cursor-pointer text-xs font-medium text-white/65">Recent changes · {accessHistory.length}</summary>
                        <ul className="mt-3 space-y-3">
                          {accessHistory.map((change) => (
                            <li
                              key={change._id}
                              className="text-[11px] leading-5 text-white/45"
                            >
                              <span className="text-white/70">
                                {change.kind === "encore_level"
                                  ? `${encoreLabel(change.before)} → ${encoreLabel(change.after)}`
                                  : change.kind === "level"
                                  ? `${label(change.before)} → ${label(change.after)}`
                                  : change.kind === "profile_update"
                                    ? `Profile details updated · ${change.before}`
                                    : change.kind === "identity_retention_hold"
                                      ? "Verification archive permanently retained for identity review"
                                      : change.kind === "restriction_reclassify"
                                        ? "Account restriction type updated"
                                        : change.kind === "block"
                                          ? "Account restricted"
                                          : change.kind === "unblock"
                                            ? "Account access restored"
                                            : "Account setting updated"}
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
                    <div className={styles.billingSubpanel} aria-label="Stripe subscription" data-testid="admin-membership-plan">
                    <header className={styles.billingHeader}>
                      <h3>Stripe subscription</h3>
                    </header>
                    {detail.hasBillingCustomer && <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" data-testid="admin-billing-controls" aria-label="Open Stripe billing settings" onClick={openBilling} disabled={busy || searchPending} className={styles.billingPortalButton}>
                        <ActionIcon name="billing"/><span>{busy ? "Opening Stripe…" : "Open in Stripe"}</span><span aria-hidden="true">↗</span>
                      </button>
                      {selected.hasSubscription && <button type="button" data-testid="admin-membership-refresh" aria-label="Refresh subscription status from Stripe" onClick={() => void refreshMembershipStatus()} disabled={busy || searchPending} className={styles.billingPortalButton}>
                        <span>{busy ? "Refreshing…" : "Refresh status"}</span>
                      </button>}
                    </div>}
                    {selected.hasSubscription && <div className={styles.billingStatusCard}><div className={styles.billingDates}>
                      {detail.trialEnd && detail.membershipStatus === "trialing" ? <div><span>Trial ends</span><strong>{date(detail.trialEnd)}</strong></div> : null}
                      {detail.paidThrough ? <div><span>{detail.cancelAtPeriodEnd ? "Ends" : "Paid through"}</span><strong>{date(detail.paidThrough)}</strong></div> : null}
                    </div></div>}
                    {detail.membershipStatus === "provider_missing" && <div role="status" className={styles.billingNotice}><span className={styles.billingNoticeGlyph}>!</span><span>Subscription not found in Stripe</span></div>}
                    {!detail.hasBillingCustomer && <p className={styles.empty}>No paid plan is linked to this account.</p>}
                    </div>
                  </section>
                </div>}
                {section === "safety" && safetyView === "restriction" && (
                  <section className={styles.card}>
                    <h3>{selected.blocked ? "Account restricted" : "Restrict account"}</h3>
                    <p className="mt-2 text-xs leading-5 text-white/65">{selected.blocked ? "Sign-in and new bookings blocked · rentals and balances stay." : "Blocks sign-in and new bookings · active rentals stay."} Email notice sent when possible.</p>
                    {selected.blocked && detail.restrictionNotice && <p role="status" className="mt-2 text-xs text-white/70">{detail.restrictionNotice.state === "sent" ? "Notice accepted · delivery unconfirmed." : detail.restrictionNotice.state === "attention" ? "Notice needs attention." : detail.restrictionNotice.state === "skipped" ? "Notice skipped · account changed." : "Notice queued."}</p>}
                    {selected.blockedReason && <p className="mt-2 text-xs text-rose-200">Current reason: {selected.blockedReason}</p>}
                    <label className="mt-4 block text-xs text-white/65">Restriction type
                      <select value={restrictionClass} disabled={busy} onChange={event => { setRestrictionClass(event.target.value as typeof restrictionClass); setConfirmBlock(null); setMessage(""); }} data-testid="admin-account-restriction-class" className="input mt-2 w-full">
                        <option value="">Choose restriction type</option>
                        <option value="access_only">Access restriction</option>
                        <option value="identity_safety_blacklist">Identity / safety blacklist</option>
                      </select>
                    </label>
                    {restrictionClass === "access_only" && <p className="mt-2 text-xs text-white/55">{selected.restrictionClass === "identity_safety_blacklist" ? "Blocks access and stops new match alerts. Files follow the rental and case schedule." : "Blocks access. Verification files follow the rental and case schedule."}</p>}
                    {restrictionClass === "identity_safety_blacklist" && <p className="mt-2 text-xs text-amber-100/70">Possible future matches alert the team for review. Files follow the rental and case schedule.</p>}
                    <label className="mt-4 block text-xs text-white/65">Reason<textarea value={restrictionReason} disabled={busy} maxLength={500} onChange={e => { setRestrictionReason(e.target.value); setConfirmBlock(null); }} data-testid="admin-account-restriction-reason" className="input mt-2 min-h-20 w-full" placeholder="Saved to admin history" /></label>
                    <button type="button" data-testid="admin-account-block" disabled={busy || searchPending || !restrictionReason.trim() || !restrictionClass} onClick={() => restrictionClass && setConfirmBlock({blockedAt:selected.blockedAt ?? null,action:selected.blocked ? restrictionClass === selected.restrictionClass ? "restore" : "reclassify" : "restrict",restrictionClass,expectedRestrictionClass:selected.restrictionClass ?? null,noticeId:selected.restrictionNoticeId ?? null,reason:selected.blockedReason,revision:selected.restrictionRevision ?? 0})} className="mt-3 rounded-lg border border-rose-300/35 px-4 py-2 text-xs text-rose-200 disabled:opacity-40">{selected.blocked ? restrictionClass === selected.restrictionClass ? "Review restore" : "Review type change" : "Review restriction"}</button>
                    {confirmBlock && <div className="mt-4 rounded-xl border border-rose-300/25 p-4 text-xs leading-5 text-white/65" role="group" aria-label="Confirm account change"><p className="font-medium text-white">{confirmBlock.action === "reclassify" ? `Change restriction type for ${selected.name || "customer"}?` : confirmBlock.action === "restore" ? `Restore ${selected.name || "customer"}?` : `Restrict ${selected.name || "customer"}?`}</p><p className="mt-1">{confirmBlock.action === "reclassify" ? "Access stays blocked. No new renter email is sent." : confirmBlock.action === "restore" ? "Sign-in returns; old sessions stay closed." : "Blocks sign-in and new bookings · active rentals stay."}</p><p className="mt-1">{confirmBlock.restrictionClass === "identity_safety_blacklist" ? "Future possible matches alert the team for manual review. This does not block a matched renter automatically; files follow the rental and case schedule." : selected.restrictionClass === "identity_safety_blacklist" ? "Stops future match alerts. Files still follow the rental and case schedule." : "Verification files follow the rental and case schedule."}</p><p className="mt-2 break-words">Reason: {restrictionReason.trim()}</p><div className="mt-3 flex gap-3"><button type="button" data-testid="admin-account-confirm-block" onClick={() => apply("block")} disabled={busy || searchPending || !restrictionReason.trim()} className="text-rose-200">{confirmBlock.action === "reclassify" ? "Save type" : confirmBlock.action === "restore" ? "Restore access" : "Restrict account"}</button><button type="button" onClick={() => setConfirmBlock(null)}>Cancel</button></div></div>}
                  </section>
                )}
              </>
            )}
            {message && section !== "membership" && (
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
