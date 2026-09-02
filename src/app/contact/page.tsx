"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHero } from "@/components/PageHero";
import { IconCheck, IconClock, IconPin, IconSend } from "@/components/icons";
import { HOURS_WINDOWS } from "@/lib/site";
import { EmailLink } from "@/components/EmailLink";
import { AskGaffer } from "@/components/gaffer/AskGaffer";

export default function ContactPage() {
  const submit = useMutation(api.contact.submit);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hp, setHp] = useState(""); // honeypot

  const valid = name.trim() && /\S+@\S+\.\S+/.test(email) && message.trim().length > 4;

  async function send() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      await submit({ name, email, message, hp });
      setSent(true);
    } catch (e: any) {
      const m = String(e?.message || "").match(/Uncaught Error:\s*(.+?)(?:\n|$)/);
      setErr(m ? m[1] : "Sorry, we couldn't send that — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-4xl px-6 py-14">
        <PageHero
          eyebrow="Get in touch"
          lead="Contact"
          accent="us"
          sub="Questions about gear, availability or delivery? Send us a message and we'll get back to you."
        />

        <div className="mt-10 grid gap-8 md:grid-cols-[1fr_260px]">
          <div>
            {sent ? (
              <div className="spot gradient-border card-in rounded-2xl p-8 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                  <IconCheck className="h-6 w-6" />
                </span>
                <p className="mt-4 font-display text-lg font-semibold text-white/90">Message sent</p>
                <p className="mt-1 text-sm text-white/45">We&apos;ll be in touch shortly.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="hud-label mb-1.5 block" htmlFor="c-name">Your name</label>
                  <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className="input w-full" />
                </div>
                <div>
                  <label className="hud-label mb-1.5 block" htmlFor="c-email">Email</label>
                  <input id="c-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" type="email" className="input w-full" />
                </div>
                <div>
                  <label className="hud-label mb-1.5 block" htmlFor="c-msg">Message</label>
                  <textarea id="c-msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="How can we help?" rows={5} className="input w-full" />
                </div>
                <input
                  type="text"
                  name="company"
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
                />
                <button onClick={send} disabled={!valid || busy} className="btn-primary mt-1 py-3">
                  {busy ? "Sending…" : "Send message"}
                </button>
                {err && <p className="text-sm text-rose-300">{err}</p>}
              </div>
            )}
          </div>

          <aside className="flex h-fit flex-col gap-3">
            <div className="spot rounded-2xl p-5">
              <div className="flex items-center gap-2.5">
                <IconSend className="h-4 w-4 text-accent-400" />
                <span className="hud-label !text-white/60">Email</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                <EmailLink className="break-all transition-colors hover:text-white" />
                <br />
                <span className="text-white/35">we reply within a day</span>
              </p>
            </div>
            <div className="spot rounded-2xl p-5">
              <div className="flex items-center gap-2.5">
                <IconClock className="h-4 w-4 text-accent-400" />
                <span className="hud-label !text-white/60">Hours</span>
              </div>
              <p className="mt-2 font-mono text-sm leading-relaxed text-white/60">
                {HOURS_WINDOWS.map((w) => (
                  <span key={w.opens}>
                    {w.opens}–{w.closes}
                    <br />
                  </span>
                ))}
                <span className="text-white/35">every day</span>
              </p>
            </div>
            <div className="spot rounded-2xl p-5">
              <div className="flex items-center gap-2.5">
                <IconPin className="h-4 w-4 text-accent-400" />
                <span className="hud-label !text-white/60">Where</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                Central London pickup
                <br />
                <span className="text-white/35">+ local delivery ~30km</span>
              </p>
            </div>
          </aside>
        </div>
        <AskGaffer
          className="mt-10"
          title="Don't fancy typing it out?"
          blurb="Ask Gaffer instead. It can answer most things on the spot, and takes your details across to us if it can't."
        />
      </main>
    </>
  );
}
