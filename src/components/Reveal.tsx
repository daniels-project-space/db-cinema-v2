"use client";

import { useEffect, useRef, useState, ReactNode } from "react";

type Variant = "up" | "left" | "right" | "scale";

const VARIANT_CLASS: Record<Variant, string> = {
  up: "",
  left: "from-left",
  right: "from-right",
  scale: "from-scale",
};

/** Scroll-into-view reveal: fade + rise (or slide/scale variant). */
export function Reveal({
  children,
  delay = 0,
  variant = "up",
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  variant?: Variant;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${VARIANT_CLASS[variant]} ${shown ? "in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
