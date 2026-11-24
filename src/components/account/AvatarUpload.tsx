"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@cvx/_generated/api";
import { useAccount } from "@/components/account/AccountProvider";

function initials(name?: string | null, email?: string) {
  const n = (name ?? "").trim();
  if (n) {
    const p = n.split(/\s+/);
    return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || n[0]!.toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

export function AvatarUpload() {
  const account = useAccount();
  const me = account.me;
  const setAvatar = useMutation(api.accounts.setAvatar);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);

  const url = (me as any)?.avatarUrl as string | null;
  useEffect(() => { setFailedPhoto(null); }, [url]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setErr("Please choose a JPEG, PNG or WebP image."); e.target.value = ""; return; }
    if (file.size > 5 * 1024 * 1024) { setErr("Image must be under 5MB."); e.target.value = ""; return; }
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      const origin = process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site");
      if (!origin) throw new Error("Photo upload is unavailable.");
      const res = await fetch(`${origin}/renter-avatar`, { method: "POST", headers: { "Content-Type": file.type, Authorization: `Bearer ${account.token!}` }, body: file });
      if (!res.ok) throw new Error("Upload failed");
      setNotice("Photo saved to your account.");
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      await setAvatar({ token: account.token! });
      setNotice("Photo removed from your account.");
    } catch {
      setErr("Could not remove your photo. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-full ring-2 ring-white/10"
        aria-label="Change profile photo"
      >
        {url && url !== failedPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Profile" decoding="async" onError={() => setFailedPhoto(url)} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-accent-500/20 font-display text-lg font-bold text-accent-200">
            {initials(me?.name, me?.email)}
          </span>
        )}
        <span data-testid="profile-photo-hover-cue" aria-hidden="true" className="pointer-events-none absolute bottom-0.5 right-0.5 grid h-5 w-5 place-items-center rounded-full border border-white/40 bg-black/80 text-white shadow-[0_2px_8px_#000a] transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110">
          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6.5h3l1-2h5l1 2h4v9H3z"/><circle cx="10" cy="11" r="2.8"/></svg>
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <button onClick={() => inputRef.current?.click()} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs">
          {busy ? "Uploading…" : url ? "Change photo" : "Upload photo"}
        </button>
        {url && (
          <button onClick={remove} disabled={busy} className="ml-2 text-xs text-white/40 hover:text-white">
            Remove
          </button>
        )}
        {err && <div role="alert" className="mt-1 text-xs text-red-300">{err}</div>}
        {notice && <p data-testid="profile-photo-saved" role="status" className="mt-1 text-xs text-emerald-200">{notice}</p>}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a profile photo" className="hidden" onChange={onPick} />
    </div>
  );
}
