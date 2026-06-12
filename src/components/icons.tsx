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

/** Check — confirmations, feature ticks. */
export function IconCheck(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** X — close / remove. */
export function IconX(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** Plus — add / expand. */
export function IconPlus(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Arrow right — links and CTAs. */
export function IconArrowRight(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

/** Chevron left. */
export function IconChevronLeft(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

/** Chevron right. */
export function IconChevronRight(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  );
}

/** Heart — favourites. */
export function IconHeart({ filled = false, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 20.5S4 15.3 4 9.8C4 7.1 6.1 5 8.6 5c1.4 0 2.7.7 3.4 1.8C12.7 5.7 14 5 15.4 5 17.9 5 20 7.1 20 9.8c0 5.5-8 10.7-8 10.7z" />
    </svg>
  );
}

/** Search — catalogue lookup. */
export function IconSearch(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}

/** Menu — mobile nav. */
export function IconMenu(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** Truck — delivery. */
export function IconTruck(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3.2v3.3h-7" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </svg>
  );
}

/** Shield — protection / deposit. */
export function IconShield(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5l7 2.8v5.2c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6.3z" />
      <path d="M9 12l2.2 2.2L15.5 9.7" />
    </svg>
  );
}

/** Clock — booking speed / hours. */
export function IconClock(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/** Map pin — London / pickup. */
export function IconPin(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M12 21s-6.5-5.4-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </svg>
  );
}

/** Brain/spark — AI compatibility hints. */
export function IconSpark(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.8 2.8M14.7 14.7l2.8 2.8M17.5 6.5l-2.8 2.8M9.3 14.7l-2.8 2.8" />
    </svg>
  );
}

/** Trash — remove from kit. */
export function IconTrash(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13M10.5 11v5M13.5 11v5" />
    </svg>
  );
}

/** Send — chat composer. */
export function IconSend(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M4.5 11.5L20 4l-4.5 16-4-7z" />
      <path d="M11.5 13L20 4" />
    </svg>
  );
}

/** Ticket — membership. */
export function IconTicket(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(p)}>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
      <path d="M14 6v12" strokeDasharray="2 2.5" />
    </svg>
  );
}
