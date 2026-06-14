"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Cinematic Cart -> Checkout transition. The cart's Checkout button dispatches
 * "dbc:checkout-turn"; we hold ~0.7s, play the turn film (the man walks around
 * the cart, faces the camera, the camera tilts down to a card reader), then
 * route to /checkout (whose top loop starts on the turn's last frame) and fade
 * out. Reduced-motion just routes.
 */
export function CheckoutTurnOverlay() {
  const router = useRouter();
  const vref = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"idle" | "hold" | "play" | "out">("idle");

  useEffect(() => {
    const trigger = () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        router.push("/checkout");
        return;
      }
      router.prefetch("/checkout");
      setPhase("hold");
    };
    window.addEventListener("dbc:checkout-turn", trigger);
    return () => window.removeEventListener("dbc:checkout-turn", trigger);
  }, [router]);

  useEffect(() => {
    if (phase === "hold") {
      const id = setTimeout(() => setPhase("play"), 700);
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
        void v.play().catch(() => router.push("/checkout"));
      }
    }
  }, [phase, router]);

  const onEnded = () => {
    router.push("/checkout");
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
        src="/checkout-turn.mp4"
        muted
        playsInline
        preload="auto"
        tabIndex={-1}
        onEnded={onEnded}
      />
    </div>
  );
}
