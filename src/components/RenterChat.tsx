"use client";
import { useEffect, useRef, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "./account/AccountProvider";
import { RentalJourney } from "./rentals/RentalJourney";
import { RentalKit } from "./rentals/RentalKit";
import chatStyles from "@/components/rentals/RentalConversation.module.css";
import { RentalConversation } from "./rentals/RentalConversation";
import { rentalStageLabel } from "../../shared/rentalReadiness";
import { RenterRentalTools } from "./rentals/RenterRentalTools";
import { SmartImage } from "./SmartImage";
import {
  rentalTitle,
  rentalDate,
  RENTAL_STAGE_LABELS,
} from "@/lib/rentalPresentation";
import type { EnrichedBooking } from "@/lib/bookingDisplay";
export function RenterChat({
  bookings,
  focusBookingId,
}: {
  bookings?: EnrichedBooking[];
  focusBookingId?: string | null;
}) {
  const { token } = useAccount();
  const {
    results: rows,
    status,
    loadMore,
  } = usePaginatedQuery(api.rentalChat.minePage, token ? { token } : "skip", {
    initialNumItems: 30,
  });
  const [selected, setSelected] = useState<string | null>(
    focusBookingId ?? null,
  );
  useEffect(() => {
    if (focusBookingId) setSelected(focusBookingId);
  }, [focusBookingId]);
  const direct = useQuery(
    api.rentalChat.getConversation,
    token && selected && selected !== "general"
      ? { token, bookingId: selected as any }
      : "skip",
  );
  const unread = useQuery(
    api.rentalChat.unreadBreakdown,
    token ? { token } : "skip",
  );
  const sidebar = useRef<HTMLElement>(null);
  const focus =
    selected === "general"
      ? null
      : selected
        ? (rows.find((r) => r._id === selected) ?? direct)
        : (rows.find((r) => r.status === "active") ??
          rows.find((r) => r.status === "confirmed") ??
          rows[0]);
  useEffect(() => {
    const scroll = () => {
      const button = sidebar.current?.querySelector<HTMLElement>(
        '[aria-current="true"]',
      );
      const panel = sidebar.current;
      if (button && panel && window.innerWidth < 1024)
        panel.scrollTo({
          left:
            panel.scrollLeft +
            button.getBoundingClientRect().left -
            panel.getBoundingClientRect().left,
          behavior: "smooth",
        });
    };
    scroll();
    const observer = new ResizeObserver(scroll);
    if (sidebar.current) observer.observe(sidebar.current);
    return () => observer.disconnect();
  }, [focus?._id, selected]);
  if (!token) return null;
  if (
    status === "LoadingFirstPage" ||
    (selected &&
      selected !== "general" &&
      direct === undefined &&
      !rows.some((r) => r._id === selected))
  )
    return <p className="text-sm text-white/40">Loading your conversations…</p>;
  return (
    <div className={chatStyles.inbox}>
      <aside ref={sidebar} className={`${chatStyles.directory} ${chatStyles.renterDirectory} flex gap-2 overflow-x-auto lg:flex-col`}>
        <h2 className="hidden px-2 pb-2 text-xs uppercase tracking-[.2em] text-white/35 lg:block">
          Conversations
        </h2>
        <button
          aria-current={selected === "general"}
          onClick={() => setSelected("general")}
          className={`min-w-[230px] rounded-2xl border p-4 text-left text-sm ${!focus ? "border-accent-400/25 bg-accent-500/[0.07] text-white" : "border-white/[0.05] text-white/60"}`}
        >
          General support
          {(unread?.general ?? 0) > 0 && (
            <span className="ml-2 rounded-full bg-accent-500 px-2 py-0.5 text-[10px] text-white">
              {unread!.general}
            </span>
          )}
          <span className="mt-1 block text-xs text-white/35">
            Account help &amp; call follow-ups
          </span>
        </button>
        {rows?.map((r) => (
          <button
            key={r._id}
            aria-current={focus?._id === r._id}
            onClick={() => setSelected(r._id)}
            className={`flex min-w-[230px] items-center gap-3 rounded-2xl p-3 text-left transition lg:min-w-0 ${focus?._id === r._id ? "border border-accent-400/25 bg-accent-500/[0.07]" : "border border-white/[0.05] hover:bg-white/[0.03]"}`}
          >
            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]">
              <SmartImage
                src={r.items[0]?.heroImage}
                fallbackSources={r.items[0]?.imageSources}
                alt=""
                className="h-full w-full"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-white/85">
                {rentalTitle(r.items[0]?.title ?? "Rental")}
              </p>
              <p className="mt-1 text-[10px] text-white/40">
                {RENTAL_STAGE_LABELS[r.status]} · {rentalDate(r.start, r.end)}
              </p>
            </div>
            {r.unreadRenter > 0 && (
              <span className="rounded-full bg-accent-500 px-2 py-0.5 text-[10px] text-white">
                {r.unreadRenter}
              </span>
            )}
          </button>
        ))}
        {status === "CanLoadMore" && (
          <button
            onClick={() => loadMore(30)}
            className="rounded-2xl border border-white/10 p-3 text-xs text-white/50"
          >
            Older rental conversations
          </button>
        )}
      </aside>
      <RentalConversation
        key={focus?._id ?? "general"}
        token={token}
        bookingId={focus?._id}
        title={
          focus
            ? rentalTitle(focus.items[0]?.title ?? "Rental")
            : "General support"
        }
        stage={focus?.status ?? "Support"}
        stageLabel={focus ? rentalStageLabel(focus) : "Support"}
        bookingSummary={focus ? {image: focus.items[0]?.heroImage, imageSources: focus.items[0]?.imageSources, dates: rentalDate(focus.start, focus.end), count: focus.items.length} : undefined}
        escalated={focus?.escalated}
        tools={focus ? <><RentalJourney booking={focus} /><RenterRentalTools token={token} bookingId={focus._id} /><details className="mt-3"><summary className="cursor-pointer text-xs text-white/55">Your kit · {focus.items.length} listings</summary><div className="mt-3"><RentalKit items={focus.items} compact /></div></details></> : undefined}
      />
    </div>
  );
}
