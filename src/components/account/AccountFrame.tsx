import type { ReactNode } from "react";
const levelFor = (tier?: string | null) =>
  ["plus", "pro", "studio"].includes(tier ?? "") ? tier! : "standard";
function Crest({ level }: { level: string }) {
  if (level === "plus")
    return (
      <>
        <path d="m38 4 5 6-5 6-5-6Z" />
        <path d="M29 10h-6l-4 4m28-4h6l4 4" fill="none" />
      </>
    );
  if (level === "pro")
    return (
      <>
        <path d="m38 1 5 8 9-3-5 12H29L24 6l9 3Z" />
        <path d="M32 20h12" fill="none" />
      </>
    );
  if (level === "studio")
    return (
      <>
        <path d="m38 0 4 7 8-3-4 10 8 3-11 3-5 9-5-9-11-3 8-3-4-10 8 3Z" />
        <path d="m38 8 3 6-3 5-3-5Z" fill="#15121f" stroke="none" />
      </>
    );
  return <path d="M30 8h16m-14-3v6m12-6v6" fill="none" />;
}
/** Original film-gate metalwork; shared by navigation, profile and preview. */
export function AccountFrame({
  tier,
  children,
  className = "",
}: {
  tier?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const level = levelFor(tier);
  return (
    <span className={`account-frame ${className}`} data-account-frame={level}>
      <span className="account-frame-face">{children}</span>
      <svg
        className="account-frame-rings"
        viewBox="0 0 76 76"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="38" cy="39" r="29.5" className="account-frame-track" />
        <circle cx="38" cy="39" r="27.5" strokeWidth=".55" opacity=".6" />
        {level === "standard" && (
          <>
            <path
              d="M16 17 10 23v32l6 6m44-44 6 6v32l-6 6M20 65h36"
              strokeWidth="1.6"
            />
            <path d="M14 30v5m0 8v5m48-18v5m0 8v5" strokeWidth="2.5" />
            <circle
              cx="38"
              cy="39"
              r="31.5"
              strokeDasharray="18 32"
              opacity=".35"
            />
          </>
        )}
        {level === "plus" && (
          <>
            <path d="m21 14-9 7-5 17 5 18 11 9m32-51 9 7 5 17-5 18-11 9" />
            <path
              d="M15 24 11 38l4 14m46-28 4 14-4 14M27 69h22"
              strokeWidth=".7"
            />
            <circle
              cx="38"
              cy="39"
              r="31"
              strokeDasharray="8 16 2 18"
              className="account-frame-orbit"
            />
            <path
              d="m7 35 3 4-3 4-3-4Zm62 0 3 4-3 4-3-4Z"
              className="account-frame-gem"
            />
            <path d="m33 68 5 5 5-5" />
          </>
        )}
        {level === "pro" && (
          <>
            <path
              d="M22 10 10 20 5 39l5 19 12 9m32-57 12 10 5 19-5 19-12 9"
              strokeWidth="1.2"
            />
            <path
              d="M18 19 12 30v18l6 11m40-40 6 11v18l-6 11"
              strokeWidth=".6"
            />
            <path
              d="M8 29h4m-6 7h5m-5 7h5m-3 7h4m52-21h4m-3 7h5m-5 7h5m-6 7h4"
              strokeWidth="2.2"
            />
            <circle
              cx="38"
              cy="39"
              r="31.5"
              strokeDasharray="26 40 6 22"
              className="account-frame-orbit"
            />
            <path d="m30 67 8 7 8-7-8 3Z" className="account-frame-gem" />
          </>
        )}
        {level === "studio" && (
          <>
            <path
              d="m17 13-8 8-5 18 5 18 12 11 17 6 17-6 12-11 5-18-5-18-8-8"
              strokeWidth=".9"
            />
            <path
              d="m13 22-4 17 5 18 10 7m39-42 4 17-5 18-10 7"
              strokeWidth=".5"
            />
            <path
              d="m8 28-7 11 7 11 2-11Zm60 0 7 11-7 11-2-11Z"
              className="account-frame-gem"
            />
            <path d="M19 13v6m38-6v6M19 60v6m38-6v6M29 72l9-6 9 6" />
            <circle
              cx="38"
              cy="39"
              r="32"
              strokeDasharray="2 9"
              className="account-frame-orbit"
            />
            <circle
              cx="38"
              cy="39"
              r="30"
              strokeDasharray="40 100"
              className="account-frame-counter"
            />
          </>
        )}
        <g className="account-frame-crest" strokeWidth=".8" fill="currentColor">
          <Crest level={level} />
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
      <svg
        className="account-profile-ornament"
        viewBox="0 0 160 160"
        fill="none"
        aria-hidden="true"
      >
        <path d="M35 12H18v17M12 40v62m6 29v17h17M52 148h70M139 135V78" />
        <path d="m44 14 4-4h34m-59 24-5 5v54l5 5m18 41 5 5h43" opacity=".5" />
        <path d="M14 50h5m-5 13h5m-5 13h5m-5 13h5m-5 13h5" strokeWidth="3" />
        <circle cx="99" cy="64" r="30" strokeWidth=".5" strokeDasharray="2 5" />
        <path d="m99 43 9 5 12 16-12 16-9 5-9-5-12-16 12-16Z" opacity=".3" />
      </svg>
      {children}
    </header>
  );
}
