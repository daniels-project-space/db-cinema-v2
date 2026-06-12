import type { ReactElement, SVGProps } from "react";

/* Custom animated category symbols, 48×48 stroke icons. Each has moving
 * parts driven by CSS classes (ci-*) that animate when the parent
 * `.cat-tile` is hovered — see globals.css. Transform/opacity only. */

const svg = (p: SVGProps<SVGSVGElement>) => ({
  viewBox: "0 0 48 48",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

/** Cine camera — film reels spin, REC dot blinks. */
function Cameras(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <g className="ci-part ci-spin">
        <circle cx="16" cy="13" r="6.5" />
        <path d="M16 8.5v9M11.5 13h9" strokeWidth="1.4" />
      </g>
      <g className="ci-part ci-spin">
        <circle cx="31" cy="13" r="6.5" />
        <path d="M31 8.5v9M26.5 13h9" strokeWidth="1.4" />
      </g>
      <rect x="8" y="21" width="26" height="16" rx="3" />
      <path d="M34 26.5l8-3.5v12l-8-3.5" />
      <circle className="ci-rec" cx="14" cy="27" r="1.8" fill="#f43f5e" stroke="none" />
    </svg>
  );
}

/** Lens — aperture iris twists open. */
function Lenses(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <circle cx="24" cy="24" r="17" />
      <g className="ci-iris" strokeWidth="1.7">
        <path d="M37 24l-10.1 4.1" />
        <path d="M30.5 35.3l-8.6-6.8" />
        <path d="M17.5 35.3l1.5-10.9" />
        <path d="M11 24l10.1-4.1" />
        <path d="M17.5 12.7l8.6 6.8" />
        <path d="M30.5 12.7l-1.5 10.9" />
      </g>
    </svg>
  );
}

/** Audio — mic with sound waves pulsing outward. */
function Audio(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <rect x="20" y="8" width="8" height="16" rx="4" />
      <path d="M20 14h8M20 18h8" strokeWidth="1.4" />
      <path d="M15 20v2.5a9 9 0 0 0 18 0V20" />
      <path d="M24 31.5V38M19 38h10" />
      <path className="ci-wave" d="M13 11.5c-2.4 3.2-2.4 9.3 0 12.5" />
      <path className="ci-wave ci-d1" d="M9 9c-3.6 4.6-3.6 14.4 0 19" />
      <path className="ci-wave" d="M35 11.5c2.4 3.2 2.4 9.3 0 12.5" />
      <path className="ci-wave ci-d1" d="M39 9c3.6 4.6 3.6 14.4 0 19" />
    </svg>
  );
}

/** Accessories — rig gear rotates a quarter turn. */
function Accessories(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <g className="ci-gear">
        <circle cx="24" cy="24" r="10.5" />
        <circle cx="24" cy="24" r="4.5" />
        <path d="M34.5 24H38M31.4 31.4l2.5 2.5M24 34.5V38M16.6 31.4l-2.5 2.5M13.5 24H10M16.6 16.6l-2.5-2.5M24 13.5V10M31.4 16.6l2.5-2.5" />
      </g>
    </svg>
  );
}

/** Lighting — fresnel head with flickering beam rays. */
function Lighting(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <rect x="9" y="15" width="12" height="14" rx="2" />
      <path d="M21 17.5l5 2v5l-5 2" />
      <path d="M26 18.5l7-6M26 26l7 6" />
      <path d="M15 29v9M10 38h10" />
      <path className="ci-ray" d="M36 16l5-2.5" />
      <path className="ci-ray ci-d1" d="M37 22h6" />
      <path className="ci-ray ci-d2" d="M36 28l5 2.5" />
    </svg>
  );
}

/** Power — battery cells charge up in sequence. */
function Power(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <rect x="8" y="16" width="27" height="16" rx="3" />
      <path d="M39 21.5v5" />
      <rect className="ci-bar" x="12.5" y="20.5" width="5" height="7" rx="1" fill="currentColor" stroke="none" />
      <rect className="ci-bar ci-bd1" x="19.5" y="20.5" width="5" height="7" rx="1" fill="currentColor" stroke="none" />
      <rect className="ci-bar ci-bd2" x="26.5" y="20.5" width="5" height="7" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Stabilizer — gimbal head levels itself, swaying on its motor arm. */
function Stabilizers(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <path d="M24 39v-9" />
      <path d="M20.5 39h7" />
      <path d="M24 30h-8V19" />
      <g className="ci-part ci-sway">
        <rect x="19" y="10" width="12" height="9" rx="2" />
        <circle cx="25" cy="14.5" r="2.2" />
      </g>
    </svg>
  );
}

/** Monitor — a waveform draws across the screen. */
function Monitors(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <rect x="9" y="11" width="30" height="21" rx="2.5" />
      <path d="M24 32v5M18 37h12" />
      <path className="ci-scanline" d="M13 25l4-6 3.5 7 4-10 3.5 7 6-5" strokeWidth="1.7" />
    </svg>
  );
}

/** Grip — C-stand legs splay out. */
function Grip(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <path d="M24 8v26" />
      <path d="M24 14h9" />
      <circle cx="35" cy="14" r="1.6" />
      <path d="M24 34v6" />
      <path className="ci-pivot-top ci-leg ci-leg-l" d="M24 34l-9 6" />
      <path className="ci-pivot-top ci-leg ci-leg-r" d="M24 34l9 6" />
    </svg>
  );
}

/** Drone — props spin up. */
function Drones(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <rect x="19" y="19" width="10" height="9" rx="2.5" />
      <path d="M19 21l-7-7M29 21l7-7M19 26l-7 7M29 26l7-7" transform="translate(0 1)" />
      <circle cx="24" cy="23" r="1.7" />
      <g className="ci-part ci-spin-fast"><path d="M6.5 14h11" /></g>
      <g className="ci-part ci-spin-fast"><path d="M30.5 14h11" /></g>
      <g className="ci-part ci-spin-fast"><path d="M6.5 34h11" /></g>
      <g className="ci-part ci-spin-fast"><path d="M30.5 34h11" /></g>
    </svg>
  );
}

/** Packages — flight-case lid pops open. */
function Packages(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <g className="ci-lid">
        <path d="M12 18v-3a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v3" />
        <path d="M20 12v-1a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1" />
      </g>
      <rect x="10" y="18" width="28" height="18" rx="3" />
      <path d="M17 18v4.5M31 18v4.5" />
    </svg>
  );
}

const MAP: [RegExp, (p: SVGProps<SVGSVGElement>) => ReactElement][] = [
  [/camera/i, Cameras],
  [/lens|glass/i, Lenses],
  [/audio|sound|mic/i, Audio],
  [/light/i, Lighting],
  [/power|batter/i, Power],
  [/stabili|gimbal/i, Stabilizers],
  [/monitor|screen/i, Monitors],
  [/grip|stand|tripod/i, Grip],
  [/drone|aerial/i, Drones],
  [/package|bundle|kit/i, Packages],
  [/accessor/i, Accessories],
];

export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = MAP.find(([re]) => re.test(name))?.[1] ?? Lenses;
  return <Icon className={className} />;
}
