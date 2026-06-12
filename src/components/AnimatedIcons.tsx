import type { CSSProperties, SVGProps } from "react";

/* Ambient animated badges, 48×48 stroke icons. Unlike CategoryIcon these
 * loop on their own (ab-* classes in globals.css) — they're the living
 * furniture of the trust strip and the how-it-works steps. All
 * transform/opacity (plus a dashoffset road scroll), gated behind
 * prefers-reduced-motion. */

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

/** Delivery truck barrelling across London — motor rumble, spinning wheels,
 * scrolling road, skid streaks and wind whipping off the back. */
export function BadgeTruck(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      {/* wind streaks peeling off behind the truck */}
      <path className="ab-wind" d="M1 15h4.5" strokeWidth="1.6" />
      <path className="ab-wind ab-w2" d="M0 20.5h6" strokeWidth="1.6" />
      <path className="ab-wind ab-w3" d="M1.5 25h4" strokeWidth="1.6" />

      {/* exhaust puffs chugging out the back */}
      <circle className="ab-puff" cx="4.5" cy="28.5" r="1.4" />
      <circle className="ab-puff ab-p2" cx="4.5" cy="28.5" r="1.1" />

      {/* the truck itself — rumbling on its suspension */}
      <g className="ab-truck">
        <rect x="6" y="13" width="18" height="14" rx="1.8" />
        <path d="M24 17h5.2l4.3 5.3V27h-9.5" />
        <circle cx="33" cy="24.5" r="0.9" fill="currentColor" stroke="none" />
        {/* wheels with visible spokes so the spin reads */}
        <g className="ab-wheel">
          <circle cx="12.5" cy="31" r="3.2" />
          <path d="M12.5 28.6v4.8M10.1 31h4.8" strokeWidth="1.3" />
        </g>
        <g className="ab-wheel">
          <circle cx="28.5" cy="31" r="3.2" />
          <path d="M28.5 28.6v4.8M26.1 31h4.8" strokeWidth="1.3" />
        </g>
      </g>

      {/* skid streaks burnt onto the road behind the tyres */}
      <path className="ab-skid" d="M5.5 35.3h4.5" strokeWidth="1.8" />
      <path className="ab-skid ab-s2" d="M21.5 35.3h4.5" strokeWidth="1.8" />

      {/* the road, scrolling under the wheels */}
      <path className="ab-road" d="M2 35.3h44" strokeWidth="1.4" strokeDasharray="5 4" />
    </svg>
  );
}

/** Maintenance shield — coin-flips into a thumbs up and back, with a
 * spark of approval at the turn. */
export function BadgeShield(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <g className="ab-flip">
        {/* face A — the shield with its checkmark */}
        <g className="ab-faceA">
          <path d="M24 6.5l12.5 4.8v9c0 8.4-5.3 14-12.5 16.4C16.8 34.3 11.5 28.7 11.5 20.3v-9z" />
          <path d="M18.5 21.5l4 4 7.5-8" />
        </g>
        {/* face B — thumbs up, with a happy settle */}
        <g className="ab-faceB">
          <g className="ab-thumb">
            <path d="M27 19.5v-6a4.5 4.5 0 0 0-4.5-4.5l-6 13.5V39h16.9a3 3 0 0 0 3-2.6l2.1-13.5a3 3 0 0 0-3-3.4z" />
            <path d="M16.5 39H12a3 3 0 0 1-3-3V25.5a3 3 0 0 1 3-3h4.5" />
          </g>
          <path className="ab-spark" d="M36.5 9.5l2.4-2.4" strokeWidth="1.7" />
          <path className="ab-spark ab-spark2" d="M41 15.5h3" strokeWidth="1.7" />
        </g>
      </g>
    </svg>
  );
}

/** Booking clock — the hands race through the minutes, then the booking
 * lands and confetti goes off. */
