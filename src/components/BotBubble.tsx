"use client";
import { useLiveRecommendations } from "@/components/useLiveRecommendations";
import { SmartImage } from "@/components/SmartImage";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import { liveWindow, stockLines, liveChatChoices } from "@/lib/liveRecommendations";
import {
  IconSliders,
  IconX,
  IconSend,
  IconTrash,
  IconCheck,
  IconArrowRight,
} from "@/components/icons";
import { useAccount } from "@/components/account/AccountProvider";
import { useCart } from "@/components/cart/CartProvider";
import { createClientRequestId } from "@/lib/clientRequestId";
import { BotAvatar, BotAvatarBadge } from "@/components/chat/BotAvatar";
import { ChatBubble, TypingIndicator, Chips } from "@/components/chat/ChatKit";
import { GlowSlider } from "@/components/GlowSlider";
import { GafferCall } from "@/components/GafferCall";
import { useGafferSession } from "@/components/gaffer/GafferSession";
import { HumanHandoffOffer } from "@/components/rentals/HumanHandoffOffer";
import { dismissChatNotificationOffer, isChatNotificationOfferDismissed, isChatNotificationOfferReady, latestAnsweredQuestionReplyId } from "@/lib/chatNotificationOffer";
import { listingImageSources } from "../../shared/listingImages";

type Card = any;
type Msg = {
  role: "user" | "assistant";
  content: string;
  cards?: Card[];
  suggestions?: string[];
  id?: string;
  pending?: boolean;
  guestReplyComplete?: boolean;
  meta?: { offerHuman?: boolean };
};
const GREETING =
  "Hi! I'm Gaffer, the Db Cinema kit assistant. Tell me what you're shooting and your dates and I'll build your kit — or ask me anything about gear, prices and availability.";
const SHOOTS = [
  "Interview",
  "Music video",
  "Documentary",
  "Event",
  "Product",
  "Wedding",
];
const SIZES = ["Solo", "Small crew", "Large production"];
const IDLE_CHIPS = [
  "Build me a kit",
  "What's good in low light?",
  "How does delivery work?",
  "What's in my kit?",
];

