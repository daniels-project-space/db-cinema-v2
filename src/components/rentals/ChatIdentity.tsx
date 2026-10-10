"use client";
import { useEffect, useState } from "react";

export function GafferIcon({ className = "h-5 w-5" }: { className?: string }) {
  return <svg role="img" aria-label="Gaffer" viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 17v-3a10 10 0 0120 0v3M9 12h14M12 8l2 4m4-4l-2 4"/>
    <rect x="4" y="16" width="5" height="9" rx="2"/><rect x="23" y="16" width="5" height="9" rx="2"/>
    <path d="M23 25c0 3-3 3-6 3M13 20h6"/><circle cx="12" cy="16" r=".8"/><circle cx="20" cy="16" r=".8"/>
  </svg>;
}

export function ChatAvatar({ sender, name, photo, className = "" }: { sender: string; name?: string | null; photo?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo]);
  const base = `flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`;
  if (sender === "bot") return <span className={`${base} bg-emerald-300/15 text-emerald-200`}><GafferIcon /></span>;
  if (sender === "owner") return <span className={`${base} bg-white/10`}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/db-cinema-logo-512.png" alt="DB Cinema team" className="h-full w-full object-contain" />
  </span>;
  if (sender === "system") return <span className={`${base} border border-sky-200/20 bg-sky-300/10 text-sky-200`} aria-label="Automatic rental update"><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4m8-4v4M4 10h16m-10 4 2 2 4-4"/></svg></span>;
  return <span className={`${base} rounded-full bg-violet-300/15 text-xs font-semibold text-violet-200`}>
    {photo && !failed ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photo} alt={name ?? "Renter"} onError={() => setFailed(true)} className="h-full w-full object-cover" />
    ) : (name?.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase() || "R")}
  </span>;
}
