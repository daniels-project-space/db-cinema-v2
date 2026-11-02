"use client";

import { useEffect, useRef } from "react";

export function LoopingBannerVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const sync = () => {
      if (visible && !document.hidden && !motion.matches) {
        if (!video.getAttribute("src")) video.src = src;
        video.muted = true;
        void video.play().catch(() => {});
      } else video.pause();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0.05 });
    observer.observe(video);
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      video.pause();
    };
  }, [src]);

  return <video ref={ref} className="absolute inset-0 h-full w-full object-cover object-center" poster={poster} muted loop playsInline preload="none" aria-hidden="true" />;
}