export function BotBubble() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [rentalBookingId, setRentalBookingId] = useState<string | null>(null);
  // While a voice call is running this launcher stops being a chat button and
  // becomes the call's handle — see the launcher markup below.
  const {
    state: callState,
    speaking: gafferSpeaking,
    secs,
    dockOpen,
    setDockOpen,
  } = useGafferSession();
  const onCall = callState === "live" || callState === "connecting";

  // The call panel and the chat panel both sit at bottom-24 right-5, so they'd
  // stack on top of each other. Talking beats typing: fold the chat away when a
  // call starts — it's one click back once they've hung up.
  useEffect(() => {
    if (onCall) setOpen(false);
  }, [onCall]);
  useEffect(() => {
    const openGafferChat = (event: Event) => {
      setOpen(true);
      const detail = (event as CustomEvent<{ prompt?: unknown; bookingId?: unknown }>).detail;
      const prompt = detail?.prompt;
      setRentalBookingId(typeof detail?.bookingId === "string" && detail.bookingId.length <= 64 ? detail.bookingId : null);
      if (typeof prompt === "string" && prompt.trim() && prompt.length <= 320) {
        setText((current) => current.trim() ? current : prompt.trim());
      }
    };
    window.addEventListener("dbc:open-gaffer-chat", openGafferChat);
    return () => window.removeEventListener("dbc:open-gaffer-chat", openGafferChat);
  }, []);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [talkingIdx, setTalkingIdx] = useState<number | null>(null);
  const [done, setDone] = useState<Record<string, "added" | "declined">>({});
  const [onb, setOnb] = useState(0); // conversational onboarding step (4 = done/dismissed)
  const [brief, setBrief] = useState({
    shoot: "",
    size: "",
    start: "",
    end: "",
    budget: 600,
  });
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const account = useAccount();
  const cart = useCart();
  const accountThread = useQuery(api.chat.myThread, account.token ? { token: account.token } : "skip");
  const [notificationOfferDismissed, setNotificationOfferDismissed] = useState(true);
  const [streamedNotificationReplyId, setStreamedNotificationReplyId] = useState<string | null>(null);
  const [guestOfferDismissed, setGuestOfferDismissed] = useState(false);
  const [guestHandoffError, setGuestHandoffError] = useState("");
  useEffect(() => {
    if (!account.me?._id) { setNotificationOfferDismissed(true); return; }
    setNotificationOfferDismissed(isChatNotificationOfferDismissed(String(account.me._id)));
    const accountId=account.me._id;
    const receive=(event:Event)=>{
      if((event as CustomEvent).detail!=="active")return;
      dismissChatNotificationOffer(String(accountId));
      setNotificationOfferDismissed(true);
    };
    window.addEventListener("dbc:renter-notification-status",receive);
    window.dispatchEvent(new Event("dbc:request-renter-notification-status"));
    return()=>window.removeEventListener("dbc:renter-notification-status",receive);
  }, [account.me?._id]);
  const recordAccountQuestion = useMutation(api.chat.recordGafferUserMessage);
  const requestAccountHuman = useMutation(api.chat.requestHuman);
  const hydratedAccountToken = useRef<string | null>(null);
  const pendingAccountRequest = useRef<{ token: string; text: string; requestId: string } | null>(null);
  const [accountAwaitingMessageId, setAccountAwaitingMessageId] = useState<string | null>(null);
  const addonBusy = null;
  function addToBooking(item: any) {
    if (!account.token || !item?.addonBookingId) return;
    window.location.href = `/account?rental=${encodeURIComponent(item.addonBookingId)}#chat`;
  }

  useEffect(() => {
    if (account.token) {
      if (accountThread === undefined) return;
      const saved = (accountThread ?? []).map((message) => ({
        id: String(message._id),
        role: message.sender === "renter" ? "user" as const : "assistant" as const,
        content: message.text,
        meta: message.meta ?? undefined,
      }));
      if (hydratedAccountToken.current !== account.token) {
        hydratedAccountToken.current = account.token;
        setMsgs(saved);
        try { localStorage.removeItem("dbc_bot"); } catch {}
        return;
      }
      setMsgs((current) => {
        const byId = new Map(current.filter((message) => message.id).map((message) => [message.id!, message]));
        const synced = saved.map((message) => {
          const existing = byId.get(message.id!);
          return existing ? { ...message, cards: existing.cards, suggestions: existing.suggestions } : message;
        });
        const pending = current.filter((message) => message.pending && !saved.some((savedMessage) => savedMessage.role === message.role && savedMessage.content === message.content));
        return [...synced, ...pending];
      });
      return;
    }
    hydratedAccountToken.current = null;
    const raw = localStorage.getItem("dbc_bot");
    if (raw)
      try {
        const saved: Msg[] = JSON.parse(raw);
        setMsgs(saved.map((m) => (m.cards?.length ? { ...m, cards: [] } : m)));
      } catch {}
  }, [account.token, accountThread]);
  useEffect(() => {
    if (!accountAwaitingMessageId || !accountThread) return;
    const questionIndex = accountThread.findIndex((message) => String(message._id) === accountAwaitingMessageId);
    if (questionIndex < 0) return;
    if (!accountThread.slice(questionIndex + 1).some((message) => message.sender !== "renter")) return;
    setAccountAwaitingMessageId(null);
    setBusy(false);
  }, [accountAwaitingMessageId, accountThread]);
  useEffect(() => {
    if (account.token) {
      try { localStorage.removeItem("dbc_bot"); } catch {}
      return;
    }
    if (msgs.length) {
      try {
        localStorage.setItem("dbc_bot", JSON.stringify(msgs.slice(-24)));
      } catch {}
    }
    // Scroll only the inner message list — NOT scrollIntoView, which scrolls the whole
    // document and yanks the fixed chat panel out of view (then back) when you send a message.
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs, busy, account.token, onb]);

  // mouth animates while the latest reply types itself out
  useEffect(() => {
    if (talkingIdx == null) return;
    const len = msgs[talkingIdx]?.content?.length ?? 0;
    const t = setTimeout(
      () => setTalkingIdx(null),
      Math.min(6000, len * 9 + 500),
    );
    return () => clearTimeout(t);
  }, [talkingIdx, msgs]);

  function clearChat() {
    if (account.token) return;
    setMsgs([]);
    setDone({});
    setOnb(0);
    try {
      localStorage.removeItem("dbc_bot");
    } catch {}
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
    const priorAccountRequest = pendingAccountRequest.current;
    const accountRequestId = account.token
      ? priorAccountRequest?.token === account.token && priorAccountRequest.text === t
        ? priorAccountRequest.requestId
        : createClientRequestId()
      : null;
    if (account.token && accountRequestId && (priorAccountRequest?.requestId !== accountRequestId))
      pendingAccountRequest.current = { token: account.token, text: t, requestId: accountRequestId };
    setOnb(4); // any message dismisses the onboarding prompts
    const next: Msg[] = [...msgs, { role: "user", content: t, pending: !!account.token }];
    setMsgs(next);
    setText("");
    setBusy(true);
    let renterMessageId: string | null = null;
    let waitForServerReply = false;
    try {
      if (account.token) {
        const recorded = await recordAccountQuestion({ token: account.token, text: t, requestId: accountRequestId! });
        if (pendingAccountRequest.current?.requestId === accountRequestId) pendingAccountRequest.current = null;
        renterMessageId = String(recorded.messageId);
        setMsgs((current) => current.map((message, index) => index === current.length - 1
          ? { ...message, id: renterMessageId!, pending: false }
          : message));
        if (recorded.handledByHuman) {
          setMsgs((current) => [...current, {
            role: "assistant",
            content: "Your team is handling this conversation. Your message is saved in Account → Messages, where their reply will appear.",
          }]);
          return;
        }
        setAccountAwaitingMessageId(renterMessageId);
        waitForServerReply = true;
        return;
      }
      const r = await fetch("/api/bot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          token: account.token ?? undefined,
          rentalBookingId: rentalBookingId ?? undefined,
          cart: cart.items.map((i) => ({
            listingId: i.listingId,
            title: i.title,
            start: i.start,
            end: i.end,
            pickupTime: i.pickupTime, returnTime: i.returnTime,
            slug: i.slug,
          })),
        }),
      });
      const d = await r.json();
      const reply = d.reply || "…";
      let replyId: string | undefined;
      const cards = (d.cards || []).map((card:any)=>{
        const item=card.kind==="swap"?card.added:card.item;
        const first=cart.items[0];
        const followBasketWindow=!first||cart.items.every(i=>i.start===item?.start&&i.end===item?.end&&i.pickupTime===item?.pickupTime&&i.returnTime===item?.returnTime);
        return card.kind==="swap"?{...card,added:{...item,followBasketWindow}}:{...card,item:{...item,followBasketWindow}};
      });
      setMsgs((current) => {
        setTalkingIdx(current.length);
        const existingIndex = replyId ? current.findIndex((message) => message.id === replyId) : -1;
        const message = { id: replyId, role: "assistant" as const, content: reply, cards, suggestions: d.suggestions || [], guestReplyComplete: r.ok && typeof d.reply === "string" && !!d.reply.trim() };
        if (existingIndex >= 0) return current.map((item, index) => index === existingIndex ? message : item);
        return [...current, message];
      });
    } catch {
      setMsgs((current) => {
        const withoutUnsentDraft = account.token && !renterMessageId && current.at(-1)?.pending
          ? current.slice(0, -1)
          : current;
        return [...withoutUnsentDraft, {
          role: "assistant",
          content: account.token
            ? renterMessageId
              ? "Your message is saved in Account → Messages. Gaffer could not finish this reply, but you can continue in that same conversation."
              : "I couldn’t confirm your question was saved. Check Account → Messages before trying again."
            : "Connection hiccup — please try again.",
        }];
      });
    } finally {
      if (!waitForServerReply) setBusy(false);
    }
  }

  function addItem(it: any) {
    if ((it.needsTimes && !it.checkoutTimeCheckPending) || (it.available !== true && !it.requestable && !it.checkoutTimeCheckPending)) return;
    cart.add({
      listingId: it.listingId,
      slug: it.slug,
      title: it.title,
      heroImage: listingImageSources(it)[0] ?? null,
      start: it.start,
      end: it.end,
      pickupTime: it.pickupTime, returnTime: it.returnTime,
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

  const lastAssistant = [...msgs]
    .map((m, i) => ({ m, i }))
    .reverse()
    .find((x) => x.m.role === "assistant");
  const notificationPromptReplyId = accountThread ? latestAnsweredQuestionReplyId(accountThread) : null;
  const firstGuestQuestion = msgs.findIndex(message => message.role === "user" && message.content.trim());
  const firstGuestReply = firstGuestQuestion < 0 ? -1 : msgs.findIndex((message, index) => index > firstGuestQuestion && message.role === "assistant" && message.guestReplyComplete);
  function saveGuestChat() {
    try {
      const transcript = msgs.map(message => `${message.role === "user" ? "Guest" : "Guest-recorded assistant reply"}: ${message.content}`).join("\n\n");
      if (!transcript || transcript.length > 8000) { setGuestHandoffError("This conversation is too long to save here. Please copy it before signing in."); return; }
      localStorage.setItem("dbc_guest_chat_handoff_v1", JSON.stringify({ requestId: `guest_${createClientRequestId()}`, transcript }));
      window.location.href = "/account#chat";
    } catch { setGuestHandoffError("Please allow site storage to save your conversation before signing in."); }
  }
  function openNotificationSetup() {
    try { sessionStorage.setItem("dbc_open_chat_notification_settings", "1"); } catch {}
  }
  const latestAccountMessageId = accountThread?.at(-1)?._id ? String(accountThread.at(-1)!._id) : undefined;
  const liveSuggestions =
    !busy && lastAssistant?.m.suggestions?.length
      ? lastAssistant.m.suggestions
      : null;

  // Only the most recent reply that carries cards owns the live recommendation
  // slot. Cards from earlier turns are superseded the instant a newer reply
  // arrives — keeping them actionable lets a stale "Recommended lens" card from
  // a prior question masquerade as the answer to the current one. We collapse
  // earlier turns to read-only confirmations of anything already added to the
  // cart (so those actions aren't lost) and hide the rest.
  const liveCardsIdx = (() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && (msgs[i].cards?.length ?? 0) > 0)
        return i;
    }
    return -1;
  })();
  const activeCards=(msgs[liveCardsIdx]?.cards??[]).slice(0,12);
  const liveCards:any=useLiveRecommendations(open&&!busy&&activeCards.length?{
    groups:activeCards.map((card:any,index:number)=>{const item=card.kind==="swap"?card.added:card.item;return {key:String(index),listingId:item.listingId,types:item.itemType?[item.itemType]:undefined,...liveWindow(item,cart.items),replaceListingId:card.kind==="swap"?card.removed?.listingId:undefined};}),
    basket:stockLines(cart.items),selectedIds:[...new Set(activeCards.filter((_,index)=>done[`${liveCardsIdx}:${index}`]!=="declined").map((card:any)=>(card.kind==="swap"?card.added:card.item)?.listingId).filter((id:any)=>id&&!cart.items.some(i=>i.listingId===id)))],
  }:null);

  if ((pathname === "/account" || pathname === "/admin") && !onCall)
    return null;

  return (
    <>
      {/* launcher — Gaffer peeks out of a glowing chip, and goes red on a call.
          One button in this corner, not two: while a call is live this stops
          being "open the chat" and becomes the call's handle, so hanging up
          never means hunting for the control that started it. */}
      {(!open || onCall) && <button
        onClick={() => (onCall ? setDockOpen(!dockOpen) : setOpen((o) => !o))}
        aria-label={
          onCall
            ? dockOpen
              ? "Hide call controls"
              : "Show call controls — you're on a call with Gaffer"
            : open
              ? "Close the contact chat"
              : "Contact us — chat with Gaffer"
        }
        data-on-call={onCall ? "true" : undefined}
        data-speaking={onCall && gafferSpeaking ? "true" : undefined}
        // colours live in globals.css keyed on data-on-call, so amber→red is a
        // slow crossfade rather than a class swap that snaps
        className="group launcher fixed bottom-3 right-3 z-50 flex h-12 w-12 items-center justify-center gap-0 rounded-full border p-0 hover:scale-105 active:scale-95 sm:bottom-5 sm:right-5 sm:h-14 sm:w-14 lg:w-auto lg:justify-start lg:gap-2.5 lg:px-4"
      >
        {(!open || onCall) && <span className="launcher-ring" aria-hidden />}
        {onCall ? (
          // the equaliser dances while Gaffer talks, so the button reads as live
          <span
            className="flex h-5 items-end gap-[3px] text-rose-300"
            aria-hidden
          >
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="gd-bar w-[3px] rounded-full bg-current"
              />
            ))}
          </span>
        ) : open ? (
          <IconX className="h-5 w-5 text-white/80" />
        ) : (
          <BotAvatar mood="idle" className="h-9 w-9" />
        )}
        <span className="relative z-[1] hidden whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/90 lg:block">
          Contact us
        </span>
        {onCall && (
          <span className="pointer-events-none absolute right-full mr-3 hidden whitespace-nowrap rounded-full border border-rose-400/30 bg-rose-950/95 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-rose-200/90 lg:block">
            {callState === "connecting" ? "Connecting…" : `On call · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}
          </span>
        )}
      </button>}

      {open && (
        <>
        <button
          type="button"
          aria-label="Close Gaffer chat"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm sm:hidden"
        />
        <div role="dialog" aria-modal="true" aria-label="Chat with Gaffer" className="chat-panel gaffer-chat-panel toast-in fixed inset-x-3 top-3 bottom-3 z-50 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-charcoal-900/95 shadow-2xl shadow-black/60 backdrop-blur-xl sm:inset-auto sm:bottom-24 sm:right-5 sm:top-auto sm:h-[74vh] sm:max-h-[640px] sm:w-[92vw] sm:max-w-sm sm:rounded-3xl">
          <div className="chat-bg" aria-hidden />
          <div className="chat-scanline" aria-hidden />

          {/* header */}
          <header className="relative z-10 flex items-center gap-2 border-b border-white/[0.07] bg-white/[0.03] px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
            <BotAvatarBadge
              mood={busy ? "thinking" : talkingIdx != null ? "talking" : "idle"}
              size={40}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-sm font-bold tracking-wide text-white">
                  GAFFER
                </span>
                <span className="hud-label hidden !text-[8px] min-[400px]:inline">kit assistant</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
                {busy ? "on it…" : <><span className="sm:hidden">online</span><span className="hidden sm:inline">online · builds kits live</span></>}
              </div>
            </div>
            <GafferCall
              className="!px-3 !py-1.5 !text-xs"
              label="Voice"
              compact
            />
            {msgs.length > 0 && !account.token && (
              <button
                onClick={clearChat}
                aria-label="Clear conversation"
                className="flex h-8 w-8 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white">
              <IconX className="h-4 w-4" />
            </button>
          </header>

          {/* thread */}
          <div
            ref={scrollRef}
            className="relative z-10 min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4"
          >
            {msgs.length === 0 && onb >= 4 && (
              <>
                <ChatBubble role="assistant" text={GREETING} />
                <Chips
                  opts={IDLE_CHIPS}
                  onPick={(v) => send(v)}
                  className="pl-10"
                  compactMobile
                />
              </>
            )}
            {msgs.length === 0 && onb < 4 && (
              <div className="space-y-2.5">
                <ChatBubble
                  role="assistant"
                  text="Hi! I'm Gaffer. Let's build your kit — what are you shooting?"
                />
                {onb >= 1 && <ChatBubble role="user" text={brief.shoot} />}
                {onb === 0 && (
                  <Chips
                    opts={SHOOTS}
                    onPick={(v) => {
                      setBrief((b) => ({ ...b, shoot: v }));
                      setOnb(1);
                    }}
                    className="pl-10"
                    compactMobile
                  />
                )}

                {onb >= 1 && (
                  <ChatBubble
                    role="assistant"
                    text="Nice — how big is the crew?"
                  />
                )}
                {onb >= 2 && <ChatBubble role="user" text={brief.size} />}
                {onb === 1 && (
                  <Chips
                    opts={SIZES}
                    onPick={(v) => {
                      setBrief((b) => ({ ...b, size: v }));
                      setOnb(2);
                    }}
                    className="pl-10"
                    compactMobile
                  />
                )}

                {onb >= 2 && (
                  <ChatBubble
                    role="assistant"
                    text="When do you need the gear?"
                  />
                )}
                {onb >= 3 && (
                  <ChatBubble
                    role="user"
                    text={`${brief.start} → ${brief.end}`}
                  />
                )}
                {onb === 2 && (
                  <div className="chip-in flex flex-wrap items-end gap-2 pl-10">
                    <input
                      type="date"
                      value={brief.start}
                      onChange={(e) =>
                        setBrief((b) => ({ ...b, start: e.target.value }))
                      }
                      className="input !px-2.5 !py-1.5 !text-xs [color-scheme:dark]"
                      aria-label="Start date"
                    />
                    <input
                      type="date"
                      value={brief.end}
                      onChange={(e) =>
                        setBrief((b) => ({ ...b, end: e.target.value }))
                      }
                      className="input !px-2.5 !py-1.5 !text-xs [color-scheme:dark]"
                      aria-label="End date"
                    />
                    <button
                      onClick={() => brief.start && brief.end && setOnb(3)}
                      disabled={!brief.start || !brief.end}
                      className="btn-primary px-3.5 py-1.5 text-xs"
                    >
                      Next <IconArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {onb >= 3 && (
                  <ChatBubble
                    role="assistant"
                    text="Last thing — your budget, then I'll build it."
                  />
                )}
                {onb === 3 && (
                  <div className="chip-in space-y-2.5 pl-10">
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <span className="w-14 font-mono text-sm font-semibold text-accent-300">
                        £{brief.budget}
                      </span>
                      <GlowSlider
                        value={brief.budget}
                        onChange={(v) => setBrief((b) => ({ ...b, budget: v }))}
                        className="flex-1"
                        aria-label="Budget"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={startBuild}
                        className="btn-primary px-4 py-2 text-xs"
                      >
                        <IconSliders className="h-3.5 w-3.5" /> Build my kit
                      </button>
                      <button
                        onClick={() => setOnb(4)}
                        className="text-xs text-white/35 transition-colors hover:text-white/60"
                      >
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
                  stream={
                    m.role === "assistant" && mi === msgs.length - 1 && !busy
                  }
                  mood={talkingIdx === mi ? "talking" : "idle"}
                  onStreamComplete={m.id && m.id === notificationPromptReplyId ? () => setStreamedNotificationReplyId(m.id!) : undefined}
                />
                {account.token && account.me?._id && !notificationOfferDismissed && m.id === notificationPromptReplyId && isChatNotificationOfferReady(notificationPromptReplyId, streamedNotificationReplyId) && <div className="ml-10 flex gap-3 rounded-2xl border border-white/15 bg-white/[0.07] p-3 text-xs text-white/80 shadow-[0_12px_32px_#0005] backdrop-blur-2xl" aria-label="Chat notification setup"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-amber-100/20 bg-amber-100/[0.08] text-amber-100" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4"><path d="M18 8a6 6 0 00-12 0v5l-2 3v1h16v-1l-2-3V8ZM9 20h6"/><path d="M18.5 3v3m-1.5-1.5h3"/></svg></span><div className="min-w-0 flex-1"><strong className="text-white">Get chat alerts</strong><p className="mt-1 leading-relaxed">Open setup, then choose “Enable notifications.” On iPhone or iPad, add this site to your Home Screen first.</p><div className="mt-3 flex items-center gap-4"><Link href="/account#chat" className="rounded-full border border-amber-100/30 bg-amber-100/[0.08] px-3 py-2 text-amber-100 transition hover:bg-amber-100/[0.14]" onClick={openNotificationSetup}>Open setup</Link><button type="button" className="text-white/50 transition hover:text-white/80" onClick={() => { if(account.me?._id)dismissChatNotificationOffer(String(account.me._id)); setNotificationOfferDismissed(true); }}>Not now</button></div></div></div>}
                {!account.loading && !account.token && !guestOfferDismissed && !busy && talkingIdx !== mi && mi === firstGuestReply && <div className="ml-10 rounded-2xl border border-amber-100/20 bg-white/[0.07] p-4 text-xs text-white/80 shadow-xl backdrop-blur-2xl" aria-label="Save chat and set up alerts"><strong className="text-white">Stay in the loop</strong><p className="mt-1 leading-relaxed">Save this conversation to an account, then choose whether to enable reply alerts.</p><div className="mt-3 flex items-center gap-4"><button type="button" onClick={saveGuestChat} className="rounded-full border border-amber-100/30 bg-amber-100/[0.08] px-3 py-2 text-amber-100">Create account or sign in</button><button type="button" onClick={() => setGuestOfferDismissed(true)} className="text-white/50">Not now</button></div>{guestHandoffError && <p role="alert" className="mt-2 text-amber-100">{guestHandoffError}</p>}</div>}
                {account.token && m.role === "assistant" && m.id && m.meta?.offerHuman && m.id === latestAccountMessageId && <HumanHandoffOffer key={`support-${m.id}`} onRequest={async () => { await requestAccountHuman({ token: account.token!, offerMessageId: m.id as any }); }} />}
                {m.cards &&
                  m.cards.length > 0 &&
                  (() => {
                    const isLiveTurn = mi === liveCardsIdx;
                    // Superseded turn: surface only the items the user actually
                    // added to their kit (read-only), and drop the rest so an old
                    // recommendation can't keep posing as the current answer.
                    const visible = isLiveTurn
                      ? m.cards.map((card: Card, ci: number) => ({ card, ci }))
                      : m.cards
                          .map((card: Card, ci: number) => ({ card, ci }))
                          .filter(({ ci }) => done[`${mi}:${ci}`] === "added");
                    if (visible.length === 0) return null;
                    return (
                      <div className="space-y-2 pl-10">
                        {visible.map(({ card, ci }) => {
                          const id = `${mi}:${ci}`;
                          if (!isLiveTurn) {
                            const it =
                              card.kind === "swap" ? card.added : card.item;
                            return (
                              <div
                                key={ci}
                                className="flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/[0.08] px-3 py-1.5 text-[11px] text-emerald-300"
                              >
                                <IconCheck className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  Added to kit · {it?.title}
                                </span>
                              </div>
                            );
                          }
                          return liveChatChoices(card,liveCards?.groups[String(ci)],liveCards).map((shown:any,choice:number)=>{
                            const item=shown.kind==="swap"?shown.added:shown.item;
                            const choiceId=choice===0?id:`${id}:${item.listingId}`;
                            const state=shown.alreadyIncluded?"added":done[choiceId]==="added"&&!cart.items.some(i=>i.listingId===item.listingId)?undefined:done[choiceId];
                            return (
                            <CardView
                              key={choiceId}
                              card={shown}
                              state={state}
                              delay={ci * 90}
                              onAdd={() => {
                                if(shown.refreshing||(item.available!==true&&!item.requestable&&!item.checkoutTimeCheckPending)||item.needsTimes)return;
                                if (shown.kind === "swap") {
                                  if (shown.removed)
                                    removeByListing(shown.removed.listingId);
                                  addItem(shown.added);
                                } else addItem(shown.item);
                                // The transcript receipt keeps the exact item
                                // explicitly chosen, including an alternative.
                                setMsgs(previous=>previous.map((message,index)=>index===mi?{...message,cards:message.cards?.map((old,index)=>index===ci?shown:old)}:message));
                                setDone((d) => ({ ...d, [id]: "added" }));
                              }}
                              onDecline={() =>
                                setDone((d) => ({ ...d, [choiceId]: "declined" }))
                              }
                              onAddBooking={() =>
                                addToBooking(
                                  shown.kind === "swap" ? shown.added : shown.item,
                                )
                              }
                              addonBusy={addonBusy}
                              onAlt={() => {
                                const t =
                                  shown.kind === "swap"
                                    ? shown.added?.title
                                    : shown.item?.title;
                                send(`Can you suggest an alternative to ${t}?`);
                              }}
                            />
                          );});
                        })}
                      </div>
                    );
                  })()}
              </div>
            ))}
            {liveSuggestions && (
              <Chips
                opts={liveSuggestions}
                onPick={(v) => send(v)}
                className="pl-10"
                compactMobile
              />
            )}
            {busy && <TypingIndicator />}
            <div ref={endRef} />
          </div>

          {/* composer */}
          <div className="relative z-10 border-t border-white/[0.07] p-3">
            <div className="flex gap-2">
              <input
                ref={composerRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Ask about gear or dates…"
                aria-label="Message Gaffer"
                className="input min-w-0 flex-1 rounded-full"
              />
              <button
                onClick={() => send()}
                disabled={busy || !text.trim()}
                aria-label={busy ? "Sending message" : "Send message"}
                aria-describedby="gaffer-send-hint"
                title={busy ? "Sending message" : text.trim() ? "Send message" : "Type a message to enable sending"}
                className="btn-primary h-10 w-10 shrink-0 !rounded-full !p-0"
                style={busy || !text.trim() ? {
                  backgroundColor: "#262320",
                  color: "#c5ab91",
                  opacity: 1,
                  border: "1px solid #62574c",
                  boxShadow: "none",
                } : undefined}
              >
                <IconSend className="h-4 w-4" />
              </button>
              <span id="gaffer-send-hint" className="sr-only">
                {busy ? "Sending your message." : text.trim() ? "Ready to send." : "Type a message to enable sending."}
              </span>
            </div>
            <div className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-white/20">
              Gaffer checks live stock{" "}
              <span className="text-accent-400/60">/</span> prices include your
              dates
            </div>
          </div>
        </div>
        </>
      )}
    </>
  );
}

function Tile({ item, tone }: { item: any; tone: "green" | "red" | "plain" }) {
  const images = listingImageSources(item);
  const ring =
    tone === "green"
      ? "border-emerald-400/40 bg-emerald-500/[0.08]"
      : tone === "red"
        ? "border-red-400/30 bg-red-500/[0.06]"
        : "border-white/10 bg-white/[0.03]";
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border p-2 ${ring}`}>
      {images.length > 0 ? (
        <SmartImage fit="contain" src={images[0]} fallbackSources={images.slice(1)} alt={item.title} className={`h-11 w-11 shrink-0 rounded-lg ring-1 ring-white/10 ${tone === "red" ? "opacity-60" : ""}`} />
      ) : null}
      <div className="min-w-0">
        <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/35">{tone === "red" ? "Current" : "Suggested"}</div>
        <div className={`line-clamp-2 text-[11px] font-medium leading-snug ${tone === "red" ? "text-white/45 line-through" : "text-white/85"}`}>
          {item?.title}
        </div>
        {tone !== "red" && item?.total != null && (
          <div className="font-mono text-[10px] text-white/45">
            £{item.total} · {item.days}d
          </div>
        )}
      </div>
    </div>
  );
}