export function BadgeClock(p: SVGProps<SVGSVGElement>) {
  const conf: [string, string, string, boolean, boolean][] = [
    // [--cx, --cy, --cr, isCircle, isAccent]
    ["-14px", "-11px", "140deg", false, true],
    ["13px", "-13px", "-120deg", false, false],
    ["17px", "-2px", "60deg", true, true],
    ["-17px", "1px", "90deg", false, true],
    ["9px", "12px", "0deg", true, false],
    ["-9px", "13px", "200deg", false, false],
    ["-3px", "-17px", "0deg", true, true],
    ["4px", "16px", "-160deg", false, true],
    ["16px", "8px", "120deg", false, false],
    ["-16px", "-5px", "0deg", true, false],
  ];
  return (
    <svg {...svg(p)}>
      <g className="ab-clockface">
        <circle cx="24" cy="24" r="15.5" />
        <path d="M24 10.5v2.5M37.5 24H35M24 37.5V35M10.5 24H13" strokeWidth="1.5" />
        <path className="ab-hand ab-hand-h" d="M24 24l5.5-3" />
        <path className="ab-hand ab-hand-m" d="M24 24V13.5" />
        <circle cx="24" cy="24" r="1.3" fill="currentColor" stroke="none" />
      </g>
      {conf.map(([cx, cy, cr, isCircle, accent], i) =>
        isCircle ? (
          <circle
            key={i}
            className="ab-conf"
            cx="24"
            cy="23"
            r="1.4"
            fill={accent ? "var(--color-accent-400)" : "rgba(255,255,255,0.85)"}
            stroke="none"
            style={v({ "--cx": cx, "--cy": cy, "--cr": cr })}
          />
        ) : (
          <rect
            key={i}
            className="ab-conf"
            x="22.8"
            y="21"
            width="2.4"
            height="4"
            rx="0.7"
            fill={accent ? "var(--color-accent-400)" : "rgba(255,255,255,0.85)"}
            stroke="none"
            style={v({ "--cx": cx, "--cy": cy, "--cr": cr })}
          />
        ),
      )}
    </svg>
  );
}

/** Browse — a magnifier sweeps the catalogue, lighting up cards as it
 * passes over them. */
export function BadgeBrowse(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <rect className="ab-card" x="9" y="12" width="10" height="8" rx="1.5" />
      <rect className="ab-card ab-c2" x="22" y="12" width="10" height="8" rx="1.5" />
      <rect className="ab-card ab-c3" x="9" y="24" width="10" height="8" rx="1.5" />
      <rect className="ab-card ab-c4" x="22" y="24" width="10" height="8" rx="1.5" />
      <g className="ab-scan">
        <circle cx="17" cy="17" r="6.5" />
        <path d="M21.8 21.8l5.2 5.2" />
      </g>
    </svg>
  );
}

/** Dates — a booking hops across the calendar and lands with a tick. */
export function BadgeCalendar(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <rect x="9" y="11" width="30" height="27" rx="3" />
      <path d="M9 18h30" strokeWidth="1.5" />
      <path d="M16.5 8v5.5M31.5 8v5.5" />
      {/* resting day cells */}
      {[
        [14, 22.5],
        [21.5, 22.5],
        [29, 22.5],
        [14, 29.5],
        [21.5, 29.5],
      ].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" rx="1" fill="currentColor" stroke="none" opacity="0.22" />
      ))}
      {/* the chosen date, hopping cell to cell */}
      <rect className="ab-day" x="14" y="22.5" width="4.5" height="4.5" rx="1.1" fill="var(--color-accent-400)" stroke="none" />
      <path className="ab-calcheck" d="M29.5 31.2l1.6 1.6 2.8-3.2" stroke="rgba(255,255,255,0.95)" strokeWidth="1.8" />
    </svg>
  );
}

/** Secure payment — the shackle lifts, then clicks home with a spark. */
export function BadgeLock(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...svg(p)}>
      <path className="ab-lockspark" d="M11 16.5l-2.5-2.2" strokeWidth="1.7" />
      <path className="ab-lockspark ab-ls2" d="M37 16.5l2.5-2.2" strokeWidth="1.7" />
      <path className="ab-shackle" d="M17.5 21v-4.5a6.5 6.5 0 0 1 13 0V21" />
      <g className="ab-lockbody">
        <rect x="13.5" y="21" width="21" height="16" rx="3" />
        <circle cx="24" cy="27.5" r="1.9" fill="currentColor" stroke="none" />
        <path d="M24 29.5v3" />
      </g>
    </svg>
  );
}
