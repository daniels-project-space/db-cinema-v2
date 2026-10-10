"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { AccountDocuments, AccountDocumentSummary } from "./AccountDocuments";
import { SmartImage } from "@/components/SmartImage";
import { formatGbp } from "@/lib/pricing";
import styles from "./AccountAdmin.module.css";
import { CustomerInvite } from "./CustomerInvite";

const LEVELS = [
  ["automatic", "Automatic · subscription / existing grant"],
  ["standard", "Standard"],
  ["plus", "Starter"],
  ["pro", "Pro"],
  ["studio", "Studio"],
] as const;
const label = (value: string) =>
  LEVELS.find(([key]) => key === value)?.[1] ?? value;
type Level = (typeof LEVELS)[number][0];
const personInitials = (name: string, email: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((Array.from(parts[0] || email)[0] || "?") + (parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : "")).toUpperCase();
};
const conversationTime = (at: number) => new Date(at).toLocaleString("en-GB", {timeZone:"Europe/London",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});

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
  const [input, setInput] = useState(""),
    [email, setEmail] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("automatic"),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [confirmBlock, setConfirmBlock] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"all" | "members" | "verified" | "pending">("all"),
    [tierFilter, setTierFilter] = useState<"all" | "standard" | "plus" | "pro" | "studio">("all"),
    [page, setPage] = useState(0);
  const [verificationFilter, setVerificationFilter] = useState<"all" | "verified" | "pending">("all");
  const [checked, setChecked] = useState<string[]>([]);
  const [section, setSection] = useState("overview"),
    [panelClosed, setPanelClosed] = useState(false);
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
    authorized ? { token, search: email, filter, tier: tierFilter, verification: verificationFilter } : "skip",
    { initialNumItems: 100 },
  );
  const searchPending = input !== email || authorized === undefined || status === "LoadingFirstPage";
  const selected = !authorized || searchPending ? undefined :
    visible.find((a) => a.id === selectedId) ?? visible[0];
  // Replaced during render so a result cannot reach a different profile,
  // including closing and reopening the same account or changing admin session.
  const scope = useRef<{ token: string; accountId: string | undefined; panelClosed: boolean }>({ token, accountId: selected?.id, panelClosed });
  if (scope.current.token !== token || scope.current.accountId !== selected?.id || scope.current.panelClosed !== panelClosed)
    scope.current = { token, accountId: selected?.id, panelClosed };
  const currentScope = scope.current;
  const detail = useQuery(
    api.accountAdmin.detail,
    selected && !panelClosed ? { token, accountId: selected.id } : "skip",
  );
  const history = useQuery(
    api.accountAdmin.history,
    selected ? { token, accountId: selected.id } : "skip",
  );
  const setAccountLevel = useMutation(api.accountAdmin.setLevel);
  const setBlocked = useMutation(api.accountAdmin.setBlocked);
  useEffect(() => {
    setLevel((selected?.override ?? "automatic") as Level);
    setReason("");
    setConfirmBlock(false);
  }, [selected?.id, selected?.override, selected?.blocked, token, panelClosed]);
  useEffect(() => {
    setMessage("");
    setSection("overview");
    setNote("");
    setBusy(false);
    setNoteBusy(false);
  }, [currentScope]);
  useEffect(() => setPage(0), [email, filter, tierFilter, verificationFilter]);
  const pages = Math.max(1, Math.ceil(visible.length / 10));
  const currentPage = page;
  const displayRows = searchPending ? [] : visible.slice(page * 10, page * 10 + 10);
  const metrics = useQuery(api.accountAdmin.directoryMetrics, authorized && !searchPending
    ? { token, accountIds: displayRows.map(a => a.id) } : "skip");
  useEffect(() => setChecked([]), [token, page, email, filter, tierFilter, verificationFilter]);
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
    onDocumentsChange?.(section === "documents" && selected && !panelClosed ? selected.name || "DB Cinema renter" : null);
    return () => onDocumentsChange?.(null);
  }, [section, selected?.id, selected?.name, panelClosed, onDocumentsChange]);
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
    setPanelClosed(false);
    if (window.matchMedia("(max-width:1100px)").matches)
      requestAnimationFrame(() =>
        profileRef.current?.scrollIntoView({
          block: "start",
          behavior: "smooth",
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
  async function apply(kind: "level" | "block") {
    if (!selected || panelClosed || busy || searchPending) return;
    const origin = scope.current;
    setBusy(true);
    setMessage("");
    try {
      if (kind === "level")
        await setAccountLevel({ token, accountId: selected.id, level, reason });
      else
        await setBlocked({
          token,
          accountId: selected.id,
          blocked: !selected.blocked,
          reason,
        });
      if (scope.current !== origin) return;
      setMessage(
        kind === "level"
          ? "Account level updated."
          : selected.blocked
            ? "Account unblocked. They can sign in again."
            : "Account blocked. Sessions and sign-in links revoked.",
      );
      setConfirmBlock(false);
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
          <SmartImage
            src={rental.imageSources[0]}
            fallbackSources={rental.imageSources.slice(1)}
            alt={rental.title}
            className={styles.kitPhoto}
          />
          <span>
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
  function conversations(limit = 20) {
    return !detail?.conversations.length ? (
      <p className={styles.empty}>No conversations yet.</p>
    ) : (
      detail.conversations.slice(0, limit).map((thread) => (
        <button
          type="button"
          key={thread.id}
          className={styles.conversation}
          title={thread.bookingId ? `Open rental ${thread.bookingId.slice(-8)} conversation` : "Open account conversation"}
          onClick={() =>
            selected && onConversation?.(selected.id, thread.bookingId)
          }
          disabled={!onConversation}
        >
          <span className={styles.initials}>
            {thread.lastSender === "owner"
              ? "DB"
              : personInitials(selected?.name || "", selected?.email || "")}
          </span>
          <span>
            <strong>
              {thread.lastSender === "owner" ? "DB Cinema Rentals" : thread.lastSender === "gaffer" ? "Gaffer" : selected?.name || "DB Cinema renter"}
            </strong>
            <small>{thread.lastMessage}</small>
            <time>
              {conversationTime(thread.updatedAt)}
              {thread.unread ? ` · ${thread.unread} unread` : ""}
            </time>
          </span>
          <span aria-hidden>›</span>
        </button>
      ))
    );
  }
  if (selected && !panelClosed && section === "documents") return (
    <AccountDocuments key={selected.id} token={token} accountId={selected.id}
      customer={{name:selected.name || "DB Cinema renter",email:selected.email,avatarUrl:selected.avatarUrl,verified:selected.verified}}
      onBack={() => setSection("overview")} onSection={setSection} />
  );
  return (
    <section data-testid="admin-accounts" className={styles.root}>
      <div className={styles.pageTools}>
        <label><span aria-hidden>⌕</span><span className={styles.srOnly}>Search all customers</span><input type="search" maxLength={254} placeholder="Search customers, name or email…" value={input} onChange={e => { setInput(e.target.value); setSelectedId(null); setPanelClosed(false); }} /></label>
        <button type="button" className={styles.filterButton} onClick={() => verificationRef.current?.focus()}>☷ <span>Filters</span></button>
        {authorized === true && <CustomerInvite />}
        {checked.length > 0 && <button type="button" className={styles.filterButton} onClick={() => {
          const csvValue = (value: string) => '"' + (/^[=+@\-\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""') + '"';
          const csv = ["Name,Email,Membership,Verified", ...displayRows.filter(a => checked.includes(a.id)).map(a => [a.name, a.email, label(a.tier), a.verified ? "Verified" : "Pending"].map(csvValue).join(","))].join("\r\n");
          const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "db-cinema-customers.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Export {checked.length}</button>}
      </div>
      <div className={styles.directory}>
        <nav className={styles.directoryTabs} aria-label="Customer filters">
          {[
            ["all", "All customers"],
            ["members", "Members"],
            ["verified", "Verified"],
            ["pending", "Pending"],
          ].map(([key, name]) => (
            <button
              type="button"
              key={key}
              aria-pressed={filter === key}
              onClick={() => { setFilter(key as typeof filter); setPage(0); setSelectedId(null); }}
              className={filter === key ? styles.active : ""}
            >
              {name}{filter === key && !searchPending ? <span> ({visible.length}{exhausted ? "" : " loaded"})</span> : null}
            </button>
          ))}
        </nav>
        <div className={styles.filters}>
          <label>
            <span className={styles.srOnly}>Search customers by name or email</span>
            <input
              type="search"
              maxLength={254}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setSelectedId(null);
                setPanelClosed(false);
              }}
              placeholder="Search name or email…"
              data-testid="account-email-search"
            />
          </label>
          <label>
            <span className={styles.srOnly}>Membership filter</span>
            <select
              value={tierFilter}
              onChange={(e) => { setTierFilter(e.target.value as typeof tierFilter); setPage(0); setSelectedId(null); }}
            >
              <option value="all">All membership tiers</option>
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
            <span className={styles.srOnly}>Verification filter</span>
            <select ref={verificationRef} aria-label="Verification status" value={verificationFilter} onChange={e => { setVerificationFilter(e.target.value as typeof verificationFilter); setPage(0); setSelectedId(null); }}>
              <option value="all">All verification status</option>
              <option value="verified">Verified</option>
              <option value="pending">Pending</option>
            </select>
          </label>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <colgroup><col style={{width:"4%"}}/><col style={{width:"23%"}}/><col style={{width:"21%"}}/><col style={{width:"14%"}}/><col style={{width:"13%"}}/><col style={{width:"8%"}}/><col style={{width:"12%"}}/><col style={{width:"5%"}}/></colgroup>
            <thead>
              <tr>
                <th className={styles.checkColumn}><input type="checkbox" aria-label="Select customers on this page" checked={displayRows.length > 0 && displayRows.every(a => checked.includes(a.id))} onChange={e => setChecked(e.target.checked ? displayRows.map(a => a.id) : [])} /></th>
                <th>Customer</th>
                <th className={styles.emailColumn}>Email</th>
                <th>Membership</th>
                <th className={styles.verificationColumn}>Verified</th>
                <th className={styles.metricColumn}>Active<br />rentals</th>
                <th className={styles.metricColumn}>Account<br />credit</th>
                <th>
                  <span className={styles.srOnly}>Open account</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((account) => (
                <tr
                  key={account.id}
                  className={
                    !panelClosed && selected?.id === account.id
                      ? styles.selectedRow
                      : ""
                  }
                >
                  <td className={styles.checkColumn}><input type="checkbox" aria-label={`Select ${account.name || account.email}`} checked={checked.includes(account.id)} onChange={e => setChecked(old => e.target.checked ? [...old, account.id] : old.filter(id => id !== account.id))} /></td>
                  <td>
                    <button
                      type="button"
                      data-testid="admin-account-row"
                      title={account.name || account.email}
                      onClick={() => selectAccount(account.id)}
                      className={styles.customer}
                    >
                      {account.avatarUrl ? (
                        <SmartImage
                          src={account.avatarUrl}
                          alt=""
                          className={styles.avatarSmall}
                        />
                      ) : (
                        <span className={styles.initials}>
                          {personInitials(account.name, account.email)}
                        </span>
                      )}
                      <span>
                        <strong>{account.name || "DB Cinema renter"}</strong>
                        <small className={styles.mobileEmail}>{account.email}</small>
                        <small className={styles.mobileVerification}>
                          {account.blocked
                            ? "Blocked"
                            : account.verified
                              ? "✓ Verified"
                              : "◷ Verification pending"}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td className={styles.emailColumn}><span>{account.email}</span></td>
                  <td>
                    <span className={styles.tier} data-tier={account.tier}>{label(account.tier)}</span>
                  </td>
                  <td className={styles.verificationColumn}>
                    <span
                      className={
                        account.blocked
                          ? styles.blocked
                          : account.verified
                            ? styles.verified
                            : styles.pending
                      }
                    >
                      {account.blocked
                        ? "Blocked"
                        : account.verified
                          ? "✓ Verified"
                          : "◷ Pending"}
                    </span>
                  </td>
                  <td className={styles.metricColumn}>{metrics?.find(m => m.id === account.id)?.activeRentals ?? "…"}{metrics?.find(m => m.id === account.id)?.activeRentalsMore ? "+" : ""}</td>
                  <td className={styles.metricColumn}>{metrics?.some(m => m.id === account.id) ? formatGbp(metrics.find(m => m.id === account.id)!.credit) : "…"}</td>
                  <td>
                    <button
                      type="button"
                      aria-label={`Open ${account.name || account.email}`}
                      onClick={() => selectAccount(account.id)}
                    >
                      ›
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
              ? `${currentPage * 10 + 1}–${Math.min((currentPage + 1) * 10, visible.length)} of ${visible.length}${exhausted ? "" : " loaded"}`
              : loading ? "Searching…" : "0 results"}
            <small>
              {exhausted ? "All matching accounts loaded." : "Continue through the pages to search the rest of the directory."}
            </small>
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
        <aside
          ref={profileRef}
          className={styles.detail}
          data-testid="admin-account-editor"
          aria-label="Customer profile"
        >
          <header className={styles.profileHeader}>
            {selected.avatarUrl ? (
              <SmartImage
                src={selected.avatarUrl}
                alt=""
                className={styles.avatarLarge}
              />
            ) : (
              <span className={styles.avatarLargeInitial}>
                {personInitials(selected.name, selected.email)}
              </span>
            )}
            <div>
              <div className={styles.profileIdentity}>
              <h2>{selected.name || "DB Cinema renter"}</h2>
              <span
                className={selected.verified ? styles.verified : styles.pending}
              >
                {selected.verified ? "✓ Verified" : "Verification pending"}
              </span>
              </div>
              <div className={styles.contacts}>
              <p><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h18v14H3z M3 5l9 7 9-7"/></svg> {selected.email}</p>
              {detail?.phone && <p><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 3h4l2 5-3 2c2 3 3 4 6 6l2-3 5 2v4c0 2-3 3-5 2C9 19 5 15 3 8 2 6 3 3 5 3Z"/></svg> {detail.phone}</p>}
              {detail?.address && <p className={styles.address}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></svg> {detail.address}</p>}
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
          <div className={styles.summary}>
            <div className={styles.membershipSummary}>
              <span>Membership</span>
              <strong>{label(selected.tier)}</strong>
              <small>
                {selected.hasSubscription
                  ? "Paid subscription"
                  : selected.tier !== "standard"
                    ? "Granted access"
                    : "Standard account"}
              </small>
              {detail && <small>Account created {date(detail.createdAt)}</small>}
            </div>
            <div>
              <span>Available credit</span>
              <strong>{detail ? formatGbp(detail.credit) : "…"}</strong>
              {detail && (
                <small>
                  {formatGbp(detail.refundCredit)} refund credit included
                </small>
              )}
            </div>
          </div>
          <nav
            className={styles.profileTabs}
            aria-label="Customer profile sections"
          >
            {[
              ["overview", "Overview"],
              ["rentals", "Rentals"],
              ["conversations", "Conversations"],
              ["documents", "Documents"],
              ["access", "Access"],
              ["notes", "Notes"],
            ].map(([key, name]) => (
              <button
                type="button"
                key={key}
                aria-pressed={section === key}
                onClick={() => setSection(key)}
                className={section === key ? styles.active : ""}
              >
                {name}
                {key === "rentals" && detail
                  ? ` (${detail.rentals.length}${detail.rentalsMore ? "+" : ""})`
                  : ""}
              </button>
            ))}
          </nav>
          <div className={styles.profileBody}>
            {!detail ? (
              <p role="status" className={styles.empty}>
                Loading account details…
              </p>
            ) : (
              <>
                {section === "overview" && (
                  <>
                    <div className={styles.overviewGrid}>
                      <section className={styles.card}>
                        <header>
                          <h3>Recent rentals</h3>
                          <button
                            type="button"
                            onClick={() => setSection("rentals")}
                          >
                            View all →
                          </button>
                        </header>
                        {rentalRows(3)}
                      </section>
                      <section className={styles.card}>
                        <header>
                          <h3>Membership status</h3>
                        </header>
                        <span className={styles.tier}>
                          {label(selected.tier)}
                        </span>
                        <span
                          className={
                            detail.membershipActive
                              ? styles.verified
                              : styles.pending
                          }
                        >
                          {detail.membershipActive ? "Active" : "Standard"}
                        </span>
                        <dl>
                          <dt>Account created</dt>
                          <dd>{date(detail.createdAt)}</dd>
                          <dt>Paid through</dt>
                          <dd>
                            {detail.paidThrough
                              ? date(detail.paidThrough)
                              : "No paid period"}
                          </dd>
                          <dt>Verification valid until</dt>
                          <dd>
                            {detail.verificationExpiresAt
                              ? date(detail.verificationExpiresAt)
                              : selected.verified
                                ? "Legacy verification"
                                : "Pending"}
                          </dd>
                        </dl>
                        {detail.cancelAtPeriodEnd && (
                          <p className={styles.empty}>
                            Subscription cancellation scheduled.
                          </p>
                        )}
                      </section>
                      <section className={styles.card}>
                        <header>
                          <h3>Recent conversations</h3>
                          <button
                            type="button"
                            onClick={() => setSection("conversations")}
                          >
                            View all →
                          </button>
                        </header>
                        {conversations(2)}
                      </section>
                      <section className={styles.card}>
                        <header>
                          <h3>Documents</h3>
                          <button
                            type="button"
                            onClick={() => setSection("documents")}
                          >
                            Review →
                          </button>
                        </header>
                        <AccountDocumentSummary
                          token={token}
                          accountId={selected.id}
                          onReview={() => setSection("documents")}
                        />
                      </section>
                    </div>
                    <section className={styles.card}>
                      <header>
                        <h3>Customer notes</h3>
                        <button
                          type="button"
                          onClick={() => setSection("notes")}
                        >
                          Add note →
                        </button>
                      </header>
                      {detail.notes[0] ? (
                        <>
                          <p className={styles.note}>{detail.notes[0].text}</p>
                          <small className={styles.muted}>
                            Added {date(detail.notes[0].at)}
                          </small>
                        </>
                      ) : (
                        <p className={styles.empty}>No internal notes yet.</p>
                      )}
                    </section>
                  </>
                )}
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
                {section === "conversations" && (
                  <section className={styles.card}>
                    <header>
                      <h3>Account conversations</h3>
                    </header>
                    {conversations()}
                  </section>
                )}
                {section === "documents" && (
                  <AccountDocuments
                    key={selected.id}
                    token={token}
                    accountId={selected.id}
                  />
                )}
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
                  <section className={styles.card}>
                    {selected.blocked && (
                      <p className="mt-3 rounded-xl bg-rose-500/10 p-3 text-xs text-rose-200">
                        Blocked · {selected.blockedReason}
                      </p>
                    )}
                    <label className="mt-5 block text-xs text-white/65">
                      Membership access level
                      <select
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
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="mt-2 text-[11px] leading-5 text-white/45">
                      Promote or demote access without starting or changing a
                      paid subscription. Grants do not issue monthly credit or
                      the paid security waiver. Standard removes membership
                      access; Automatic restores the subscription or existing
                      grant.
                    </p>
                    {selected.hasSubscription && (
                      <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[.04] p-3 text-xs leading-5 text-amber-100/80">
                        This account has a{" "}
                        {label(selected.subscriptionTier ?? "paid")} Stripe
                        subscription. Access changes and blocking do not cancel
                        its billing. Manage that subscription separately.
                      </p>
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
                        data-testid="admin-account-block"
                        disabled={busy || searchPending || !reason.trim()}
                        onClick={() =>
                          selected.blocked
                            ? apply("block")
                            : setConfirmBlock(true)
                        }
                        className="rounded-full border border-rose-300/25 px-5 py-2 text-xs text-rose-200 disabled:opacity-40"
                      >
                        {selected.blocked ? "Unblock account" : "Block account"}
                      </button>
                    </div>
                    {confirmBlock && (
                      <div className="mt-4 rounded-xl border border-rose-300/25 p-4 text-xs leading-5 text-white/65">
                        <p>
                          Block {selected.email}? They will be signed out and
                          cannot create new bookings. Existing rentals, balances
                          and owner refund controls are retained.
                        </p>
                        <div className="mt-3 flex gap-3">
                          <button
                            type="button"
                            data-testid="admin-account-confirm-block"
                            onClick={() => apply("block")}
                            disabled={busy}
                            className="text-rose-200"
                          >
                            Confirm block
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmBlock(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
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
                                {change.kind === "level"
                                  ? `${label(change.before)} → ${label(change.after)}`
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
