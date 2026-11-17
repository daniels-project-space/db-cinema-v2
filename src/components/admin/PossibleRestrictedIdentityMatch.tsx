"use client";

import { useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import type { Id } from "@cvx/_generated/dataModel";

type RestrictedAccountMatch = {
  id: string;
  name: string;
  email: string;
  blockedReason: string;
};

export function PossibleRestrictedIdentityMatch({
  token,
  bookingId,
  onOpenAccount,
}: {
  token: string;
  bookingId: Id<"bookings">;
  onOpenAccount: (accountId: string) => void;
}) {
  const result = useQuery(api.accountAdmin.possibleRestrictedIdentityMatches, {
    token,
    bookingId,
  });

  if (!result?.matches.length) return null;

  return (
    <section
      data-testid="possible-restricted-identity-match"
      aria-label="Possible identity match"
      className="overflow-hidden rounded-2xl border border-amber-200/20 bg-[linear-gradient(135deg,rgba(103,74,37,0.24),rgba(22,20,18,0.92))] p-3 text-sm shadow-[0_14px_36px_rgba(0,0,0,0.2)]"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-amber-200/20 bg-amber-200/[0.08] text-amber-100">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3 2.5-4.7 5.5-4.7 1.3 0 2.5.3 3.4 1"/><path d="M16 10h5m-2.5-2.5v5"/></svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 flex-1 text-xs font-semibold text-amber-50">Possible identity match</h3>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-amber-50/65">Didit name + birth date match. Team reviews; no auto-block.</p>
        </div>
      </div>
      <div className="mt-2 grid gap-1.5">
        {result.matches.map((match: RestrictedAccountMatch) => (
          <article key={match.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white/90" title={match.name || "Restricted account"}>{match.name || "Restricted account"}</p>
              <p className="truncate text-[10px] text-white/55" title={match.email}>{match.email}</p>
              {match.blockedReason && <p className="mt-0.5 truncate text-[10px] leading-4 text-white/45" title={`Reason: ${match.blockedReason}`}>Reason: {match.blockedReason}</p>}
            </div>
            <button
              type="button"
              data-testid="open-matched-account-chat"
              aria-label={`Open account chat for ${match.name || match.email}`}
              onClick={() => onOpenAccount(match.id)}
              className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-xl border border-amber-100/25 bg-amber-100/[0.09] px-2.5 text-[11px] font-medium text-amber-50 transition-colors hover:bg-amber-100/[0.16] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100"
            >
              Compare account
            </button>
          </article>
        ))}
      </div>
      {result.more && <p className="mt-1.5 text-[10px] text-white/45">More matches · review in Customers.</p>}
    </section>
  );
}

type AccountIdentityMatch = {
  id: string;
  name: string;
  email: string;
  blockedReason: string;
  bookings: Array<{ id: string; title: string; status: string; start: number | null }>;
};

function rentalContext(booking: AccountIdentityMatch["bookings"][number]) {
  const when = booking.start == null
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(booking.start);
  return `${booking.title} · ${when}`;
}

function fullRentalContext(booking: AccountIdentityMatch["bookings"][number]) {
  return `${rentalContext(booking)} · ${booking.status.replaceAll("_", " ")}`;
}

/** One account query replaces the former per-booking rail query. */
export function PossibleRestrictedIdentityAccountMatches({
  token,
  accountId,
  onOpenAccount,
}: {
  token: string;
  accountId: Id<"accounts">;
  onOpenAccount: (accountId: string) => void;
}) {
  const result = useQuery(api.accountAdmin.possibleRestrictedIdentityMatchesForAccount, { token, accountId });
  if (!result || (!result.matches.length && !result.more)) return null;

  const matches = result.matches as AccountIdentityMatch[];
  const rentalCount = matches.reduce((total, match) => total + match.bookings.length, 0);
  const hasMatch = matches.length > 0;
  return (
    <section
      data-testid="possible-restricted-identity-match"
      aria-label="Possible restricted identity match"
      role="status"
      className="overflow-hidden rounded-2xl border border-amber-200/20 bg-[linear-gradient(135deg,rgba(103,74,37,0.24),rgba(22,20,18,0.92))] p-3 text-sm shadow-[0_14px_36px_rgba(0,0,0,0.2)]"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-amber-200/20 bg-amber-200/[0.08] text-amber-100">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3 2.5-4.7 5.5-4.7 1.3 0 2.5.3 3.4 1"/><path d="M16 10h5m-2.5-2.5v5"/></svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h3 className="min-w-0 flex-1 text-xs font-semibold text-amber-50">{hasMatch ? "Possible identity match" : "Identity scan incomplete"}</h3>
            <span className="shrink-0 rounded-full border border-amber-200/20 px-2 py-0.5 text-[10px] text-amber-100/80">{hasMatch ? `${rentalCount} rental${rentalCount === 1 ? "" : "s"}` : "More to check"}</span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-amber-50/65">{hasMatch ? "Verified name + date-of-birth match. Compare manually; no auto-block." : "More verified rentals remain beyond the 25-rental check. No match is confirmed."}</p>
        </div>
      </div>
      <div className="mt-2 grid gap-1.5">
        {matches.slice(0, 3).map(match => (
          <article key={match.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white/90" title={match.name || "Restricted account"}>{match.name || "Restricted account"}</p>
              <p className="truncate text-[10px] text-white/55" title={match.email}>{match.email}</p>
              {match.blockedReason && <p className="truncate text-[10px] leading-4 text-white/45" title={`Reason: ${match.blockedReason}`}>Reason: {match.blockedReason}</p>}
              {match.bookings.slice(0, 2).map(booking => <p key={booking.id} className="truncate text-[10px] leading-4 text-amber-50/75" title={fullRentalContext(booking)}>{rentalContext(booking)}</p>)}
              {match.bookings.length > 2 && <p className="text-[10px] leading-4 text-white/45">+{match.bookings.length - 2} more rentals</p>}
            </div>
            <button
              type="button"
              data-testid="open-matched-account-chat"
              aria-label={`Compare restricted account ${match.name || match.email}`}
              onClick={() => onOpenAccount(match.id)}
              className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-xl border border-amber-100/25 bg-amber-100/[0.09] px-2.5 text-[11px] font-medium text-amber-50 transition-colors hover:bg-amber-100/[0.16] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100"
            >
              Compare
            </button>
          </article>
        ))}
      </div>
      {hasMatch && (matches.length > 3 || result.more) && <p className="mt-1.5 text-[10px] text-white/45">Some matches or rentals are beyond this 25-rental check. Review rental history.</p>}
    </section>
  );
}
