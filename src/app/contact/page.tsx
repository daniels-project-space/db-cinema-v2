"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";
import Link from "next/link";
import { useAccount } from "@/components/account/AccountProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHero } from "@/components/PageHero";
import { IconCheck, IconClock, IconPin, IconSend } from "@/components/icons";
import { HOURS_WINDOWS } from "@/lib/site";
import { EmailLink } from "@/components/EmailLink";
import { AskGaffer } from "@/components/gaffer/AskGaffer";
import { OpenGafferChat } from "@/components/gaffer/OpenGafferChat";
import { legalVersionForPolicy, CURRENT_PRIVACY_NOTICE_VERSION } from "../../../shared/legalVersioning";
import { createClientRequestId } from "@/lib/clientRequestId";
import { ChatErrorBoundary } from "@/components/rentals/ChatErrorBoundary";
import { BUSINESS_CONTACT_EMAIL } from "../../../shared/businessEmail";
import { renterFacingError } from "@/lib/renterFacingError";

export default function ContactPage() {
  const submit = useMutation(api.contact.submit);
  const sendToAccountChat = useMutation(api.chat.send);
  const { token, me, signUp, loading: accountLoading } = useAccount();
  const [creating, setCreating] = useState(false);
  const accountPolicy = useQuery(api.settings.get, creating ? {} : "skip");
  const termsVersion = accountPolicy ? legalVersionForPolicy(accountPolicy) : null;
  const [termsAndPrivacyAcknowledged, setTermsAndPrivacyAcknowledged] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hp, setHp] = useState(""); // honeypot
  const contactAttempt = useRef<{ fingerprint: string; requestId: string } | null>(null);

  useEffect(() => {
    if (!accountLoading && !nameTouched) setName(me?.name ?? "");
  }, [accountLoading, me?.name, nameTouched]);

  useEffect(() => {
    if (!accountLoading && !emailTouched) setEmail(me?.email ?? "");
  }, [accountLoading, me?.email, emailTouched]);

  const valid = name.trim() && /\S+@\S+\.\S+/.test(email) && message.trim().length > 4;

  async function send() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const fingerprint = me && token
        ? "account:" + message.trim()
        : JSON.stringify([name.trim(), email.trim().toLowerCase(), message.trim()]);
      let attempt = contactAttempt.current;
      if (!attempt || attempt.fingerprint !== fingerprint) {
        attempt = { fingerprint, requestId: createClientRequestId() };
        contactAttempt.current = attempt;
      }
      if (me && token) {
        await sendToAccountChat({ token, text: message, requestId: attempt.requestId });
      } else {
        const result = await submit({ name, email, message, hp, requestId: attempt.requestId });
        if (!result?.id) throw new Error("We couldn't confirm your message was received. Please use the email option below.");
      }
      contactAttempt.current = null;
      setSent(true);
    } catch (e: any) {
      setErr(renterFacingError(e, "We couldn't confirm it was received. Please retry; duplicate messages are prevented."));
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
          sub="Questions about gear, availability or delivery? Gaffer can help with live stock, rental quotes and your booking."
        />

        <div className="mt-8"><ChatErrorBoundary fallbackHref={`mailto:${BUSINESS_CONTACT_EMAIL}`} fallbackLabel="Email support"><OpenGafferChat /></ChatErrorBoundary></div>

        <div className="mt-10 grid gap-8 md:grid-cols-[1fr_260px]">
          <div>
            {sent ? (
              <div className="spot gradient-border card-in rounded-2xl p-8 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                  <IconCheck className="h-6 w-6" />
                </span>
                <p className="mt-4 font-display text-lg font-semibold text-white/90">Message received</p>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{me ? "Your message is in account support. Gaffer will try to help first; the team can follow up in this chat." : `Your enquiry is in the support inbox. Gaffer will try to answer ${email} first; if it cannot, the team can follow up.`}</p>
                {me ? <Link href="/account?conversation=general#chat" className="btn-primary mt-6 py-3">Continue in your Gaffer chat →</Link> : !creating ? <button type="button" className="btn-primary mt-6 py-3" onClick={() => { setTermsAndPrivacyAcknowledged(false); setCreating(true); }}>Create an account &amp; start a Gaffer chat</button> : confirmationSent ? <div className="mt-6 rounded-xl border border-accent-300/20 bg-accent-500/10 p-4 text-sm text-white/75" role="status">Check {email} for your confirmation link. Confirm once to activate your password, then start a Gaffer chat from your account.</div> : <form className="mt-6 space-y-3 text-left" onSubmit={async event => {
                  event.preventDefault(); setBusy(true); setErr(null);
                  try {
                    if (!termsAndPrivacyAcknowledged || !termsVersion) throw new Error("Please agree to the current Terms and Conditions and read the Privacy Notice.");
                    await signUp(email, password, name, "chat", undefined, { termsVersion, privacyNoticeVersion: CURRENT_PRIVACY_NOTICE_VERSION });
                    setConfirmationSent(true);
                  }
                  catch { setErr("Couldn’t create the account. If you already have one, sign in below with this email."); }
                  finally { setBusy(false); }
                }}>
                  <p className="text-sm text-white/65">{name} · {email}</p>
                  <label htmlFor="contact-account-password" className="hud-label block">Choose a password</label>
                  <input id="contact-account-password" type="password" autoComplete="new-password" minLength={8} maxLength={256} placeholder="8 to 256 characters" required value={password} onChange={event => setPassword(event.target.value)} className="input w-full" />
                  <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3 text-xs leading-5 text-white/65">
                    <input type="checkbox" checked={termsAndPrivacyAcknowledged} onChange={event => setTermsAndPrivacyAcknowledged(event.target.checked)} disabled={!termsVersion} required className="mt-1 h-4 w-4 shrink-0 accent-[#c49a6c]" />
                    <span>I agree to the current <Link href={termsVersion ? `/legal/terms?version=${encodeURIComponent(termsVersion)}` : "/legal/terms"} target="_blank" rel="noreferrer" className="text-accent-300 underline underline-offset-2">Terms and Conditions</Link> and acknowledge the <Link href="/legal/privacy" target="_blank" rel="noreferrer" className="text-accent-300 underline underline-offset-2">Privacy Notice</Link>.</span>
                  </label>
                  <button type="submit" className="btn-primary w-full py-3" disabled={busy || password.length < 8 || password.length > 256 || !termsAndPrivacyAcknowledged || !termsVersion}>{busy ? "Creating…" : "Save password & create account"}</button>
                  <p className="text-xs leading-relaxed text-white/45">Confirm your email to keep your conversation private. Your name and email are already filled in.</p>
                  <Link className="block text-sm text-accent-300" href="/account?conversation=general#chat">Already have an account? Sign in →</Link>
                </form>}
                {err && <p role="alert" className="mt-3 text-sm text-rose-300">{err}</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="hud-label mb-1.5 block" htmlFor="c-name">Your name</label>
                  <input id="c-name" value={name} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} placeholder="Jane Doe" autoComplete="name" className="input w-full" />
                </div>
                <div>
                  <label className="hud-label mb-1.5 block" htmlFor="c-email">Email</label>
                  <input id="c-email" value={email} onChange={(e) => { setEmailTouched(true); setEmail(e.target.value); }} placeholder="you@email.com" type="email" autoComplete="email" className="input w-full" />
                </div>
                <div>
                  <label className="hud-label mb-1.5 block" htmlFor="c-msg">Message</label>
                  <textarea id="c-msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="How can we help?" rows={5} maxLength={2000} className="input w-full" />
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
                {err && <p role="alert" className="text-sm text-rose-300">{err} <EmailLink className="ml-2 underline underline-offset-2" label="Email support instead" /></p>}
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
                <span className="hud-label !text-white/60">In-person collection</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                Trafalgar Square, London
                <span className="mt-2 block text-white/45">We share the exact meeting point after payment, verification and booking confirmation.</span>
                <span className="mt-2 block text-white/35">Ask Gaffer to check delivery for your address and dates.</span>
              </p>
            </div>
          </aside>
        </div>
        <ChatErrorBoundary fallbackHref={`mailto:${BUSINESS_CONTACT_EMAIL}`} fallbackLabel="Email support">
          <AskGaffer
            className="mt-10"
            title="Don't fancy typing it out?"
            blurb="Ask Gaffer instead. It can answer most things on the spot, and takes your details across to us if it can't."
          />
        </ChatErrorBoundary>
      </main>
    </>
  );
}
