"use client";

import { useMemo } from "react";
import Link from "next/link";
import { BookingTile } from "@/components/account/BookingTile";
import {
  type EnrichedBooking,
  type BookingGroup,
  GROUP_ORDER,
  GROUP_META,
  groupOf,
} from "@/lib/bookingDisplay";

export function BookingSections({
  bookings,
  token,
  onOpenChat,
}: {
  bookings: EnrichedBooking[] | null | undefined;
  token: string;
  onOpenChat?: () => void;
}) {
  const grouped = useMemo(() => {
    const g: Record<BookingGroup, EnrichedBooking[]> = { pending: [], active: [], upcoming: [], past: [] };
    for (const b of bookings ?? []) g[groupOf(b)].push(b);
    g.pending.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    g.active.sort((a, b) => (a.end ?? 0) - (b.end ?? 0));
    g.upcoming.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    g.past.sort((a, b) => (b.start ?? b.at) - (a.start ?? a.at));
    return g;
  }, [bookings]);

  if (bookings === undefined) return <div className="text-sm text-white/30">Loading…</div>;

  if ((bookings ?? []).length === 0)
    return (
      <div className="spot rounded-2xl p-8 text-center">
        <p className="text-sm text-white/50">No rentals yet.</p>
        <Link href="/gear" className="btn-primary mt-4 inline-block px-5 py-2 text-sm">
          Browse gear →
        </Link>
      </div>
    );

  return (
    <div className="flex flex-col gap-8">
      {GROUP_ORDER.map((key) => {
        const list = grouped[key];
        if (!list.length) return null;
        const meta = GROUP_META[key];
        return (
          <div key={key}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-white/70">{meta.label}</h3>
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/45">{list.length}</span>
              <span className="text-xs text-white/30">{meta.blurb}</span>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {list.map((b) => (
                <BookingTile key={b._id} booking={b} token={token} onOpenChat={onOpenChat} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
