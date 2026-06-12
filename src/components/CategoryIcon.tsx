import type { CSSProperties, ReactElement, SVGProps } from "react";

/* Custom animated category symbols, 48×48 stroke icons. Each has moving
 * parts driven by CSS classes (ci-*) that animate when the parent
 * `.ci-host` is hovered — see globals.css. Transform/opacity only. */

const svg = (p: SVGProps<SVGSVGElement>) => ({
  viewBox: "0 0 48 48",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

const v = (o: Record<string, string>) => o as CSSProperties;

/** Cine camera — film reels spin, lens pumps a zoom, REC blinks. */
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
      <path className="ci-zoom" d="M34 26.5l8-3.5v12l-8-3.5" />
      <circle className="ci-rec" cx="14" cy="27" r="1.8" fill="#f43f5e" stroke="none" />
    </svg>
  );
}

/** Lens — the iris twists fully open, holds, and breathes shut again,
 * with a glint sweeping the glass at full aperture. */
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
      <circle className="ci-aperture" cx="24" cy="24" r="4.2" strokeWidth="1.7" />
      <path className="ci-glint" d="M31.5 11.5a14.5 14.5 0 0 1 5.2 5.4" strokeWidth="1.7" />
    </svg>
  );
}

/** Audio — mic bobs to the beat while sound waves pulse outward. */
function Audio(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <g className="ci-mic">
        <rect x="20" y="8" width="8" height="16" rx="4" />
        <path d="M20 14h8M20 18h8" strokeWidth="1.4" />
      </g>
      <path d="M15 20v2.5a9 9 0 0 0 18 0V20" />
      <path d="M24 31.5V38M19 38h10" />
      <path className="ci-wave" d="M13 11.5c-2.4 3.2-2.4 9.3 0 12.5" />
      <path className="ci-wave ci-d1" d="M9 9c-3.6 4.6-3.6 14.4 0 19" />
      <path className="ci-wave" d="M35 11.5c2.4 3.2 2.4 9.3 0 12.5" />
      <path className="ci-wave ci-d1" d="M39 9c3.6 4.6 3.6 14.4 0 19" />
    </svg>
  );
}

/** Accessories — two meshed gears rock back and forth against each other. */
function Accessories(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <g className="ci-gear">
        <circle cx="19" cy="28" r="8.5" />
        <circle cx="19" cy="28" r="3.5" />
        <path d="M27.5 28h3M25 22l2.1-2.1M19 19.5v-3M13 22l-2.1-2.1M10.5 28h-3M13 34l-2.1 2.1M19 36.5v3M25 34l2.1 2.1" />
      </g>
      <g className="ci-gear2">
        <circle cx="33" cy="13" r="5" />
        <circle cx="33" cy="13" r="1.8" />
        <path d="M38 13h2.5M35.5 8.7l1.25-2.2M30.5 8.7l-1.25-2.2M28 13h-2.5M30.5 17.3l-1.25 2.2M35.5 17.3l1.25 2.2" strokeWidth="1.7" />
      </g>
    </svg>
  );
}

/** Lighting — the fresnel head tilts on its yoke, beam rays flickering. */
function Lighting(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <g className="ci-head">
        <rect x="9" y="15" width="12" height="14" rx="2" />
        <path d="M21 17.5l5 2v5l-5 2" />
        <path d="M26 18.5l7-6M26 26l7 6" />
      </g>
      <path d="M15 29v9M10 38h10" />
      <path className="ci-ray" d="M36 16l5-2.5" />
      <path className="ci-ray ci-d1" d="M37 22h6" />
      <path className="ci-ray ci-d2" d="M36 28l5 2.5" />
    </svg>
  );
}

/** Power — cells fill in sequence; at full charge the battery jolts
 * alive, a bolt flashes and sparks fly off the casing. */
