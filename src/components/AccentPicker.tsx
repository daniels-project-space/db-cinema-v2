"use client";

import { useEffect, useState } from "react";
import { IconCheck } from "@/components/icons";

export const ACCENTS = [
  { key: "orange", label: "Orange", color: "#fb923c" },
  { key: "electric", label: "Electric", color: "#38bdf8" },
  { key: "gold", label: "Gold", color: "#fbbf24" },
  { key: "emerald", label: "Emerald", color: "#34d399" },
  { key: "violet", label: "Violet", color: "#a78bfa" },
  { key: "rose", label: "Rose", color: "#fb7185" },
] as const;

const KEY = "dbc-accent";

/** Accent colour picker — restyles the whole site via html[data-accent].
 * Saved per device (localStorage); applied pre-paint by the layout script. */
export function AccentPicker() {
  const [current, setCurrent] = useState("orange");

  useEffect(() => {
    try {
      setCurrent(localStorage.getItem(KEY) ?? "orange");
    } catch {}
  }, []);

  function pick(key: string) {
    setCurrent(key);
    try {
      if (key === "orange") {
        localStorage.removeItem(KEY);
        delete document.documentElement.dataset.accent;
      } else {
        localStorage.setItem(KEY, key);
        document.documentElement.dataset.accent = key;
      }
    } catch {}
  }

  return (
    <div className="flex flex-wrap gap-3">
      {ACCENTS.map((a) => {
        const active = current === a.key;
        return (
          <button
            key={a.key}
            onClick={() => pick(a.key)}
            aria-label={`${a.label} accent`}
            aria-pressed={active}
            className={`group flex flex-col items-center gap-1.5 rounded-xl px-2 py-1.5 transition-colors ${
              active ? "bg-white/[0.05]" : "hover:bg-white/[0.03]"
            }`}
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-300 ${
                active ? "scale-110" : "group-hover:scale-105"
              }`}
              style={{
                background: a.color,
                boxShadow: active ? `0 0 22px -4px ${a.color}` : `0 0 0 0 transparent`,
              }}
            >
              {active && <IconCheck className="h-4 w-4 text-black/70" />}
            </span>
            <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${active ? "text-white/80" : "text-white/35"}`}>
              {a.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