function CardView({
  card,
  state,
  onAdd,
  onDecline,
  onAlt,
  onAddBooking,
  addonBusy,
  delay = 0,
}: any) {
  if (state === "declined") return null;
  const added = state === "added";
  const swap = card.kind === "swap";
  const addonItem = swap ? card.added : card.item;
  const itemImages = listingImageSources(card.item);
  const canAddBooking = !!addonItem?.addonBookingId;
  const includedPreview=[...(addonItem?.verifiedComponentContents??[]),...(addonItem?.rentalContents?.included??[])].slice(0,2);
  const availabilityLabel = card.refreshing
    ? "Refreshing details"
    : addonItem?.needsTimes
      ? "Choose dates"
      : addonItem?.available === true
        ? "Available for these dates"
        : addonItem?.requestable
          ? "Requestable"
          : addonItem?.checkoutTimeCheckPending
            ? "Stock checked at checkout"
            : "Check dates";
  return (
    <div
      aria-label={`${swap ? "Equipment change suggestion" : "Gear recommendation"}: ${addonItem?.title ?? "rental item"}`}
      data-testid="gaffer-recommendation-card"
      className="spot gradient-border group relative overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_top_left,rgba(237,176,110,0.1),transparent_58%),linear-gradient(145deg,rgba(255,255,255,0.065),rgba(255,255,255,0.025))] p-3 shadow-[0_16px_38px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-3.5"
      style={{ animation: `card-in 0.5s var(--ease-out-expo) ${delay}ms both` }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.17em] text-accent-200/75">{swap ? "Kit update" : "Gaffer pick"}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-black/15 px-2 py-1 text-[9px] font-medium text-white/60">
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${addonItem?.available === true ? "bg-emerald-300" : addonItem?.requestable ? "bg-amber-300" : "bg-white/35"}`} />
          {availabilityLabel}
        </span>
      </div>
      {swap ? (
        <>
          <div className="mb-2 line-clamp-2 text-[11px] leading-relaxed text-white/55">{card.reason}</div>
          <div className="flex items-center gap-2">
            {card.removed && <Tile item={card.removed} tone="red" />}
            <IconArrowRight className="h-4 w-4 shrink-0 text-accent-200/70" />
            <Tile item={card.added} tone="green" />
          </div>
        </>
      ) : (
        <div className="flex min-w-0 items-stretch gap-3">
          {itemImages.length > 0 && (
            <Link
              href={`/gear/${card.item.slug}`}
              aria-label={`View ${card.item.title}`}
              data-testid="gaffer-product-image-link"
              className="block h-[76px] w-[76px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(circle_at_50%_38%,rgba(255,255,255,0.1),rgba(255,255,255,0.015)_68%)] shadow-inner sm:h-[88px] sm:w-[88px]"
            >
              <SmartImage fit="cover" src={itemImages[0]} fallbackSources={itemImages.slice(1)} alt={card.item.title} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]" />
            </Link>
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <Link
              href={`/gear/${card.item.slug}`}
              className="line-clamp-2 text-[13px] font-semibold leading-snug text-white/95 transition-colors hover:text-accent-200 sm:text-sm"
            >
              {card.item.title}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              {card.refreshing ? <span className="text-[11px] text-white/50">Refreshing price…</span> : card.item.memberTotal != null ? (
                <>
                  <span className="font-mono text-[10px] text-white/35 line-through">£{Number(card.item.total).toFixed(2)}</span>
                  <span className="font-mono text-[15px] font-semibold text-white">£{Number(card.item.memberTotal).toFixed(2)}</span>
                  <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.08] px-1.5 py-0.5 text-[9px] font-medium text-emerald-200">
                    {card.item.memberBenefitKind === "loyalty" ? `Encore −${card.item.memberPct}%` : `Save £${Number(card.item.memberSaving).toFixed(2)}`}
                  </span>
                </>
              ) : card.item.total != null ? <span className="font-mono text-[15px] font-semibold text-white">£{card.item.total}</span> : card.item.perDay != null ? <span className="font-mono text-[14px] font-semibold text-white">£{card.item.perDay}<span className="ml-1 text-[10px] font-normal text-white/45">/ day</span></span> : null}
            </div>
            <div className="mt-0.5 text-[10px] text-white/45">
              {card.item.estimated ? "Indicative price" : card.item.days ? `${card.item.days} rental ${card.item.days === 1 ? "day" : "days"}${card.item.start && card.item.end ? ` · ${card.item.start} → ${card.item.end}` : ""}` : card.item.start && card.item.end ? `${card.item.start} → ${card.item.end}` : "Live listing details"}
            </div>
            {card.reason && <div className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-white/50">{card.reason}</div>}
            {includedPreview.length > 0 && <div className="mt-1 line-clamp-1 text-[9px] leading-relaxed text-white/35">Includes {includedPreview.join(" · ")}</div>}
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.08] pt-2.5">
        {addonItem?.needsTimes ? <Link href={`/gear/${addonItem.slug}`} className="btn-primary inline-flex min-h-9 items-center justify-center rounded-xl px-3.5 text-[11px] font-semibold">Choose rental dates</Link> : <button
          onClick={onAdd}
          data-testid="gaffer-recommendation-primary-action"
          disabled={added || card.refreshing || (addonItem?.available !== true && !addonItem?.requestable && !addonItem?.checkoutTimeCheckPending)}
          className={`press inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[11px] font-semibold transition-colors ${
            added
              ? "cursor-default border border-emerald-300/20 bg-emerald-400/[0.08] text-emerald-200"
              : "border border-accent-200/30 bg-[linear-gradient(125deg,rgba(240,184,128,0.28),rgba(152,105,68,0.22))] text-white shadow-[0_4px_18px_rgba(215,151,93,0.12)] transition hover:border-accent-100/45 hover:bg-[linear-gradient(125deg,rgba(240,184,128,0.38),rgba(152,105,68,0.3))]"
          }`}
        >
          {added && <IconCheck className="h-3 w-3" />}
          {added ? card.alreadyIncluded?"Already in your kit":"Added to kit" : card.refreshing ? "Refreshing choices…" : addonItem?.requestable ? "Add request" : addonItem?.available !== true && !addonItem?.checkoutTimeCheckPending ? "Choose a matching alternative" : swap ? "Accept swap" : "Add to kit"}
        </button>}
        {!added && canAddBooking && (
          <button
            onClick={onAddBooking}
            data-testid="gaffer-recommendation-rental-action"
            disabled={card.refreshing||addonItem.available!==true||addonBusy === addonItem.listingId}
            className="press min-h-9 rounded-xl border border-emerald-200/20 bg-emerald-300/[0.08] px-3.5 text-[11px] font-medium text-emerald-100 transition hover:bg-emerald-300/[0.14] disabled:opacity-50"
          >
            {addonBusy === addonItem.listingId
              ? "…"
              : "Request item in rental chat"}
          </button>
        )}
        {!added && (
          <>
            <button
              onClick={onAlt}
              className="glass min-h-9 rounded-xl px-3 text-[11px] text-white/65 transition-colors hover:text-white"
            >
              Find alternative
            </button>
            <button
              onClick={onDecline}
              className="min-h-9 rounded-xl px-2.5 text-[11px] text-white/40 transition-colors hover:text-white/70"
            >
              {swap ? "Keep original" : "Decline"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
