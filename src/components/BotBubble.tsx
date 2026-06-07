"use client";

import { useState, useRef, useEffect } from "react";

type Msg = { role: "user" | "assistant"; content: string };
const GREETING =
  "Hi! I'm the Db Cinema assistant 🎬 Ask me about gear, prices, availability or delivery — or tell me what you're shooting and I'll suggest a kit.";

export function BotBubble() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = localStorage.getItem("dbc_bot");
    if (raw) try { setMsgs(JSON.parse(raw)); } catch {}
  }, []);
  useEffect(() => {
    if (msgs.length) localStorage.setItem("dbc_bot", JSON.stringify(msgs.slice(-30)));
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    const next = [...msgs, { role: "user", content: t } as Msg];
    setMsgs(next);
    setText("");
    setBusy(true);
    try {
      const r = await fetch("/api/bot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const d = await r.json();
      setMsgs((m) => [...m, { role: "assistant", content: d.reply || "…" }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Connection hiccup — please try again." }]);
    } finally {
      setBusy(false);
    }
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
        <div className="toast-in fixed bottom-24 right-5 z-50 flex h-[70vh] max-h-[560px] w-[92vw] max-w-sm flex-col overflow-hidden rounded-3xl border border-white/10 bg-charcoal-900/95 shadow-2xl backdrop-blur-xl">
          <header className="flex items-center gap-3 border-b border-white/5 bg-white/[0.03] px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-500/20 text-lg">🎬</div>
            <div>
              <div className="text-sm font-semibold text-white/90">Db Cinema assistant</div>
              <div className="text-[11px] text-emerald-400">● online</div>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.length === 0 && <Bubble role="assistant" text={GREETING} />}
            {msgs.map((m, i) => (
              <Bubble key={i} role={m.role} text={m.content} />
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl glass px-4 py-2 text-sm text-white/40">typing…</div>
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
                placeholder="Ask about gear, prices, dates…"
                className="flex-1 rounded-full bg-white/[0.05] px-4 py-2.5 text-sm text-white/85 outline-none placeholder:text-white/30"
              />
              <button
                onClick={send}
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
