"use client";
import { useEffect } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalCalendar } from "@/components/account/RentalCalendar";

export function AdminRentalCalendar({ token }: { token: string }) {
  const pages = usePaginatedQuery(api.bookings.adminCalendarPage, { token }, { initialNumItems: 50 });
  useEffect(() => { if (pages.status === "CanLoadMore") pages.loadMore(50); }, [pages.status, pages.loadMore]);
  const complete = pages.status === "Exhausted";
  return <div className="mt-6 max-w-3xl">
    <p className="mb-4 text-xs text-white/45" role="status">{complete ? `${pages.results.length} rental records checked` : `Checking rental history · ${pages.results.length} records loaded…`} · collection and return times shown in London time.</p>
    <RentalCalendar bookings={pages.results} loading={!complete} />
  </div>;
}
