"use client";

import { useState } from "react";
import { IconPlus } from "@/components/icons";

/** Animated FAQ accordion — grid-template-rows height transition. */
export function Accordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="flex flex-col gap-3">
      {items.map((f, i) => {
        const isOpen = open === i;
        return (
          <div
            key={f.q}
            className={`spot rounded-2xl transition-colors ${isOpen ? "border-accent-400/25" : ""}`}
          >
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              aria-controls={`acc-panel-${i}`}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className={`font-display font-semibold transition-colors ${isOpen ? "text-white" : "text-white/80"}`}>
                {f.q}
              </span>
              <span
                className={`acc-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                  isOpen ? "open bg-accent-500/20 text-accent-300" : "bg-white/5 text-white/40"
                }`}
              >
                <IconPlus className="h-3.5 w-3.5" />
              </span>
            </button>
            <div id={`acc-panel-${i}`} className={`acc-body ${isOpen ? "open" : ""}`}>
              <div>
                <p className="px-5 pb-5 text-sm leading-relaxed text-white/55">{f.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
