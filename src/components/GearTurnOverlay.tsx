"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Cinematic Home -> Gear transition. The Gear nav link (on the homepage)
 * dispatches "dbc:gear-turn"; we hold ~0.85s on the homepage, then play the
 * turn film (neon -> camera turns into the room -> the gear station) and route
 * to /gear underneath at the same time. Over the turn's last ~1.6s the overlay
 * cross-dissolves out, so the gear interface fades in WHILE the camera is still
 * moving. Reduced-motion routes straight to /gear.
 */
export function GearTurnOverlay() {
  const router = useRouter();
  const vref = useRef<HTMLVideoElement>(null);
  const pushed = useRef(false);
  const [phase, setPhase] = useState<"idle" | "hold" | "play">("idle");
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    const trigger = () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        router.push("/gear");
        return;
      }
      router.prefetch("/gear");
      pushed.current = false;
      setRevealing(false);
      setPhase("hold");
    };
    window.addEventListener("dbc:gear-turn", trigger);
    return () => window.removeEventListener("dbc:gear-turn", trigger);
  }, [router]);

  useEffect(() => {
    if (phase === "hold") {
      const id = setTimeout(() => setPhase("play"), 850); // a beat on the main page
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
      if (!pushed.current) {
        pushed.current = true;
        router.push("/gear"); // load the gear page underneath while the turn plays
      }
    }
  }, [phase, router]);

  const onTimeUpdate = () => {
    const v = vref.current;
    if (v && v.duration && v.currentTime >= v.duration - 1.6) setRevealing(true);
  };
  const onEnded = () => {
    setRevealing(true);
    setTimeout(() => setPhase("idle"), 250);
  };

  const mounted = phase !== "idle";
  const opaque = phase === "play" && !revealing;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[120] bg-[#050507]"
      style={{
        opacity: opaque ? 1 : 0,
        transition: `opacity ${revealing ? 1600 : 480}ms ease`,
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
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
      />
    </div>
  );
}