function Power(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <path className="ci-spk" d="M9 12.5l-2.2-2.6" style={v({ "--sx": "-3px", "--sy": "-3px" })} strokeWidth="1.7" />
      <path className="ci-spk ci-skd1" d="M21.5 10.5V7" style={v({ "--sx": "0px", "--sy": "-4px" })} strokeWidth="1.7" />
      <path className="ci-spk ci-skd2" d="M34 12.5l2.2-2.6" style={v({ "--sx": "3px", "--sy": "-3px" })} strokeWidth="1.7" />
      <path className="ci-spk ci-skd1" d="M9 35.5l-2.2 2.6" style={v({ "--sx": "-3px", "--sy": "3px" })} strokeWidth="1.7" />
      <path className="ci-spk" d="M21.5 37.5V41" style={v({ "--sx": "0px", "--sy": "4px" })} strokeWidth="1.7" />
      <path className="ci-spk ci-skd2" d="M34 35.5l2.2 2.6" style={v({ "--sx": "3px", "--sy": "3px" })} strokeWidth="1.7" />
      <g className="ci-batt">
        <rect x="8" y="16" width="27" height="16" rx="3" />
        <path d="M39 21.5v5" />
        <rect className="ci-cell ci-cell-a" x="12.5" y="20.5" width="5" height="7" rx="1" fill="currentColor" stroke="none" />
        <rect className="ci-cell ci-cell-b" x="19.5" y="20.5" width="5" height="7" rx="1" fill="currentColor" stroke="none" />
        <rect className="ci-cell ci-cell-c" x="26.5" y="20.5" width="5" height="7" rx="1" fill="currentColor" stroke="none" />
      </g>
      <path className="ci-bolt" d="M41 6.5l-2.6 4.2h2.3l-1.6 3.8 4.2-4.8h-2.3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Stabilizer — the arm sways like a moving operator while the camera
 * counter-rotates and stays dead level. The whole point of a gimbal. */
function Stabilizers(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <path d="M20 41h8" />
      <g className="ci-gimbal-arm">
        <path d="M24 41v-9.5" />
        <path d="M24 31.5h-8V19" />
        <circle cx="16" cy="31.5" r="1.5" />
        <g className="ci-gimbal-steady">
          <rect x="17.5" y="9" width="13" height="9.5" rx="2" />
          <circle cx="24" cy="13.7" r="2.3" />
          <path d="M21.5 13.7h5" strokeWidth="1.2" opacity="0.6" />
        </g>
      </g>
    </svg>
  );
}

/** Monitor — a waveform draws across the screen, power LED breathing. */
function Monitors(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <rect x="9" y="11" width="30" height="21" rx="2.5" />
      <path d="M24 32v5M18 37h12" />
      <path className="ci-scanline" d="M13 25l4-6 3.5 7 4-10 3.5 7 6-5" strokeWidth="1.7" />
      <circle className="ci-pwr" cx="35.5" cy="29" r="1.1" fill="var(--color-accent-400)" stroke="none" />
    </svg>
  );
}

/** Grip — C-stand legs splay out and the arm dips as it takes weight. */
function Grip(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <path d="M24 8v26" />
      <g className="ci-grip-arm">
        <path d="M24 14h9" />
        <circle cx="35" cy="14" r="1.6" />
      </g>
      <path d="M24 34v6" />
      <path className="ci-pivot-top ci-leg ci-leg-l" d="M24 34l-9 6" />
      <path className="ci-pivot-top ci-leg ci-leg-r" d="M24 34l9 6" />
    </svg>
  );
}

/** Drone — props spin up and the whole aircraft lifts into a hover bob. */
function Drones(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <g className="ci-bob">
        <rect x="19" y="19" width="10" height="9" rx="2.5" />
        <path d="M19 21l-7-7M29 21l7-7M19 26l-7 7M29 26l7-7" transform="translate(0 1)" />
        <circle cx="24" cy="23" r="1.7" />
        <g className="ci-part ci-spin-fast"><path d="M6.5 14h11" /></g>
        <g className="ci-part ci-spin-fast"><path d="M30.5 14h11" /></g>
        <g className="ci-part ci-spin-fast"><path d="M6.5 34h11" /></g>
        <g className="ci-part ci-spin-fast"><path d="M30.5 34h11" /></g>
      </g>
    </svg>
  );
}

/** Packages — the flight-case lid swings open and the kit boxes pop out,
 * landing neatly around the case. They climb back in on mouse-out. */
function Packages(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <g className="ci-pop" style={v({ "--px": "13px", "--py": "-7px" })}>
        <rect x="3" y="28" width="8" height="8" rx="1.3" />
        <path d="M3 32h8M7 28v4" strokeWidth="1.4" />
      </g>
      <g className="ci-pop ci-pop-b" style={v({ "--px": "-12px", "--py": "-6px" })}>
        <rect x="37" y="26" width="7.5" height="7.5" rx="1.3" />
        <path d="M37 29.8h7.5" strokeWidth="1.4" />
      </g>
      <g className="ci-pop ci-pop-c" style={v({ "--px": "-10px", "--py": "11px" })}>
        <rect x="35" y="6.5" width="6.5" height="6.5" rx="1.2" />
        <path d="M38.2 6.5V13" strokeWidth="1.4" />
      </g>
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
