"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { SiteHeader } from "@/components/SiteHeader";

export default function ContactPage() {
  const submit = useMutation(api.contact.submit);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const valid = name.trim() && /\S+@\S+\.\S+/.test(email) && message.trim().length > 4;

  async function send() {
    if (!valid) return;
    setBusy(true);
    try {
      await submit({ name, email, message });
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="section-window mx-auto max-w-xl px-6 py-12">
        <div className="mb-2 text-xs uppercase tracking-widest text-accent-400">
          Get in touch
        </div>
        <h1 className="font-display text-3xl font-bold text-white/90">
          Contact <span className="gradient-text">us</span>
        </h1>
        <p className="mt-2 text-white/40">
          Questions about gear, availability or delivery? Send us a message and
          we&apos;ll get back to you.
        </p>

        {sent ? (
          <div className="mt-8 rounded-2xl glass gradient-border p-6 text-center text-emerald-300">
            ✓ Message sent — we&apos;ll be in touch shortly.
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              type="email"
              className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30"
            />
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="How can we help?"
              rows={5}
              className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 outline-none placeholder:text-white/30"
            />
            <button
              onClick={send}
              disabled={!valid || busy}
              className="mt-1 rounded-full bg-accent-500 py-3 font-medium text-white transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {busy ? "Sending…" : "Send message"}
            </button>
          </div>
        )}
      </main>
    </>
  );
}
