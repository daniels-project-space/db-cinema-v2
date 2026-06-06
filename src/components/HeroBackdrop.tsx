"use client";

import dynamic from "next/dynamic";

const Hero3D = dynamic(() => import("@/components/Hero3D"), { ssr: false });

export function HeroBackdrop() {
  // hidden on small screens so the floating models never crowd the wordmark
  return (
    <div className="absolute inset-0 hidden md:block">
      <Hero3D />
    </div>
  );
}
