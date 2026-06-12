"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { IconSliders, IconX, IconSend, IconTrash, IconCheck, IconArrowRight } from "@/components/icons";
import { useAction } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";
import { useCart } from "@/components/cart/CartProvider";
import { BotAvatar, BotAvatarBadge } from "@/components/chat/BotAvatar";
import { ChatBubble, TypingIndicator, Chips } from "@/components/chat/ChatKit";

type Card = any;
type Msg = { role: "user" | "assistant"; content: string; cards?: Card[]; suggestions?: string[] };
const GREETING =
  "Hi! I'm **Gaffer**, the Db Cinema kit assistant. Tell me what you're shooting and your dates and I'll build your kit — or ask me anything about gear, prices and availability.";
const SHOOTS = ["Interview", "Music video", "Documentary", "Event", "Product", "Wedding"];
const SIZES = ["Solo", "Small crew", "Large production"];
const IDLE_CHIPS = [
  "Build me a kit",
  "What's good in low light?",
  "How does delivery work?",
  "What's in my kit?",
];

export function BotBubble() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [talkingIdx, setTalkingIdx] = useState<number | null>(null);
  const [done, setDone] = useState<Record<string, "added" | "declined">>({});
  const [onb, setOnb] = useState(0); // conversational onboarding step (4 = done/dismissed)
  const [brief, setBrief] = useState({ shoot: "", size: "", start: "", end: "", budget: 600 });
  const endRef = useRef<HTMLDivElement>(null);
  const account = useAccount();
  const cart = useCart();
  const startAddon = useAction(api.checkout.startAddon);
  const [addonBusy, setAddonBusy] = useState<string | null>(null);

  async function addToBooking(item: any) {
    if (!account.token || !item?.addonBookingId) return;
    setAddonBusy(item.listingId);
    try {
      const { url } = await startAddon({
        token: account.token,
        bookingId: item.addonBookingId,
        listingId: item.listingId,
        title: item.title,
        start: item.addonStart,
        end: item.addonEnd,
        total: item.addonTotal,
        origin: window.location.origin,
      });
      window.location.href = url;
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: e?.message ?? "Couldn't add that to your booking." }]);
      setAddonBusy(null);
    }
  }

  useEffect(() => {
    const raw = localStorage.getItem("dbc_bot");
    if (raw) try { setMsgs(JSON.parse(raw)); } catch {}
  }, []);
  useEffect(() => {
    if (msgs.length) localStorage.setItem("dbc_bot", JSON.stringify(msgs.slice(-24)));
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  // mouth animates while the latest reply types itself out
  useEffect(() => {
    if (talkingIdx == null) return;
    const len = msgs[talkingIdx]?.content?.length ?? 0;
    const t = setTimeout(() => setTalkingIdx(null), Math.min(6000, len * 9 + 500));
    return () => clearTimeout(t);
  }, [talkingIdx, msgs]);

  function clearChat() {
    setMsgs([]);
    setDone({});
    setOnb(0);
    try { localStorage.removeItem("dbc_bot"); } catch {}
  }

  function startBuild() {
    const b = brief;
    setOnb(4);
    send(
      `Build me a ${b.shoot.toLowerCase()} kit for a ${b.size.toLowerCase()}, from ${b.start} to ${b.end}, budget around £${b.budget}. Recommend a complete, compatible kit.`,
    );
  }

  async function send(override?: string) {
    const t = (override ?? text).trim();
    if (!t || busy) return;
    setOnb(4); // any message dismisses the onboarding prompts
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
          cart: cart.items.map((i) => ({ listingId: i.listingId, title: i.title, start: i.start, end: i.end, slug: i.slug })),
        }),
      });
      const d = await r.json();
      setMsgs((m) => {
        setTalkingIdx(m.length);
        return [...m, { role: "assistant", content: d.reply || "…", cards: d.cards || [], suggestions: d.suggestions || [] }];
      });
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

  const lastAssistant = [...msgs].map((m, i) => ({ m, i })).reverse().find((x) => x.m.role === "assistant");
  const liveSuggestions = !busy && lastAssistant?.m.suggestions?.length ? lastAssistant.m.suggestions : null;

  return (
    <>
      {/* launcher — Gaffer peeks out of a glowing chip */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close chat" : "Chat with Gaffer, the kit assistant"}
        className="group fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-accent-400/40 bg-charcoal-900 shadow-[0_10px_40px_-8px_color-mix(in_srgb,var(--color-accent-400)_60%,transparent)] transition-transform duration-300 hover:scale-105 active:scale-95"
      >
        {!open && <span className="launcher-ring" aria-hidden />}
        {open ? (
          <IconX className="h-5 w-5 text-white/80" />
        ) : (
          <BotAvatar mood="idle" className="h-9 w-9" />
        )}
        {!open && (
          <span className="pointer-events-none absolute right-full mr-3 hidden whitespace-nowrap rounded-full border border-white/10 bg-charcoal-900/95 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/60 opacity-0 transition-opacity duration-300 group-hover:opacity-100 sm:block">
            Ask Gaffer
          </span>
        )}
      </button>

      {open && (
        <div className="chat-panel toast-in fixed bottom-24 right-5 z-50 flex h-[74vh] max-h-[640px] w-[92vw] max-w-sm flex-col overflow-hidden rounded-3xl border border-white/10 bg-charcoal-900/95 shadow-2xl shadow-black/60 backdrop-blur-xl">
          <div className="chat-bg" aria-hidden />
          <div className="chat-scanline" aria-hidden />

          {/* header */}
          <header className="relative z-10 flex items-center gap-3 border-b border-white/[0.07] bg-white/[0.03] px-4 py-3">
            <BotAvatarBadge mood={busy ? "thinking" : talkingIdx != null ? "talking" : "idle"} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-sm font-bold tracking-wide text-white">GAFFER</span>
                <span className="hud-label !text-[8px]">kit assistant</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
                {busy ? "on it…" : "online · builds kits live"}
              </div>
            </div>
            {msgs.length > 0 && (
              <button
                onClick={clearChat}
                aria-label="Clear conversation"
                className="flex h-8 w-8 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            )}
          </header>

          {/* thread */}
          <div className="relative z-10 flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.length === 0 && onb >= 4 && (
              <>
                <ChatBubble role="assistant" text={GREETING} />
                <Chips opts={IDLE_CHIPS} onPick={(v) => send(v)} className="pl-10" />
              </>
            )}
            {msgs.length === 0 && onb < 4 && (
              <div className="space-y-2.5">
                <ChatBubble role="assistant" text="Hi! I'm **Gaffer**. Let's build your kit — what are you shooting?" />
                {onb >= 1 && <ChatBubble role="user" text={brief.shoot} />}
                {onb === 0 && (
                  <Chips opts={SHOOTS} onPick={(v) => { setBrief((b) => ({ ...b, shoot: v })); setOnb(1); }} className="pl-10" />
                )}

                {onb >= 1 && <ChatBubble role="assistant" text="Nice — how big is the crew?" />}
                {onb >= 2 && <ChatBubble role="user" text={brief.size} />}
                {onb === 1 && (
                  <Chips opts={SIZES} onPick={(v) => { setBrief((b) => ({ ...b, size: v })); setOnb(2); }} className="pl-10" />
                )}

                {onb >= 2 && <ChatBubble role="assistant" text="When do you need the gear?" />}
                {onb >= 3 && <ChatBubble role="user" text={`${brief.start} → ${brief.end}`} />}
                {onb === 2 && (
                  <div className="chip-in flex flex-wrap items-end gap-2 pl-10">
                    <input type="date" value={brief.start} onChange={(e) => setBrief((b) => ({ ...b, start: e.target.value }))} className="input !px-2.5 !py-1.5 !text-xs [color-scheme:dark]" aria-label="Start date" />
                    <input type="date" value={brief.end} onChange={(e) => setBrief((b) => ({ ...b, end: e.target.value }))} className="input !px-2.5 !py-1.5 !text-xs [color-scheme:dark]" aria-label="End date" />
                    <button onClick={() => brief.start && brief.end && setOnb(3)} disabled={!brief.start || !brief.end} className="btn-primary px-3.5 py-1.5 text-xs">
                      Next <IconArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {onb >= 3 && <ChatBubble role="assistant" text="Last thing — your budget, then I'll build it." />}
                {onb === 3 && (
                  <div className="chip-in space-y-2.5 pl-10">
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <span className="w-14 font-mono text-accent-300">£{brief.budget}</span>
                      <input type="range" min={100} max={3000} step={50} value={brief.budget} onChange={(e) => setBrief((b) => ({ ...b, budget: Number(e.target.value) }))} className="flex-1 accent-accent-500" aria-label="Budget" />
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={startBuild} className="btn-primary px-4 py-2 text-xs">
                        <IconSliders className="h-3.5 w-3.5" /> Build my kit
                      </button>
                      <button onClick={() => setOnb(4)} className="text-xs text-white/35 transition-colors hover:text-white/60">
                        or just chat →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {msgs.map((m, mi) => (
              <div key={mi} className="space-y-2">
                <ChatBubble
                  role={m.role}
                  text={m.content}
                  stream={m.role === "assistant" && mi === msgs.length - 1 && !busy}
                  mood={talkingIdx === mi ? "talking" : "idle"}
                />
                {m.cards && m.cards.length > 0 && (
                  <div className="space-y-2 pl-10">
                    {m.cards.map((card: Card, ci: number) => {
                      const id = `${mi}:${ci}`;
                      return (
                        <CardView
                          key={ci}
                          card={card}
                          state={done[id]}
                          delay={ci * 90}
                          onAdd={() => {
                            if (card.kind === "swap") {
                              if (card.removed) removeByListing(card.removed.listingId);
                              addItem(card.added);
                            } else addItem(card.item);
                            setDone((d) => ({ ...d, [id]: "added" }));
                          }}
                          onDecline={() => setDone((d) => ({ ...d, [id]: "declined" }))}
                          onAddBooking={() => addToBooking(card.kind === "swap" ? card.added : card.item)}
                          addonBusy={addonBusy}
                          onAlt={() => {
                            const t = card.kind === "swap" ? card.added?.title : card.item?.title;
                            send(`Can you suggest an alternative to ${t}?`);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {liveSuggestions && <Chips opts={liveSuggestions} onPick={(v) => send(v)} className="pl-10" />}
            {busy && <TypingIndicator />}
            <div ref={endRef} />
          </div>

          {/* composer */}
          <div className="relative z-10 border-t border-white/[0.07] p-3">
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="e.g. a music video kit for 12–14 July"
                aria-label="Message Gaffer"
                className="input min-w-0 flex-1 rounded-full"
              />
              <button
                onClick={() => send()}
                disabled={busy || !text.trim()}
                aria-label="Send"
                className="btn-primary h-10 w-10 shrink-0 !rounded-full !p-0"
              >
                <IconSend className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-white/20">
              Gaffer checks live stock <span className="text-accent-400/60">/</span> prices include your dates
            </div>
          </div>
        </div>
      )}
    </>
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
          <div className="font-mono text-[10px] text-white/45">£{item.total} · {item.days}d</div>
        )}
      </div>
    </div>
  );
}

function CardView({ card, state, onAdd, onDecline, onAlt, onAddBooking, addonBusy, delay = 0 }: any) {
  if (state === "declined") return null;
  const added = state === "added";
  const swap = card.kind === "swap";
  const addonItem = swap ? card.added : card.item;
  const canAddBooking = !!addonItem?.addonBookingId;
  return (
    <div
      className="spot gradient-border rounded-2xl p-3"
      style={{ animation: `card-in 0.5s var(--ease-out-expo) ${delay}ms both` }}
    >
      {swap ? (
        <>
          <div className="mb-2 text-[11px] leading-relaxed text-white/50">{card.reason}</div>
          <div className="flex items-center gap-2">
            {card.removed && <Tile item={card.removed} tone="red" />}
            <IconArrowRight className="h-3.5 w-3.5 shrink-0 text-white/30" />
            <Tile item={card.added} tone="green" />
          </div>
        </>
      ) : (
        <div className="flex gap-3">
          {card.item.image && (
            <Link href={`/gear/${card.item.slug}`} className="block h-16 w-16 shrink-0 overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={card.item.image} alt={card.item.title} className="h-full w-full object-cover transition-transform duration-500 hover:scale-110" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <Link
              href={`/gear/${card.item.slug}`}
              className="block truncate text-sm font-medium text-white/90 transition-colors hover:text-accent-300"
            >
              {card.item.title}
            </Link>
            <div className="font-mono text-[11px] text-white/45">
              {card.item.estimated ? (
                <>£{card.item.perDay}/day · </>
              ) : (
                <>{card.item.start} → {card.item.end} · </>
              )}
              {card.item.memberTotal != null ? (
                <>
                  <span className="line-through">£{card.item.total}</span>{" "}
                  <span className="text-emerald-300">£{card.item.memberTotal}</span>{" "}
                  <span className="text-emerald-400/70">member −{card.item.memberPct}%</span>
                </>
              ) : (
                <>£{card.item.total}</>
              )}{" "}
              <span className={card.item.estimated ? "text-white/30" : ""}>
                ({card.item.days}d{card.item.estimated ? " est." : ""})
              </span>
            </div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-white/40">{card.reason}</div>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onAdd}
          disabled={added}
          className={`press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
            added
              ? "cursor-default bg-emerald-500/20 text-emerald-300"
              : "bg-accent-500 text-white hover:bg-accent-600"
          }`}
        >
          {added && <IconCheck className="h-3 w-3" />}
          {added ? "Added to kit" : swap ? "Accept swap" : "Add to kit"}
        </button>
        {!added && canAddBooking && (
          <button
            onClick={onAddBooking}
            disabled={addonBusy === addonItem.listingId}
            className="press rounded-full bg-emerald-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
          >
            {addonBusy === addonItem.listingId ? "…" : `Add to booking · £${addonItem.addonTotal}`}
          </button>
        )}
        {!added && (
          <>
            <button onClick={onAlt} className="glass rounded-full px-3 py-1.5 text-[11px] text-white/60 transition-colors hover:text-white">
              Find alternative
            </button>
            <button onClick={onDecline} className="rounded-full px-3 py-1.5 text-[11px] text-white/35 transition-colors hover:text-white/60">
              {swap ? "Keep original" : "Decline"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
