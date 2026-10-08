"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { AccountDocuments, AccountDocumentSummary } from "./AccountDocuments";
import { SmartImage } from "@/components/SmartImage";
import { formatGbp } from "@/lib/pricing";
import styles from "./AccountAdmin.module.css";

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

export function AccountAdmin({
  token,
  onRental,
  onConversation,
}: {
  token: string;
  onRental?: (id: string) => void;
  onConversation?: (accountId: string, bookingId: string | null) => void;
}) {
  const profileRef = useRef<HTMLElement>(null);
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
    authorized ? { token, search: email, filter, tier: tierFilter } : "skip",
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
  useEffect(() => setPage(0), [email, filter, tierFilter]);
  const pages = Math.max(1, Math.ceil(visible.length / 10));
  const currentPage = page;
  const displayRows = searchPending ? [] : visible.slice(page * 10, page * 10 + 10);
  const exhausted = status === "Exhausted";
  const loading = searchPending || status === "LoadingMore" || status === "CanLoadMore" && visible.length < (page + 1) * 10 + 1;
  useEffect(() => {
    if (authorized && input === email && status === "CanLoadMore" && visible.length < (page + 1) * 10 + 1)
      loadMore(100);
  }, [authorized, input, email, status, visible.length, page, loadMore]);
  useEffect(() => {
    if (exhausted && page >= pages) setPage(pages - 1);
  }, [exhausted, page, pages]);
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
          onClick={() =>
            selected && onConversation?.(selected.id, thread.bookingId)
          }
          disabled={!onConversation}
        >
          <span className={styles.initials}>
            {thread.lastSender === "owner"
              ? "DB"
              : (selected?.name || selected?.email || "")
                  .slice(0, 1)
                  .toUpperCase()}
          </span>
          <span>
            <strong>
              {thread.bookingId
                ? `Rental ${thread.bookingId.slice(-8)}`
                : "Account conversation"}
            </strong>
            <small>{thread.lastMessage}</small>
            <time>
              {date(thread.updatedAt)}
              {thread.unread ? ` · ${thread.unread} unread` : ""}
            </time>
          </span>
          <span aria-hidden>›</span>
        </button>
      ))
    );
  }
  return (
    <section data-testid="admin-accounts" className={styles.root}>
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
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Membership</th>
                <th>Verification</th>
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
                  <td>
                    <button
                      type="button"
                      data-testid="admin-account-row"
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
                          {(account.name || account.email)
                            .slice(0, 1)
                            .toUpperCase()}
                        </span>
                      )}
                      <span>
                        <strong>{account.name || "DB Cinema renter"}</strong>
                        <small>{account.email}</small>
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
                  <td>
                    <span className={styles.tier}>{label(account.tier)}</span>
                  </td>
                  <td>
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
            <span>
              Page {currentPage + 1}{exhausted ? ` / ${pages}` : ""}
            </span>
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
                {(selected.name || selected.email).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div>
              <h2>{selected.name || "DB Cinema renter"}</h2>
              <span
                className={selected.verified ? styles.verified : styles.pending}
              >
                {selected.verified ? "✓ Verified" : "Verification pending"}
              </span>
              <p>{selected.email}</p>
              {detail?.phone && <p>{detail.phone}</p>}
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
            <div>
              <span>Membership</span>
              <strong>{label(selected.tier)}</strong>
              <small>
                {selected.hasSubscription
                  ? "Paid subscription"
                  : selected.tier !== "standard"
                    ? "Granted access"
                    : "Standard account"}
              </small>
            </div>
            <div>
              <span>Available account credit</span>
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
