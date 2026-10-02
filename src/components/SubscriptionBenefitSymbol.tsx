import type { CSSProperties } from "react";
import styles from "./SubscriptionBenefitSymbol.module.css";

type Benefit = "credit" | "stack" | "saving" | "security" | "delivery" | "weekend" | "fund";

/** Presentation only: the product contract remains the source of benefit text. */
function benefitFor(text: string): Benefit {
  const label = text.toLowerCase();
  if (label.includes("film fund")) return "fund";
  if (label.includes("weekend")) return "weekend";
  if (label.includes("delivery")) return "delivery";
  if (label.includes("security") || label.includes("hold")) return "security";
  if (label.includes("stack") || label.includes("year")) return "stack";
  if (label.includes("first-month") || label.includes("offer")) return "saving";
  return "credit";
}

export function SubscriptionBenefitSymbol({ benefit, index = 0 }: { benefit: string; index?: number }) {
  const kind = benefitFor(benefit);
  return (
    <span className={styles.symbol} data-subscription-symbol={kind} aria-hidden="true"
      style={{ "--symbol-delay": `${-index * 0.73}s` } as CSSProperties}>
      <svg viewBox="0 0 28 28" fill="none" focusable="false" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
        {kind === "credit" && <>
          <path d="M7 13.5V20c0 2 14 2 14 0v-6.5M7 17c0 2 14 2 14 0" />
          <ellipse cx="14" cy="13.5" rx="7" ry="2.5" />
          <g className={styles.rise}><path d="M14 10V3m-3 3 3-3 3 3" /><path className={styles.glimmer} d="m22 5 .5 1.5L24 7l-1.5.5L22 9l-.5-1.5L20 7l1.5-.5Z" /></g>
        </>}
        {kind === "stack" && <>
          <path d="m5 12 9-4 9 4-9 4ZM5 16l9 4 9-4M5 20l9 4 9-4" />
          <g className={styles.orbit}><path d="M5 6a11 11 0 0 1 18 0M5 6V2m0 4h4M23 6V2m0 4h-4" /></g>
        </>}
        {kind === "saving" && <>
          <path d="M4 8h20v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4Z" />
          <path d="M10 8v2m0 3v2m0 3v2" />
          <g className={styles.twinkle}><path d="m17 10 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" /></g>
        </>}
        {kind === "security" && <>
          <path d="m14 3 9 4v7c0 5-5 8-9 11-4-3-9-6-9-11V7Z" />
          <circle cx="14" cy="13" r="5" />
          <path className={styles.draw} d="m11.5 13 1.8 1.8 3.4-3.6" />
        </>}
        {kind === "delivery" && <>
          <g className={styles.roll}><path d="M5 8h11v11H5ZM16 12h4l3 4v3h-7M17 12v4h6" /><circle cx="9" cy="20" r="2" /><circle cx="20" cy="20" r="2" /></g>
          <path className={styles.trail} d="M2 11h2M1 15h3M2 19h2" />
        </>}
        {kind === "weekend" && <>
          <path d="M5 12h18v11H5ZM5 8l17-4 1 4-17 4Z" />
          <path d="m9 7 3 3m3-4 3 3m3-4 2 2" />
          <g className={styles.twinkle}><path d="m14 14 .9 2.8 3 .9-3 .9-.9 2.8-.9-2.8-3-.9 3-.9Z" /></g>
        </>}
        {kind === "fund" && <>
          <path d="M4 10v11h20V10M4 14h2m-2 4h2m16-4h2m-2 4h2" />
          <path className={styles.heart} d="M14 18S8 14 8 10.5C8 7 12 6 14 9c2-3 6-2 6 1.5C20 14 14 18 14 18Z" />
          <path className={styles.glimmer} d="M14 3V1M6 6 4 4m18 2 2-2" />
        </>}
      </svg>
    </span>
  );
}
