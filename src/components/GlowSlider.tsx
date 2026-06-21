"use client";

/**
 * Budget slider that lights up as the value climbs — the fill grows and the
 * glow intensifies with the number. `--pct` drives the fill, `--glow` the glow
 * (both 0..1). Styled by `.glow-slider` in globals.css.
 */
type Props = {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  "aria-label"?: string;
};

export function GlowSlider({
  value,
  onChange,
  min = 100,
  max = 3000,
  step = 50,
  className = "",
  ...rest
}: Props) {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`glow-slider ${className}`}
      style={{ ["--pct" as string]: String(pct), ["--glow" as string]: String(pct) }}
      {...rest}
    />
  );
}
