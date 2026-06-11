import type { CSSProperties } from "react";

/** Infinite horizontal marquee. Content is duplicated once; the track
 * translates -50% on a loop. Pauses on hover, masked edges. */
export function Marquee({
  items,
  speed = 36,
  className = "",
  itemClassName = "",
}: {
  items: string[];
  speed?: number;
  className?: string;
  itemClassName?: string;
}) {
  const row = (key: string, hidden = false) => (
    <div key={key} className="flex shrink-0 items-center" aria-hidden={hidden}>
      {items.map((it, i) => (
        <span key={i} className={`flex items-center ${itemClassName}`}>
          <span className="whitespace-nowrap">{it}</span>
          <span className="mx-6 inline-block h-1 w-1 rounded-full bg-accent-400/50" />
        </span>
      ))}
    </div>
  );

  return (
    <div className={`marquee ${className}`}>
      <div className="marquee-track" style={{ "--marquee-speed": `${speed}s` } as CSSProperties}>
        {row("a")}
        {row("b", true)}
      </div>
    </div>
  );
}
