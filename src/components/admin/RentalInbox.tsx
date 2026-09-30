"use client";
import { RentalOrderTools } from "./RentalOrderTools";
import { useEffect, useRef, useState } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { RentalConversation } from "@/components/rentals/RentalConversation";
import { SmartImage } from "@/components/SmartImage";
import {
  rentalTitle,
  rentalDate,
  RENTAL_STAGES,
  RENTAL_STAGE_LABELS,
} from "@/lib/rentalPresentation";
export function RentalInbox({
  token,
  focusBookingId,
}: {
  token: string;
  focusBookingId?: string | null;
}) {
  const [stage, setStage] = useState("all"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(focusBookingId ?? null);
  const rentals = usePaginatedQuery(
    api.rentalChat.adminPage,
    stage === "general"
      ? "skip"
      : { token, stage: stage === "all" ? undefined : stage },
    { initialNumItems: 50 },
  );
  const support = usePaginatedQuery(
    api.rentalChat.generalOwnerPage,
    stage === "general" ? { token } : "skip",
    { initialNumItems: 50 },
  );
  const {
    results: rows,
    status,
    loadMore,
  } = stage === "general" ? support : rentals;
  const unread =
    useQuery(api.rentalChat.unreadTotals, { token, admin: true }) ?? 0;
  const counts = useQuery(api.rentalChat.unreadBreakdown, {
    token,
    admin: true,
  });
  const [ping, setPing] = useState(false);
  const previous = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    setPing(localStorage.getItem("dbc_chat_pings") === "true");
  }, []);
  useEffect(() => {
    if (focusBookingId) {
      setSelected(focusBookingId);
      setStage("all");
    }
  }, [focusBookingId]);
  useEffect(() => {
    if (!ping) return;
    const unlock = () => {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [ping]);

  useEffect(() => {
    if (
      previous.current !== null &&
      unread > previous.current &&
      ping &&
      audio.current
    ) {
      const oscillator = audio.current.createOscillator(),
        gain = audio.current.createGain();
      oscillator.connect(gain);
      gain.connect(audio.current.destination);
      oscillator.frequency.value = 720;
      gain.gain.setValueAtTime(0.06, audio.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audio.current.currentTime + 0.2,
      );
      oscillator.start();
      oscillator.stop(audio.current.currentTime + 0.2);
    }
    previous.current = unread;
  }, [unread, ping]);
  const direct = useQuery(
    api.rentalChat.getConversation,
    selected && stage !== "general"
      ? { token, bookingId: selected as any, admin: true }
      : "skip",
  );
  const visible = rows
    .filter(
      (r) =>
        (stage === "all" ||
          stage === "general" ||
          (stage === "unread" && r.unreadOwner > 0) ||
          r.status === stage) &&
        (!search ||
          `${r.guestEmail} ${r.name} ${r.items.map((li: any) => li.title).join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    )
    .sort(
      (a, b) =>
        Number(b.unreadOwner > 0) - Number(a.unreadOwner > 0) ||
        b.updatedAt - a.updatedAt,
    );
  const focus = selected
    ? (rows.find((r) => r._id === selected) ?? direct)
    : visible[0];
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">
            Rental inbox
          </h2>
          <p className="mt-1 text-xs text-white/40">
            {unread ? `${unread} unread messages` : "You're up to date"}
          </p>
        </div>
        <button
          onClick={() => {
            const enabled = !ping;
            setPing(enabled);
            localStorage.setItem("dbc_chat_pings", String(enabled));
            if (enabled) {
              audio.current ??= new AudioContext();
              void audio.current.resume();
            }
          }}
          className={`rounded-full border px-3 py-2 text-xs ${ping ? "border-accent-400/30 text-accent-300" : "border-white/10 text-white/45"}`}
        >
          {ping ? "Pings on" : "Enable pings"}
        </button>
      </div>
      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {[
          ["all", "All rentals"],
          ["unread", "Unread rentals"],
          ["general", "General support"],
          ...RENTAL_STAGES.map((s) => [s, RENTAL_STAGE_LABELS[s]]),
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setStage(key);
              setSelected(null);
            }}
            className={`whitespace-nowrap rounded-full px-3 py-2 text-xs ${stage === key ? "bg-white text-black" : "bg-white/[0.04] text-white/45 hover:text-white"}`}
          >
            {label}
            {((key === "unread"
              ? counts?.rentals
              : key === "general"
                ? counts?.general
                : 0) ?? 0) > 0 && (
              <span className="ml-2 opacity-60">
                {key === "unread" ? counts?.rentals : counts?.general}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[310px_1fr]">
        <aside className={`min-w-0 ${selected ? "hidden lg:block" : ""}`}>
          <input
            aria-label="Search rental conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search loaded conversations"
            className="mb-3 w-full rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-sm text-white outline-none"
          />
          <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto">
            {visible.map((r) => (
              <button
                key={r._id}
                onClick={() => setSelected(r._id)}
                className={`rounded-2xl border p-3 text-left ${focus?._id === r._id ? "border-accent-400/25 bg-accent-500/[0.06]" : "border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04]"}`}
              >
                <div className="flex gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]">
                    <SmartImage
                      src={r.items[0]?.heroImage}
                      alt=""
                      className="h-full w-full"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white/85">
                      {r.name || r.guestEmail || "Guest renter"}
                    </p>
                    <p className="mt-1 truncate text-xs text-white/45">
                      {rentalTitle(r.items[0]?.title ?? "General support")}
                    </p>
                  </div>
                  {r.unreadOwner > 0 && (
                    <span className="h-fit rounded-full bg-accent-500 px-2 py-0.5 text-[10px] text-white">
                      {r.unreadOwner}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-white/35">
                  <span>{RENTAL_STAGE_LABELS[r.status] ?? "Support"}</span>
                  <span>
                    {r.start ? rentalDate(r.start, r.end) : "Account support"}
                  </span>
                </div>
                <p className="mt-2 truncate text-xs text-white/40">
                  {r.lastMessage ??
                    (r.accountId
                      ? "Conversation ready"
                      : "Renter account not created yet")}
                </p>
              </button>
            ))}
            {status === "CanLoadMore" && (
              <button
                onClick={() => loadMore(50)}
                className="rounded-full border border-white/10 p-3 text-xs text-white/50"
              >
                Load older rentals
              </button>
            )}
            {!visible.length && status !== "LoadingFirstPage" && (
              <p className="p-6 text-center text-sm text-white/30">
                No conversations in this stage.
              </p>
            )}
          </div>
        </aside>
        {focus ? (
          <div className={selected ? "min-w-0" : "hidden min-w-0 lg:block"}>
            <button
              onClick={() => setSelected(null)}
              className="mb-3 text-xs text-white/65 lg:hidden"
            >
              ← All rental conversations
            </button>
            <RentalConversation
              key={focus._id}
              token={token}
              admin
              bookingId={focus.status === "support" ? undefined : focus._id}
              accountId={focus.accountId ?? undefined}
              title={rentalTitle(focus.items[0]?.title ?? "General support")}
              stage={focus.status}
              escalated={focus.escalated}
              tools={
                focus.status !== "support" ? (
                  <RentalOrderTools
                    key={focus._id}
                    token={token}
                    bookingId={focus._id}
                  />
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="flex min-h-[450px] items-center justify-center rounded-3xl border border-white/[0.06] text-sm text-white/30">
            Choose a rental to start.
          </div>
        )}
      </div>
    </section>
  );
}
