"use client";

import { useRef, useState } from "react";
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
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);

  const url = (me as any)?.avatarUrl as string | null;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setErr("Please choose a JPEG, PNG or WebP image."); e.target.value = ""; return; }
    if (file.size > 5 * 1024 * 1024) { setErr("Image must be under 5MB."); e.target.value = ""; return; }
    setErr(null);
    setBusy(true);
    try {
      const origin = process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site");
      if (!origin) throw new Error("Photo upload is unavailable.");
      const res = await fetch(`${origin}/renter-avatar`, { method: "POST", headers: { "Content-Type": file.type, Authorization: `Bearer ${account.token!}` }, body: file });
      if (!res.ok) throw new Error("Upload failed");
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setErr(null);
    setBusy(true);
    try {
      await setAvatar({ token: account.token! });
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
        <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-[10px] font-medium text-white group-hover:flex">
          {busy ? "…" : "Change"}
        </span>
      </button>
      <div>
        <button onClick={() => inputRef.current?.click()} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs">
          {busy ? "Uploading…" : url ? "Change photo" : "Upload photo"}
        </button>
        {url && (
          <button onClick={remove} disabled={busy} className="ml-2 text-xs text-white/40 hover:text-white">
            Remove
          </button>
        )}
        {err && <div role="alert" className="mt-1 text-xs text-red-300">{err}</div>}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPick} />
    </div>
  );
}
