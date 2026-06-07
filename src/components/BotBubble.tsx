"use client";

import { useState, useRef, useEffect } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { useCart } from "@/components/cart/CartProvider";

type Card = any;
type Msg = { role: "user" | "assistant"; content: string; cards?: Card[] };
const GREETING =
  "Hi! I'm the Db Cinema assistant 🎬 Tell me what you're shooting and your dates, and I'll build you a kit — or ask about any gear, prices and availability.";

export function BotBubble() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, "added" | "declined">>({});
  const endRef = useRef<HTMLDivElement>(null);
  const account = useAccount();
  const cart = useCart();

  useEffect(() => {
    const raw = localStorage.getItem("dbc_bot");
    if (raw) try { setMsgs(JSON.parse(raw)); } catch {}
  }, []);
  useEffect(() => {
    if (msgs.length) localStorage.setItem("dbc_bot", JSON.stringify(msgs.slice(-24)));
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function send(override?: string) {
    const t = (override ?? text).trim();
    if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next);
    setText("");
    setBusy(true);
    try {
      const r = await fetch("/api/bot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          token: account.token ?? undefined,
          cart: cart.items.map((i) => ({ title: i.title, start: i.start, end: i.end, slug: i.slug })),
        }),
      });
      const d = await r.json();
      setMsgs((m) => [...m, { role: "assistant", content: d.reply || "…", cards: d.cards || [] }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Connection hiccup — please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  function addItem(it: any) {
    cart.add({
      listingId: it.listingId,
      slug: it.slug,
      title: it.title,
      heroImage: it.image ?? null,
      start: it.start,
      end: it.end,
      days: it.days,
      perDay: it.perDay,
      total: it.total,
      deposit: it.deposit ?? 0,
    });
  }
  function removeByListing(listingId: string) {
    const hit = cart.items.find((i) => i.listingId === listingId);
    if (hit) cart.remove(hit.key);
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close chat" : "Open chat"}
        className="press fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-accent-500 text-2xl text-white shadow-[0_10px_40px_-8px_rgba(56,189,248,0.6)] transition-transform hover:scale-105"
      >
        {open ? "✕" : "💬"}
      </button>

      {open && (
        <div className="toast-in fixed bottom-24 right-5 z-50 flex h-[72vh] max-h-[600px] w-[92vw] max-w-sm flex-col overflow-hidden rounded-3xl border border-white/10 bg-charcoal-900/95 shadow-2xl backdrop-blur-xl">
          <header className="flex items-center gap-3 border-b border-white/5 bg-white/[0.03] px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-500/20 text-lg">🎬</div>
            <div>
              <div className="text-sm font-semibold text-white/90">Db Cinema assistant</div>
              <div className="text-[11px] text-emerald-400">● builds your kit live</div>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.length === 0 && <Bubble role="assistant" text={GREETING} />}
            {msgs.map((m, mi) => (
              <div key={mi} className="space-y-2">
                <Bubble role={m.role} text={m.content} />
                {m.cards?.map((card: Card, ci: number) => {
                  const id = `${mi}:${ci}`;
                  return (
                    <CardView
                      key={ci}
                      card={card}
                      state={done[id]}
                      onAdd={() => {
                        if (card.kind === "swap") {
                          if (card.removed) removeByListing(card.removed.listingId);
                          addItem(card.added);
                        } else addItem(card.item);
                        setDone((d) => ({ ...d, [id]: "added" }));
                      }}
                      onDecline={() => setDone((d) => ({ ...d, [id]: "declined" }))}
                      onAlt={() => {
                        const t = card.kind === "swap" ? card.added?.title : card.item?.title;
                        send(`Can you suggest an alternative to ${t}?`);
                      }}
                    />
                  );
                })}
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl glass px-4 py-2 text-sm text-white/40">building…</div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-white/5 p-3">
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="e.g. a music video kit for 12–14 July"
                className="flex-1 rounded-full bg-white/[0.05] px-4 py-2.5 text-sm text-white/85 outline-none placeholder:text-white/30"
              />
              <button
                onClick={() => send()}
                disabled={busy || !text.trim()}
                className="press rounded-full bg-accent-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Bubble({ role, text }: { role: string; text: string }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          mine ? "bg-accent-500 text-white" : "glass text-white/80"
        }`}
      >
        {text}
      </div>
    </div>
  );
}

function Tile({ item, tone }: { item: any; tone: "green" | "red" | "plain" }) {
  const ring =
    tone === "green"
      ? "border-emerald-400/40 bg-emerald-500/[0.08]"
      : tone === "red"
        ? "border-red-400/30 bg-red-500/[0.06]"
        : "border-white/10 bg-white/[0.03]";
  return (
    <div className={`flex items-center gap-2 rounded-lg border p-1.5 ${ring}`}>
      {item?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image} alt="" className={`h-10 w-10 rounded object-cover ${tone === "red" ? "opacity-60" : ""}`} />
      ) : null}
      <div className="min-w-0">
        <div className={`truncate text-[11px] font-medium ${tone === "red" ? "text-white/45 line-through" : "text-white/85"}`}>
          {item?.title}
        </div>
        {tone !== "red" && item?.total != null && (
          <div className="text-[10px] text-white/45">£{item.total} · {item.days}d</div>
        )}
      </div>
    </div>
  );
}

function CardView({ card, state, onAdd, onDecline, onAlt }: any) {
  if (state === "declined") return null;
  const added = state === "added";
  const swap = card.kind === "swap";
  return (
    <div className="rounded-2xl border border-accent-400/20 bg-white/[0.03] p-3">
      {swap ? (
        <>
          <div className="mb-2 text-[11px] text-white/50">{card.reason}</div>
          <div className="flex items-center gap-2">
            {card.removed && <Tile item={card.removed} tone="red" />}
            <span className="text-white/30">→</span>
            <Tile item={card.added} tone="green" />
          </div>
        </>
      ) : (
        <div className="flex gap-3">
          {card.item.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.item.image} alt="" className="h-16 w-16 rounded-lg object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white/90">{card.item.title}</div>
            <div className="text-[11px] text-white/45">
              {card.item.start}→{card.item.end} · £{card.item.total} ({card.item.days}d)
            </div>
            <div className="mt-0.5 text-[11px] text-white/40">{card.reason}</div>
          </div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={onAdd}
          disabled={added}
          className="press rounded-full bg-accent-500 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent-600 disabled:bg-emerald-500/30 disabled:text-emerald-200"
        >
          {added ? "✓ Added to kit" : swap ? "Accept swap" : "Add to kit"}
        </button>
        {!added && (
          <>
            <button onClick={onAlt} className="rounded-full glass px-3 py-1.5 text-[11px] text-white/60 hover:text-white">
              Find alternative
            </button>
            <button onClick={onDecline} className="rounded-full px-3 py-1.5 text-[11px] text-white/35 hover:text-white/60">
              {swap ? "Keep original" : "Decline"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
