"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BotAvatarBadge, type BotMood } from "./BotAvatar";
import { CONTACT_EMAIL } from "@/lib/site";
import { approvedChatLink } from "@/lib/chatLinks";
import { FormattedChatMessage, type FormattedChatLinkResolver } from "./FormattedChatMessage";

/** Contact details become clear actions even when the model accidentally emits a
 * bare URL or address instead of Markdown. Other web links must be Markdown links. */
const CONTACT_ROUTE_RE = /https:\/\/(?:www\.)?dbcinemarentals\.com\/contact\/?(?:[?#][^\s<>()]*)?/i;

export function hasChatContactAction(text: string): boolean {
  return CONTACT_ROUTE_RE.test(text) || text.toLowerCase().includes(CONTACT_EMAIL.toLowerCase());
}

const resolveGafferLink: FormattedChatLinkResolver = (rawUrl, suppliedLabel, isMarkdownLink) => {
  const isBareBusinessEmail = rawUrl.trim().toLowerCase() === CONTACT_EMAIL.toLowerCase();
  const url = isBareBusinessEmail ? new URL(`mailto:${CONTACT_EMAIL}`) : approvedChatLink(rawUrl);
  if (!url) return null;
  const safeHostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (safeHostname === "dbcinemarentals.com" && /^\/(?:admin|api)(?:\/|$)/i.test(url.pathname)) return null;
  const isEmail = url.protocol === "mailto:";
  const hostname = safeHostname;
  const pathname = url.pathname.replace(/\/$/, "");
  const isContact = hostname === "dbcinemarentals.com" && pathname === "/contact";
  const isFirstParty = hostname === "dbcinemarentals.com";
  const isStripe = hostname === "checkout.stripe.com";
  const isDidit = hostname === "verify.didit.me" || hostname === "verification.didit.me";
  const isMaps = hostname === "maps.google.com" || hostname === "google.com" && /^\/maps(?:\/|$)/.test(pathname);
  const href = isContact ? "/contact" : isFirstParty ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  const label = suppliedLabel?.trim().slice(0, 72) || (isEmail ? "Email the team" : isContact ? "Open contact form" : isStripe ? "Open secure payment" : isDidit ? "Continue verification" : isMaps ? "Open map" : isFirstParty ? "Open DB Cinema page" : "Open approved link");
  const openInNewTab = !isEmail && !isFirstParty;
  return {
    href,
    label,
    kind: isEmail ? "email" : "action",
    ariaLabel: openInNewTab ? `Open ${label} in a new tab` : label,
    subject: isEmail ? url.searchParams.get("subject") ?? undefined : undefined,
    openInNewTab,
  };
};

/** Hold a half-written `[label](url)` back rather than typing raw markdown out one
 * character at a time — it reveals as a finished link the moment the `)` lands. */
function trimPartialLink(s: string): string {
  const open = s.lastIndexOf("[");
  if (open === -1) return s;
  const tail = s.slice(open);
  if (tail.includes(")") || tail.includes("\n")) return s; // finished, or just a stray bracket
  return s.slice(0, open);
}

/** Typewriter stream with blinking caret. */
export function Stream({ text, speed = 2, onComplete }: { text: string; speed?: number; onComplete?: () => void }) {
  const [n, setN] = useState(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  useEffect(() => {
    setN(0);
    if (!text) { onCompleteRef.current?.(); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(text.length);
      onCompleteRef.current?.();
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += speed;
      setN(i);
      if (i >= text.length) {
        clearInterval(id);
        onCompleteRef.current?.();
      }
    }, 16);
    return () => clearInterval(id);
  }, [text, speed]);
  const live = n < text.length;
  return (
    <>
      <FormattedChatMessage text={trimPartialLink(text.slice(0, n))} resolveLink={resolveGafferLink} tone="gaffer" />
      {live && <span className="ml-0.5 inline-block h-3.5 w-[7px] animate-pulse rounded-[1px] bg-accent-400/80 align-middle" />}
    </>
  );
}

/** Chat bubble — assistant gets the Gaffer avatar beside a glass bubble,
 * user gets an accent gradient bubble on the right. */
export function ChatBubble({
  role,
  text,
  stream = false,
  mood = "idle",
  children,
  onStreamComplete,
}: {
  role: "user" | "assistant";
  text?: string;
  stream?: boolean;
  mood?: BotMood;
  children?: ReactNode;
  onStreamComplete?: () => void;
}) {
  const mine = role === "user";
  if (mine)
    return (
      <div className="msg-right flex justify-end">
        <div className="min-w-0 max-w-[85%] break-words [overflow-wrap:anywhere] rounded-2xl rounded-br-md bg-gradient-to-br from-accent-500 to-accent-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-[0_6px_20px_-8px_color-mix(in_srgb,var(--color-accent-500)_70%,transparent)]">
          {text != null ? <FormattedChatMessage text={text} tone="gaffer" linkMode="literal" /> : null}
        </div>
      </div>
    );
  return (
    <div className="msg-left min-w-0">
      <div className="w-full min-w-0 max-w-[34rem] [overflow-wrap:anywhere]">
        <div className="mb-2.5 flex min-h-8 items-center gap-2.5"><BotAvatarBadge mood={mood} size={30} /><div className="min-w-0 leading-tight"><span className="block text-sm font-semibold text-white">Gaffer</span><span className="block text-[11px] text-white/60">Rental assistant</span></div></div>
        <div className="whitespace-pre-wrap rounded-[22px] rounded-tl-md border border-[#d9c7ab]/20 bg-[radial-gradient(ellipse_at_100%_100%,rgba(155,105,55,.16),transparent_50%),linear-gradient(145deg,#2b2d30,#191a1d_55%,#1e1c1b)] px-4 py-4 text-sm leading-relaxed text-white/90 shadow-[inset_0_1px_rgba(255,255,255,.1),0_16px_42px_rgba(0,0,0,.24)] sm:px-5 sm:py-5">
          {text != null ? (stream ? <Stream text={text} onComplete={onStreamComplete} /> : <FormattedChatMessage text={text} resolveLink={resolveGafferLink} tone="gaffer" />) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

const THINKING = ["sizing up the shot…", "checking the shelves…", "matching mounts…", "running the numbers…"];

/** Animated typing indicator with rotating status line. */
export function TypingIndicator({ label }: { label?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % THINKING.length), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="msg-left flex items-end gap-2.5">
      <BotAvatarBadge mood="thinking" size={30} className="mb-0.5" />
      <div className="flex items-center gap-2.5 rounded-2xl rounded-bl-md border border-white/[0.07] bg-white/[0.045] px-4 py-3">
        <span className="flex items-center gap-1">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
          {label ?? THINKING[i]}
        </span>
      </div>
    </div>
  );
}

/** Quick-reply chips, staggered in. */
export function Chips({
  opts,
  onPick,
  className = "",
  compactMobile = false,
}: {
  opts: string[];
  onPick: (v: string) => void;
  className?: string;
  compactMobile?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap gap-1.5 ${compactMobile ? "max-[640px]:flex-nowrap max-[640px]:overflow-x-auto max-[640px]:overscroll-x-contain max-[640px]:touch-pan-x max-[640px]:pb-1" : ""} ${className}`}
      role={compactMobile ? "group" : undefined}
      aria-label={compactMobile ? "Suggested replies. Swipe or scroll horizontally for more." : undefined}
    >
      {opts.map((s, i) => (
        <button
          key={s}
          onClick={() => onPick(s)}
          className={`chip-in inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70 transition-all hover:border-accent-400/50 hover:bg-accent-500/10 hover:text-white sm:min-h-9 ${compactMobile ? "max-[640px]:shrink-0 max-[640px]:whitespace-nowrap" : ""}`}
          style={{ animationDelay: `${i * 55}ms` }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
