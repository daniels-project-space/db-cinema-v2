import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

/** AI item assembly / gear picker — adjustment sliders (config, not a sparkle). */
export function IconSliders(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="8" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="16" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Cinema brand mark — camera (replaces the clapper emoji). */
export function IconCamera(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="7" width="18" height="12" rx="2.5" />
      <path d="M8 7l1.2-2h5.6L16 7" />
      <circle cx="12" cy="13" r="3.1" />
    </svg>
  );
}

/** Rating star (clean SVG, used only where a rating is meant). */
export function IconStar({ filled = true, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" {...p}>
      <path d="M12 3.2l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.4l1-5.8L3.5 9.4l5.9-.9z" />
    </svg>
  );
}

/** Padlock — secure checkout. */
export function IconLock(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <rect x="5" y="10.5" width="14" height="9" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

/** Box — gear packages / bundles. */
export function IconBox(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M3.5 8L12 4l8.5 4v8L12 20l-8.5-4z" />
      <path d="M3.5 8L12 12l8.5-4M12 12v8" />
    </svg>
  );
}

/** Bolt — upgrade. */
export function IconBolt(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M13 3L5 13h6l-1 8 8-10h-6z" fill="currentColor" stroke="none" />
    </svg>
  );
}
