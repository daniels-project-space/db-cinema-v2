"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { SmartImage } from "@/components/SmartImage";
import { StatusPill } from "@/components/account/StatusPill";
import { type EnrichedBooking, fmtRange } from "@/lib/bookingDisplay";

const HOUR = 60 * 60 * 1000;
const CHATTABLE = ["pending_payment", "confirmed", "active"];

function GafferMark({ size = "h-8 w-8 text-sm" }: { size?: string }) {
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-400 to-accent-600 font-display font-bold text-white shadow-[0_2px_10px_rgba(224,153,47,0.35)]`}>
      G
    </span>
  );
}

export function RenterChat({
  bookings,
  focusBookingId,
}: {
  bookings?: EnrichedBooking[];
  focusBookingId?: string | null;
}) {
  const account = useAccount();
  const token = account.token ?? "";
  const thread = useQuery(api.chat.myThread, token ? { token } : "skip");
  const send = useMutation(api.chat.send);
  const startAddon = useAction(api.checkout.startAddon);
  const requestHuman = useMutation(api.chat.requestHuman);
  const [text, setText] = useState("");
  const [humanBusy, setHumanBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(focusBookingId ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chattable = (bookings ?? []).filter((b) => CHATTABLE.includes(b.status));
  const focus =
    chattable.find((b) => b._id === focusId) ??
    chattable.find((b) => b.status === "active") ??
    chattable.find((b) => b.status === "confirmed") ??
    chattable[0] ??
    null;

  useEffect(() => {
    if (focusBookingId) setFocusId(focusBookingId);
  }, [focusBookingId]);

  // auto-scroll the MESSAGES container only — never the page (fixes the page-jump on send)
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.length, waiting]);

  // stop the "typing…" indicator once any non-renter reply arrives
  useEffect(() => {
    if (!thread || thread.length === 0) return;
    if (thread[thread.length - 1]?.sender !== "renter") setWaiting(false);
  }, [thread]);

  if (!token) return null;

  async function submit() {
    const t = text.trim();
    if (!t) return;
    setText("");
    setWaiting(true);
    window.setTimeout(() => setWaiting(false), 15000); // safety: clear if no reply
    await send({ token, text: t, bookingId: (focus?._id as any) ?? undefined });
  }
  async function human() {
    setHumanBusy(true);
    try {
      await requestHuman({ token });
    } catch {
      /* ignore */
    } finally {
      setHumanBusy(false);
    }
  }
  async function addAddon(o: any, meta: any) {
    setErr(null);
    setBusy(o.listingId);
    try {
      const { url } = await startAddon({
        token,
        bookingId: meta.bookingId,
        listingId: o.listingId,
        title: o.title,
        start: meta.start,
        end: meta.end,
        total: o.total,
        origin: window.location.origin,
      });
      window.location.href = url;
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't add that");
      setBusy(null);
    }
  }

  const focusFirst = focus?.lineItems[0];
  const focusExtra = focus ? focus.lineItems.length - 1 : 0;

  return (
    <section className="rounded-2xl glass gradient-border p-5">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <GafferMark />
          <div>
            <h2 className="font-display font-semibold text-white/85">Chat with Gaffer</h2>
            <p className="mt-0.5 text-xs text-white/40">Your rental assistant — ask for a human any time.</p>
          </div>
        </div>
        <button
          onClick={human}
          disabled={humanBusy}
          className="press shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-medium text-white/60 hover:text-white disabled:opacity-50"
        >
          {humanBusy ? "…" : "Talk to a human"}
        </button>
      </div>

      {/* rental-context banner — what this chat is about */}
      {focus && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg">
            <SmartImage src={focusFirst?.heroImage ?? null} alt="" className="h-full w-full" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-white/35">Chatting about</div>
            <div className="truncate text-sm font-medium text-white/85">
              {focusFirst?.title ?? "Your rental"}
              {focusExtra > 0 && <span className="font-normal text-white/40"> +{focusExtra}</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/45">
              {focus.start != null && focus.end != null && <span>{fmtRange(focus.start, focus.end)}</span>}
              <StatusPill status={focus.status} />
            </div>
          </div>
          {chattable.length > 1 && (
            <select
              value={focus._id}
              onChange={(e) => setFocusId(e.target.value)}
              className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-white/70 outline-none"
              aria-label="Choose which rental to chat about"
            >
              {chattable.map((b) => (
                <option key={b._id} value={b._id} className="bg-charcoal-800">
                  {b.lineItems[0]?.title?.slice(0, 28) ?? "Rental"}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* messages */}
      <div ref={scrollRef} className="mt-4 flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
        {thread === undefined && <div className="text-sm text-white/30">Loading…</div>}
        {thread && thread.length === 0 && (
          <div className="text-sm text-white/30">No messages yet. Say hi, or ask anything about your rental.</div>
        )}
        {thread?.map((m: any) => {
          const mine = m.sender === "renter";
          const isBot = m.sender === "bot";
          const upsell = m.meta?.kind === "upsell";
          const paylink = m.meta?.kind === "paylink";
          return (
            <div key={m._id} className={`msg-in flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
              {isBot && <GafferMark size="h-6 w-6 text-[11px]" />}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                  mine
                    ? "bg-accent-500 text-white"
                    : m.sender === "system"
                      ? "border border-white/5 bg-white/[0.03] text-white/70"
                      : "glass text-white/80"
                }`}
              >
                <div className="whitespace-pre-wrap">{m.text}</div>
                {upsell && <UpsellCards meta={m.meta} busy={busy} onAdd={addAddon} />}
                {paylink && (
                  <a
                    href={m.meta.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="press mt-2 inline-block rounded-full bg-accent-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-600"
                  >
                    Pay £{m.meta.amount} →
                  </a>
                )}
              </div>
            </div>
          );
        })}
        {waiting && (
          <div className="msg-in flex items-end gap-2">
            <GafferMark size="h-6 w-6 text-[11px]" />
            <div className="glass flex items-center gap-1 rounded-2xl px-4 py-3 text-white/50">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
      </div>

      {err && <div className="mt-2 text-xs text-red-300">{err}</div>}

      <div className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={focus ? `Ask about your ${focusFirst?.title?.split(" ").slice(0, 2).join(" ") ?? "rental"}…` : "Type a message…"}
          className="flex-1 rounded-full bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30"
        />
        <button
          onClick={submit}
          className="press rounded-full bg-accent-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-600"
        >
          Send
        </button>
      </div>
    </section>
  );
}

function UpsellCards({
  meta,
  busy,
  onAdd,
}: {
  meta: any;
  busy: string | null;
  onAdd: (o: any, meta: any) => void;
}) {
  const closed = Date.now() > meta.start - HOUR; // 1h cutoff
  return (
    <div className="mt-3 flex flex-col gap-2">
      {meta.offers.map((o: any) => (
        <div key={o.listingId} className="flex items-center gap-3 rounded-xl bg-black/20 p-2">
          {o.heroImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={o.heroImage} alt="" className="h-12 w-12 rounded-lg object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-white/85">{o.title}</div>
            <div className="text-[11px] text-white/45">
              {o.reason} · <span className="text-emerald-300">−{o.pct}%</span> £{o.total}
            </div>
          </div>
          <button
            disabled={closed || busy === o.listingId}
            onClick={() => onAdd(o, meta)}
            className="press shrink-0 rounded-full bg-accent-500 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent-600 disabled:opacity-40"
          >
            {closed ? "Closed" : busy === o.listingId ? "…" : "Add"}
          </button>
        </div>
      ))}
      {closed && <div className="text-[11px] text-white/30">Add-ons close 1 hour before your rental start.</div>}
    </div>
  );
}
