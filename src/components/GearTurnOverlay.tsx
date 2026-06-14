"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Cinematic page transition for Home -> Gear. The Gear nav link (on the
 * homepage) dispatches "dbc:gear-turn"; we hold ~0.85s on the homepage, then
 * fade in and play the turn film (neon -> camera turns into the room -> the
 * gear station). On end we route to /gear, whose top loop starts on the turn's
 * exact last frame, so the hand-off is seamless. Reduced-motion just routes.
 */
export function GearTurnOverlay() {
  const router = useRouter();
  const vref = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"idle" | "hold" | "play" | "out">("idle");

  useEffect(() => {
    const trigger = () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        router.push("/gear");
        return;
      }
      router.prefetch("/gear");
      setPhase("hold");
    };
    window.addEventListener("dbc:gear-turn", trigger);
    return () => window.removeEventListener("dbc:gear-turn", trigger);
  }, [router]);

  useEffect(() => {
    if (phase === "hold") {
      const id = setTimeout(() => setPhase("play"), 850); // stay a beat on the main page
      return () => clearTimeout(id);
    }
    if (phase === "play") {
      const v = vref.current;
      if (v) {
        try {
          v.currentTime = 0;
        } catch {
          /* not ready */
        }
        void v.play().catch(() => router.push("/gear"));
      }
    }
  }, [phase, router]);

  const onEnded = () => {
    router.push("/gear");
    setPhase("out");
    setTimeout(() => setPhase("idle"), 650);
  };

  const mounted = phase !== "idle";

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[120] bg-[#050507] transition-opacity duration-500"
      style={{
        opacity: phase === "play" ? 1 : 0,
        pointerEvents: mounted ? "auto" : "none",
        visibility: mounted ? "visible" : "hidden",
      }}
    >
      <video
        ref={vref}
        className="h-full w-full object-cover object-center"
        src="/gear-turn.mp4"
        muted
        playsInline
        preload="auto"
        tabIndex={-1}
        onEnded={onEnded}
      />
    </div>
  );
}
