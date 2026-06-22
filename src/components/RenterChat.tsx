"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";

const HOUR = 60 * 60 * 1000;

export function RenterChat() {
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
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.length]);

  if (!token) return null;

  async function submit() {
    const t = text.trim();
    if (!t) return;
    setText("");
    await send({ token, text: t });
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

  return (
    <section className="mt-8 rounded-2xl glass gradient-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-semibold text-white/80">Chat with Gaffer</h2>
          <p className="mt-1 text-xs text-white/40">Your rental assistant — pickup, returns, gear &amp; questions. Ask for a human any time.</p>
        </div>
        <button
          onClick={human}
          disabled={humanBusy}
          className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-medium text-white/60 hover:text-white disabled:opacity-50"
        >
          {humanBusy ? "…" : "Talk to a human"}
        </button>
      </div>

      <div className="mt-4 flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
        {thread === undefined && <div className="text-sm text-white/30">Loading…</div>}
        {thread && thread.length === 0 && (
          <div className="text-sm text-white/30">
            No messages yet. Say hi, or ask anything about your booking.
          </div>
        )}
        {thread?.map((m: any) => {
          const mine = m.sender === "renter";
          const upsell = m.meta?.kind === "upsell";
          const paylink = m.meta?.kind === "paylink";
          return (
            <div key={m._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                  mine
                    ? "bg-accent-500 text-white"
                    : m.sender === "system"
                      ? "border border-white/5 bg-white/[0.03] text-white/70"
                      : "glass text-white/80"
                }`}
              >
                <div className="whitespace-pre-wrap">{m.text}</div>
                {upsell && (
                  <UpsellCards
                    meta={m.meta}
                    busy={busy}
                    onAdd={addAddon}
                  />
                )}
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
        <div ref={endRef} />
      </div>

      {err && <div className="mt-2 text-xs text-red-300">{err}</div>}

      <div className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Type a message…"
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
      {closed && (
        <div className="text-[11px] text-white/30">Add-ons close 1 hour before your rental start.</div>
      )}
    </div>
  );
}
