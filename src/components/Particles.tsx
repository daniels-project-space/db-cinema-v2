"use client";

import { useEffect, useRef } from "react";

/**
 * Lightweight canvas particle field. Uses a cached sprite (one gradient drawn
 * once) instead of building a radial gradient per particle per frame, and
 * pauses entirely when scrolled out of view. Pointer-events none, reduced-motion aware.
 */
export function Particles() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cv = canvas;
    const cx = ctx;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0, h = 0, raf = 0, visible = true, running = false;

    // cached glow sprite (drawn once) — tinted to the active accent theme
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue("--color-accent-400").trim() || "#38bdf8";
    const SP = 24;
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = SP;
    const sctx = sprite.getContext("2d")!;
    const sg = sctx.createRadialGradient(SP / 2, SP / 2, 0, SP / 2, SP / 2, SP / 2);
    sg.addColorStop(0, accent);
    sg.addColorStop(1, "transparent");
    sctx.fillStyle = sg;
    sctx.fillRect(0, 0, SP, SP);

    type P = { x: number; y: number; vx: number; vy: number; s: number; a: number };
    let parts: P[] = [];

    function resize() {
      const rect = cv.parentElement!.getBoundingClientRect();
      w = rect.width; h = rect.height;
      cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr);
      cv.style.width = w + "px"; cv.style.height = h + "px";
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(55, Math.floor((w * h) / 22000));
      parts = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.12, vy: -0.08 - Math.random() * 0.2,
        s: 6 + Math.random() * 12, a: 0.1 + Math.random() * 0.45,
      }));
    }

    function draw() {
      cx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -12) { p.y = h + 12; p.x = Math.random() * w; }
        if (p.x < -12) p.x = w + 12; else if (p.x > w + 12) p.x = -12;
        cx.globalAlpha = p.a;
        cx.drawImage(sprite, p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
      }
      cx.globalAlpha = 1;
      if (visible && !reduced) raf = requestAnimationFrame(draw);
      else running = false;
    }

    function start() {
      if (running || reduced) return;
      running = true;
      raf = requestAnimationFrame(draw);
    }

    resize();
    if (reduced) { draw(); } else { start(); }

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
    }, { rootMargin: "100px" });
    io.observe(cv);
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
