"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function PrivatePortraitOnboarding({ token }: { token: string }) {
  const prompt = useQuery(api.privateVerificationPortrait.onboarding, { token });
  const save = useMutation(api.privateVerificationPortrait.setPreference);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!prompt) return null;
  async function choose(allowed: boolean) {
    if (!prompt || busy) return;
    setBusy(true); setError(false);
    try { await save({ token, allowed, noticeVersion: prompt.noticeVersion, expectedRevision: prompt.revision }); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  return <aside aria-labelledby="portrait-choice-title" className="fixed bottom-4 left-4 right-4 z-[90] ml-auto max-w-md rounded-2xl border border-[#c59b6b]/35 bg-[#171614] p-5 text-white shadow-2xl sm:bottom-6 sm:right-6">
    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#d7ad79]">Your privacy · optional</p>
    <h2 id="portrait-choice-title" className="mt-2 text-base font-semibold">A private photo for our team?</h2>
    <p className="mt-2 text-sm leading-6 text-white/70">Optional: if you agree, our team may privately see your approved verification selfie beside your account after 24 hours if you have not added a profile photo. It is never published and is not needed to rent. Your existing photo takes priority; you can withdraw permission in Account Security.</p>
    <p className="mt-2 text-xs leading-5 text-white/50">The image follows verification-file retention: 90 days after the last linked rental closes, or 90 days after an open case closes.</p>
    <Link href="/legal/privacy" className="mt-2 inline-block text-xs text-[#e6bf90] underline">Read the privacy notice</Link>
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">Your choice was not saved. Please try again.</p>}
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void choose(true)} className="min-h-11 rounded-lg bg-[#c49a6c] px-4 text-sm font-semibold text-[#17120d] disabled:opacity-50">Allow private use</button><button type="button" disabled={busy} onClick={() => void choose(false)} className="min-h-11 rounded-lg border border-white/20 px-4 text-sm text-white disabled:opacity-50">No, thanks</button></div>
  </aside>;
}
