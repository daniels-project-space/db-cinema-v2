"use client";

import { useEffect, useRef, useState } from "react";

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·/";

/** Decrypt-style text: characters scramble then settle left-to-right.
 * Runs once on mount; instant under reduced-motion. */
export function ScrambleText({ text, className = "" }: { text: string; className?: string }) {
  const [out, setOut] = useState(text);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const total = Math.max(20, text.length * 2.2);
    const id = window.setInterval(() => {
      frame++;
      const settled = Math.floor((frame / total) * text.length);
      let s = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (i < settled || ch === " ") s += ch;
        else s += CHARSET[Math.floor(Math.random() * CHARSET.length)];
      }
      setOut(s);
      if (settled >= text.length) {
        window.clearInterval(id);
        setOut(text);
      }
    }, 32);
    return () => window.clearInterval(id);
  }, [text]);

  return (
    <span className={className} aria-label={text}>
      {out}
    </span>
  );
}
