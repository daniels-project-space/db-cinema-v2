"use client";
import { useId, type ReactNode } from "react";
const levelFor = (tier?: string | null) =>
  ["plus", "pro", "studio"].includes(tier ?? "") ? tier! : "standard";

/** Fine light ribbons, drawn as vectors for both navigation and profile sizes. */
export function AccountFrame({ tier, children, className = "" }: {
  tier?: string | null; children: ReactNode; className?: string;
}) {
  const level = levelFor(tier), id = useId().replace(/:/g, ""), light = `${id}-light`;
  return (
    <span className={`account-frame ${className}`} data-account-frame={level}>
      <span className="account-frame-halo" aria-hidden="true" />
      <span className="account-frame-face">{children}</span>
      <svg className="account-frame-rings" viewBox="0 0 96 96" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id={light} x1="12" y1="4" x2="80" y2="92" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--frame-highlight)" stopOpacity=".1" />
            <stop offset=".3" stopColor="var(--frame-highlight)" />
            <stop offset=".65" stopColor="var(--frame-color)" stopOpacity=".35" />
            <stop offset="1" stopColor="var(--frame-highlight)" stopOpacity=".8" />
          </linearGradient>
        </defs>
        <circle cx="48" cy="48" r="38" stroke="var(--frame-color)" strokeWidth=".7" opacity=".3" />
        <g className="account-frame-ribbon">
          <path d="M21 78C-1 59 8 23 35 12C64 1 92 24 87 55C84 72 69 86 51 87" stroke={`url(#${light})`} strokeWidth="1.25" strokeLinecap="round" />
          {level !== "standard" && <path d="M75 18C97 40 82 80 55 85C26 91 2 65 11 36C16 20 29 11 44 10" stroke={`url(#${light})`} strokeWidth=".85" strokeLinecap="round" />}
          {level === "studio" && <path d="M14 68C-3 31 35-6 70 10C91 20 100 49 85 73" stroke={`url(#${light})`} strokeWidth=".7" strokeLinecap="round" opacity=".65" />}
        </g>
        <circle className="account-frame-light" cx="48" cy="48" r="38" stroke="var(--frame-highlight)" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="10 229" />
        <g className="account-frame-orbit">
          <circle cx="84" cy="32" r={level === "standard" ? ".8" : "1.2"} fill="var(--frame-highlight)" />
          {level !== "standard" && <circle cx="17" cy="72" r=".75" fill="var(--frame-color)" />}
        </g>
        {(level === "pro" || level === "studio") && <path className="account-frame-spark" d="M74 9Q74 15 80 15Q74 15 74 21Q74 15 68 15Q74 15 74 9Z" fill="var(--frame-highlight)" />}
        {level === "studio" && <path className="account-frame-spark account-frame-spark-second" d="M18 70Q18 74 22 74Q18 74 18 78Q18 74 14 74Q18 74 18 70Z" fill="var(--frame-highlight)" />}
      </svg>
    </span>
  );
}

export function AccountProfilePill({ tier, children }: { tier?: string | null; children: ReactNode }) {
  const level = levelFor(tier);
  return (
    <header className="account-profile-pill flex flex-wrap items-center gap-4 rounded-3xl p-5 sm:p-7" data-account-tier={level}>
      <span className="account-profile-rim" aria-hidden="true" />
      <span className="account-profile-light" aria-hidden="true" />
      <svg className="account-profile-ornament" viewBox="0 0 320 160" fill="none" aria-hidden="true">
        <g className="account-profile-ribbons" stroke="currentColor" strokeLinecap="round">
          <path d="M-20 131C50 164 36 18 147 27S263 136 346 70" strokeWidth=".75" />
          <path d="M-12 152C80 168 54 5 174 15S263 120 341 96" strokeWidth=".5" opacity=".55" />
          <path d="M40 176C110 110 93 15 210 39S289 145 332 128" strokeWidth=".5" opacity=".35" />
        </g>
        <path className="account-profile-star" d="M207 30Q207 38 215 38Q207 38 207 46Q207 38 199 38Q207 38 207 30Z" fill="currentColor" />
        <circle className="account-profile-star account-frame-spark-second" cx="277" cy="107" r="1.8" fill="currentColor" />
      </svg>
      {children}
    </header>
  );
}
