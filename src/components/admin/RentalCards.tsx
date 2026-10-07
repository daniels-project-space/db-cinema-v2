"use client";
import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalKit } from "@/components/rentals/RentalKit";
import {
  rentalDate,
  RENTAL_STAGES,
  RENTAL_STAGE_LABELS,
} from "@/lib/rentalPresentation";
import { formatGbp } from "@/lib/pricing";
export function AdminRentalCards({
  token,
  onChat,
  onDetails,
}: {
  token: string;
  onChat: (id: string) => void;
  onDetails: (id: string) => void;
}) {
  const [stage, setStage] = useState("all"),
    [search, setSearch] = useState("");
  const { results, status, loadMore } = usePaginatedQuery(
    api.rentalChat.adminPage,
    { token, stage: stage === "all" ? undefined : stage },
    { initialNumItems: 50 },
  );
  const rows = results.filter(
    (r) =>
      (stage === "all" || r.status === stage) &&
      `${r.guestEmail} ${r.name} ${r.items.map((li: any) => li.title).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">
            Rentals
          </h2>
          <p className="mt-1 text-xs text-white/35">
            {rows.length} rentals shown
          </p>
        </div>
        <input
          aria-label="Search rentals"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search loaded rentals"
          className="rounded-full border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm text-white outline-none"
        />
      </div>
      <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
        {[
          ["all", "All"],
          ...RENTAL_STAGES.map((s) => [s, RENTAL_STAGE_LABELS[s]]),
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setStage(key)}
            className={`whitespace-nowrap rounded-full px-3 py-2 text-xs ${stage === key ? "bg-white text-black" : "bg-white/[0.04] text-white/45"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <article
            key={r._id}
            className="management-rental-card overflow-hidden rounded-3xl border border-white/[0.07] bg-[#151515]"
          >
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-semibold text-white/90">{r.name || r.guestEmail}</p>
                  <p className="mt-1 text-xs text-white/45">{rentalDate(r.start, r.end)}</p>
                </div>
                <span className="shrink-0 rounded-full bg-white/[0.05] px-2.5 py-1 text-[10px] text-white/65">{RENTAL_STAGE_LABELS[r.status]}</span>
              </div>
              <div className="mt-4"><RentalKit items={r.items} /></div>
              <div className="mt-3 flex items-baseline justify-between text-xs text-white/35"><span>Rental total</span><span className="text-sm font-semibold text-white/85">{formatGbp(r.total)}</span></div>
              <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
                <button
                  onClick={() => onChat(r._id)}
                  className="flex items-center gap-2 text-xs font-medium text-accent-300"
                >
                  Conversation{" "}
                  {r.unreadOwner > 0 && (
                    <span className="rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] text-white">
                      {r.unreadOwner}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => onDetails(r._id)}
                  className="text-xs text-white/45 hover:text-white"
                >
                  Manage →
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {status === "CanLoadMore" && (
        <button
          onClick={() => loadMore(50)}
          className="mt-5 rounded-full border border-white/10 px-4 py-2 text-xs text-white/60"
        >
          Load older rentals
        </button>
      )}
      {!rows.length && status !== "LoadingFirstPage" && (
        <p className="py-12 text-center text-sm text-white/30">
          No rentals in this stage.
        </p>
      )}
    </section>
  );
}
