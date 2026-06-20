"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BotAvatarBadge, type BotMood } from "./BotAvatar";

/** Inline **bold** segments → styled spans. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
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
      {richText(text.slice(0, n))}
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
}: {
  opts: string[];
  onPick: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {opts.map((s, i) => (
        <button
          key={s}
          onClick={() => onPick(s)}
          className="chip-in rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70 transition-all hover:border-accent-400/50 hover:bg-accent-500/10 hover:text-white"
          style={{ animationDelay: `${i * 55}ms` }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
