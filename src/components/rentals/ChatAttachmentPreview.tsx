"use client";

import { useEffect, useRef, useState } from "react";
import { CHAT_ATTACHMENT_LIMIT } from "../../../shared/chatAttachmentPolicy";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function endpoint(scope: { bookingId?: string; accountId?: string; admin?: boolean }, key: string, value: string) {
  const origin = process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site");
  if (!origin) throw Error("Attachment is unavailable.");
  const params = new URLSearchParams({ ...(scope.bookingId ? { bookingId: scope.bookingId } : {}), ...(scope.accountId ? { accountId: scope.accountId } : {}), ...(scope.admin ? { admin: "1" } : {}), [key]: value });
  return `${origin}/chat-attachment?${params}`;
}

export function ChatAttachmentPreview({ token, id, name, contentType, bookingId, accountId, admin }: {
  token: string; id: string; name: string; contentType?: string; bookingId?: string; accountId?: string; admin: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "unavailable">("idle");
  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "unavailable">("idle");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const isImage = contentType ? IMAGE_TYPES.has(contentType) : true;

  useEffect(() => {
    if (!isImage) return;
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const load = async () => {
      setState("loading");
      try {
        const response = await fetch(endpoint({ bookingId, accountId, admin }, "preview", id), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw Error("Unavailable");
        const blob = await response.blob();
        if (!IMAGE_TYPES.has(blob.type) || !blob.size || blob.size > CHAT_ATTACHMENT_LIMIT) throw Error("Unsupported image");
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
        setState("idle");
      } catch {
        if (!cancelled) setState("unavailable");
      }
    };
    if (typeof IntersectionObserver === "undefined") void load();
    else {
      const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); } }, { rootMargin: "160px 0px" });
      observer.observe(element);
      return () => { cancelled = true; observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, token, bookingId, accountId, admin, isImage, previewAttempt]);

  async function download() {
    if (downloadState === "loading") return;
    setDownloadState("loading");
    try {
      const response = await fetch(endpoint({ bookingId, accountId, admin }, "download", id), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw Error("Unavailable");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setDownloadState("idle");
    } catch {
      setDownloadState("unavailable");
    }
  }

  return <div ref={host} className="mt-3 grid max-w-full gap-2" data-testid={`chat-attachment-${id}`}>
    {imageUrl ? <a href={imageUrl} target="_blank" rel="noreferrer" aria-label={`Open ${name}`} className="block max-w-full overflow-hidden rounded-xl border border-white/10 bg-black/20"><img src={imageUrl} alt={name} loading="lazy" className="max-h-64 max-w-full object-contain" /></a> : <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/15 p-2.5 text-xs text-white/65">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[.04]" aria-hidden="true">▧</span>
      <span className="min-w-0 flex-1 truncate">{state === "loading" ? "Loading image…" : state === "unavailable" ? (isImage ? "Image unavailable" : "File unavailable") : name}</span>
    </div>}
    <span data-testid="chat-attachment-security-checked" className="inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-200/15 bg-emerald-200/[.05] px-2.5 py-1 text-[10px] font-medium text-emerald-100/75"><span aria-hidden="true">✓</span>Security checked</span>
    {isImage && state === "unavailable" && <button type="button" onClick={() => setPreviewAttempt(attempt => attempt + 1)} className="min-h-9 w-fit rounded-full border border-current/20 px-3 py-1 text-xs">Retry preview</button>}
    {downloadState === "unavailable" && <p role="status" className="text-xs text-white/55">Download unavailable. Your file is still in the chat.</p>}
    <button type="button" disabled={downloadState === "loading"} onClick={() => void download()} className="min-h-9 w-fit rounded-full border border-current/20 px-3 py-1 text-xs disabled:opacity-50">{downloadState === "loading" ? "Preparing download…" : downloadState === "unavailable" ? "Retry download" : `Download ${isImage ? "image" : "file"}`}</button>
  </div>;
}
