"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const Hero3D = dynamic(() => import("@/components/Hero3D"), { ssr: false });

/** Defers the R3F canvas: only mounts after first paint, desktop-width only,
 * so the hero text renders instantly and mobile never pays for WebGL. */
export function HeroVisual() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (window.innerWidth < 768) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => setShow(true), 250);
    return () => window.clearTimeout(t);
  }, []);

  if (!show) return null;
  return <Hero3D />;
}
