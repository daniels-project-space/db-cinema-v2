"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@cvx/_generated/api";

export function PrivatePortraitPreference({ token }: { token: string }) {
  const preference = useQuery(api.privateVerificationPortrait.preference, { token });
  const setPreference = useMutation(api.privateVerificationPortrait.setPreference);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!preference) return null;

  async function change(allowed: boolean) {
    if (!preference) return;
    setBusy(true);
    setError(null);
    try {
      await setPreference({ token, allowed, noticeVersion: preference.noticeVersion, expectedRevision: preference.revision });
    } catch {
      setError("Your preference could not be saved. Refresh this page and try again.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="spot mt-6 rounded-2xl p-6" aria-labelledby="private-portrait-title">
    <h2 id="private-portrait-title" className="font-display text-lg font-semibold text-white/90">Private verification photo</h2>
    <p className="mt-2 text-sm leading-6 text-white/65">If you choose to allow it, and have not added a profile photo 24 hours after creating your account, our team may privately see your approved verification selfie beside your account. It is never published, is not needed to rent, and your existing profile photo takes priority. You can withdraw permission here at any time.</p>
    <p className="mt-2 text-xs leading-5 text-white/50">The image follows verification-file retention: 90 days after the last linked rental closes, or 90 days after an open case closes. <Link href="/legal/privacy" className="text-accent-300 underline">Read our privacy notice</Link>.</p>
    <p className="mt-3 text-sm text-white/75">Current choice: {preference.allowed ? "Allowed" : "Not allowed"}</p>
    {!preference.allowed && preference.previousConsent && <p className="mt-2 text-xs text-white/60">Your previous permission is not active under the current notice. You can withdraw it or review and allow the current notice.</p>}
    {(preference.allowed || preference.previousConsent) && <button type="button" disabled={busy} onClick={() => void change(false)} className="mt-3 rounded-lg border border-white/20 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "Saving…" : "Withdraw permission"}</button>}
    {!preference.allowed && preference.canAllow && <button type="button" disabled={busy} onClick={() => void change(true)} className="mt-3 mr-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "Saving…" : "Allow private use"}</button>}
    {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
  </section>;
}
