"use client";

import { useEffect, useRef } from "react";

/**
 * Cinematic hero plate: a full-bleed film that plays once (the room, the crew
 * stepping in, the swoop up into the neon logo) and then settles into a
 * seamless idle loop of the glowing "DB CINEMA RENTALS" sign.
 *
 * One <video>: starts on intro.mp4, and on `ended` swaps to loop.mp4 with
 * loop=true. Poster (the first frame of the intro) paints instantly so there's
 * no flash. Reduced-motion visitors just hold the poster.
 */
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // hold poster

    let swapped = false;
    const toLoop = () => {
      if (swapped) return;
      swapped = true;
      v.src = "/loop.mp4";
      v.loop = true;
      v.load();
      void v.play().catch(() => {});
    };
    v.addEventListener("ended", toLoop);
    void v.play().catch(() => {});
    return () => v.removeEventListener("ended", toLoop);
  }, []);

  return (
    <video
      ref={ref}
      className="absolute inset-0 h-full w-full object-cover object-center"
      src="/intro.mp4"
      poster="/hero-backwall.jpg"
      muted
      playsInline
      preload="auto"
      tabIndex={-1}
      aria-hidden
    />
  );
}
