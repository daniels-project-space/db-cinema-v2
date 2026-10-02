"use client";
import { useId, type ReactNode } from "react";
const levelFor = (tier?: string | null) =>
  ["plus", "pro", "studio"].includes(tier ?? "") ? tier! : "standard";

/** Six original iris leaves; vector geometry stays crisp at navigation and profile sizes. */
function Iris({ className = "" }: { className?: string }) {
  return (
    <g className={className}>
      {Array.from({ length: 6 }, (_, i) => (
        <path
          key={i}
          transform={`rotate(${i * 60} 48 48)`}
          d="M48 23a25 25 0 0 1 21.65 12.5L56.66 43 48 38Z"
        />
      ))}
    </g>
  );
}

export function AccountFrame({
  tier,
  children,
  className = "",
}: {
  tier?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const level = levelFor(tier),
    id = useId().replace(/:/g, ""),
    metal = `${id}-metal`;
  return (
    <span className={`account-frame ${className}`} data-account-frame={level}>
      <span className="account-frame-halo" aria-hidden="true" />
      <span className="account-frame-face">{children}</span>
      <svg
        className="account-frame-rings"
        viewBox="0 0 96 96"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={metal}
            x1="10"
            y1="4"
            x2="78"
            y2="93"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--frame-highlight)" />
            <stop offset=".28" stopColor="var(--frame-color)" />
            <stop offset=".56" stopColor="var(--frame-shadow)" />
            <stop offset=".79" stopColor="var(--frame-color)" />
            <stop offset="1" stopColor="var(--frame-highlight)" />
          </linearGradient>
        </defs>
        <circle
          cx="48"
          cy="48"
          r="37"
          stroke={`url(#${metal})`}
          strokeWidth="2.4"
        />
        <circle
          cx="48"
          cy="48"
          r="34"
          stroke="var(--frame-color)"
          strokeWidth=".7"
          opacity=".45"
        />
        <path
          d="M29 12 17 20 9 38v20l8 18 12 8M67 12l12 8 8 18v20l-8 18-12 8"
          stroke={`url(#${metal})`}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M14 35v8m0 10v8m68-26v8m0 10v8"
          stroke="var(--frame-highlight)"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity=".8"
        />
        <circle
          className="account-frame-light"
          cx="48"
          cy="48"
          r="37"
          stroke="var(--frame-highlight)"
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeDasharray="22 211"
        />
        {level !== "standard" && (
          <circle
            className="account-frame-orbit"
            cx="48"
            cy="48"
            r="41"
            stroke="var(--frame-color)"
            strokeWidth="1"
            strokeLinecap="round"
            strokeDasharray={level === "studio" ? "16 32 4 32" : "14 115"}
            opacity=".8"
          />
        )}
        {level === "studio" && (
          <path
            className="account-frame-spark"
            d="m48 3 2.4 4.6L55 10l-4.6 2.4L48 17l-2.4-4.6L41 10l4.6-2.4Z"
            fill="var(--frame-highlight)"
          />
        )}
        {level === "pro" && (
          <path
            d="M38 9h20M41 5h14"
            stroke={`url(#${metal})`}
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
        {level === "plus" && (
          <path
            d="m42 8 6-4 6 4"
            stroke={`url(#${metal})`}
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
        <g transform="translate(36 62) scale(.25)">
          <circle
            cx="48"
            cy="48"
            r="27"
            fill="#151513"
            stroke={`url(#${metal})`}
            strokeWidth="3"
          />
          <Iris className="account-frame-iris" />
        </g>
      </svg>
    </span>
  );
}

export function AccountProfilePill({
  tier,
  children,
}: {
  tier?: string | null;
  children: ReactNode;
}) {
  const level = levelFor(tier);
  return (
    <header
      className="account-profile-pill flex flex-wrap items-center gap-4 rounded-3xl p-5 sm:p-7"
      data-account-tier={level}
    >
      <span className="account-profile-rim" aria-hidden="true" />
      <span className="account-profile-light" aria-hidden="true" />
      <svg
        className="account-profile-ornament"
        viewBox="0 0 96 96"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="48" cy="48" r="43" stroke="currentColor" strokeWidth=".5" />
        <circle
          className="account-profile-orbit"
          cx="48"
          cy="48"
          r="39"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="30 18 1 18"
        />
        <circle cx="48" cy="48" r="29" stroke="currentColor" strokeWidth=".5" />
        <Iris className="account-profile-iris" />
        <path
          d="M3 48h9m72 0h9M48 3v9m0 72v9"
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
      <span className="account-profile-registration" aria-hidden="true">
        DB /{" "}
        {level === "standard"
          ? "MEMBER"
          : level === "plus"
            ? "STARTER"
            : level.toUpperCase()}
      </span>
      {children}
    </header>
  );
}
