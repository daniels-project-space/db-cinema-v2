"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BotAvatarBadge, type BotMood } from "./BotAvatar";
import { CONTACT_EMAIL } from "@/lib/site";

/** Inline **bold** segments → styled spans. */
function bold(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}b${i}`} className="font-semibold text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

/** Contact details become clear actions even when the model accidentally emits a
 * bare URL or address instead of Markdown. Other web links must be Markdown links. */
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|(https?:\/\/[^\s<>()]+|mailto:[^\s<>()]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
const CONTACT_ACTION_RE = /(?:https?:\/\/(?:www\.)?dbcinemarentals\.com\/contact\/?(?:[?#][^\s<>()]*)?|mailto:bookings@dbcinemarentals\.com|bookings@dbcinemarentals\.com)/i;
function chatLink(raw: string): { href: string; kind: "contact" | "email" | "external" } | null {
  if (raw.toLowerCase() === CONTACT_EMAIL.toLowerCase()) {
    return { href: `mailto:${CONTACT_EMAIL}`, kind: "email" };
  }
  if (raw.toLowerCase().startsWith("mailto:")) {
    const address = raw.slice("mailto:".length).split("?")[0].toLowerCase();
    if (address !== CONTACT_EMAIL.toLowerCase()) return null;
    return { href: `mailto:${CONTACT_EMAIL}`, kind: "email" };
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (["dbcinemarentals.com", "www.dbcinemarentals.com"].includes(url.hostname.toLowerCase()) && url.pathname.replace(/\/$/, "") === "/contact") {
      return { href: "/contact", kind: "contact" };
    }
    return { href: raw, kind: "external" };
  } catch {
    return null;
  }
}

export function hasChatContactAction(text: string): boolean {
  return CONTACT_ACTION_RE.test(text);
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...bold(text.slice(last, at), `t${at}`));
    const isMarkdown = m[1] !== undefined;
    const matchedRaw = m[2] ?? m[3];
    const raw = isMarkdown ? matchedRaw : matchedRaw.replace(/[.,!;:]+$/, "");
    const trailing = isMarkdown ? "" : matchedRaw.slice(raw.length);
    const label = m[1] ?? (raw.toLowerCase().includes("@") ? "Email the team" : "Open contact form");
    const link = chatLink(raw);
    if (!link) {
      out.push(...bold(isMarkdown ? label : matchedRaw, `t${at}`));
      last = at + m[0].length;
      continue;
    }
    if (!isMarkdown && link.kind === "external") {
      out.push(matchedRaw);
      last = at + m[0].length;
      continue;
    }
    const action = link.kind !== "external";
    out.push(
      <a
        key={`l${at}`}
        href={link.href}
        {...(link.kind === "external" ? { target: "_blank", rel: "noreferrer" } : {})}
        className={action
          ? "my-1 inline-flex min-h-9 items-center rounded-xl border border-accent-200/30 bg-gradient-to-br from-accent-300/20 to-accent-500/10 px-3 py-1.5 font-semibold text-accent-100 no-underline shadow-[0_6px_20px_-12px_rgba(224,170,104,0.7)] transition hover:border-accent-200/55 hover:from-accent-300/30 hover:to-accent-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-200/70"
          : "font-medium text-accent-300 underline decoration-accent-400/40 underline-offset-2 transition-colors hover:text-accent-200 hover:decoration-accent-300"}
      >
        {label}
      </a>,
    );
    if (trailing) out.push(...bold(trailing, `t${at}tail`));
    last = at + m[0].length;
  }
  if (last < text.length) out.push(...bold(text.slice(last), `t${last}`));
  return out;
}

/** Structured formatting: line breaks become real lines and `- `/`• ` lines become
 * bullet rows, so Gaffer's replies read as scannable lists instead of one block. */
function richText(text: string): ReactNode[] {
  return text.split(/\n/).map((line, i) => {
    const bullet = line.match(/^\s*[-•]\s+(.*)/);
    if (bullet)
      return (
        <span key={i} className="flex gap-1.5">
          <span className="select-none text-accent-400/80">•</span>
          <span className="min-w-0">{inline(bullet[1])}</span>
        </span>
      );
    if (line.trim() === "") return <span key={i} className="block h-1.5" aria-hidden />;
    return (
      <span key={i} className="block">
        {inline(line)}
      </span>
    );
  });
}

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
export function Stream({ text, speed = 2 }: { text: string; speed?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(text.length);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += speed;
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [text, speed]);
  const live = n < text.length;
  return (
    <>
      {richText(trimPartialLink(text.slice(0, n)))}
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
}: {
  role: "user" | "assistant";
  text?: string;
  stream?: boolean;
  mood?: BotMood;
  children?: ReactNode;
}) {
  const mine = role === "user";
  if (mine)
    return (
      <div className="msg-right flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-accent-500 to-accent-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-[0_6px_20px_-8px_color-mix(in_srgb,var(--color-accent-500)_70%,transparent)]">
          {text}
        </div>
      </div>
    );
  return (
    <div className="msg-left flex items-end gap-2.5">
      <BotAvatarBadge mood={mood} size={30} className="mb-0.5" />
      <div className="min-w-0 max-w-[85%]">
        <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-white/[0.07] bg-white/[0.045] px-4 py-2.5 text-sm leading-relaxed text-white/85">
          {text != null ? (stream ? <Stream text={text} /> : richText(text)) : null}
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
