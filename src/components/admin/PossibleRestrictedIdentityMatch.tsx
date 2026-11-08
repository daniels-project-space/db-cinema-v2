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
      aria-label="Possible restricted-account match"
      className="overflow-hidden rounded-2xl border border-amber-200/20 bg-[linear-gradient(135deg,rgba(103,74,37,0.24),rgba(22,20,18,0.92))] p-4 text-sm shadow-[0_14px_36px_rgba(0,0,0,0.2)]"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/20 bg-amber-200/[0.08] text-base text-amber-100">⌕</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-amber-50">Possible restricted-account match</h3>
            <span className="rounded-full border border-amber-200/20 bg-amber-100/[0.07] px-2 py-0.5 text-[10px] font-medium text-amber-100/80">Review</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-50/65">Approved Didit name and date of birth match. This is a lead, not proof; no booking was blocked.</p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {result.matches.map((match: RestrictedAccountMatch) => (
          <article key={match.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white/90">{match.name || "Restricted account"}</p>
              <p className="mt-0.5 break-all text-[11px] text-white/55">{match.email}</p>
              {match.blockedReason && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/45">Reason: {match.blockedReason}</p>}
            </div>
            <button
              type="button"
              data-testid="open-matched-account-chat"
              aria-label={`Open account chat for ${match.name || match.email}`}
              onClick={() => onOpenAccount(match.id)}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-amber-100/25 bg-amber-100/[0.09] px-3 text-xs font-medium text-amber-50 transition-colors hover:bg-amber-100/[0.16] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-100"
            >
              Compare account
            </button>
          </article>
        ))}
      </div>
      {result.more && <p className="mt-2 text-[11px] text-white/45">More matching accounts · review in Customers.</p>}
    </section>
  );
}
