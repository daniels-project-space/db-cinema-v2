"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import styles from "./HomeApertureTransition.module.css";

type TransitionPhase = "idle" | "charging" | "committed" | "navigating" | "revealing";

type TransitionContextValue = {
  phase: TransitionPhase;
  progress: number;
  begin: (source?: HTMLElement | null) => void;
  cancel: () => void;
};

const TransitionContext = createContext<TransitionContextValue | null>(null);
const CHARGE_MS = 2500;
const REVEAL_MS = 1800;

type Origin = { x: number; y: number };

export function HomeApertureTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const [origin, setOrigin] = useState<Origin>({ x: 0, y: 0 });
  const [progress, setProgress] = useState(0);
  const phaseRef = useRef<TransitionPhase>("idle");
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  }, []);

  const setCurrentPhase = useCallback((next: TransitionPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const begin = useCallback((source?: HTMLElement | null) => {
    if (phaseRef.current !== "idle") return;
    router.prefetch("/gear");

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push("/gear");
      return;
    }

    const aperture = source?.querySelector<HTMLElement>("[data-testid='home-aperture-iris']") ?? source;
    const rect = aperture?.getBoundingClientRect();
    setOrigin(rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setProgress(0);
    setCurrentPhase("charging");
    timers.current.push(window.setTimeout(() => {
      if (phaseRef.current !== "charging") return;
      setProgress(0);
      setCurrentPhase("committed");
      timers.current.push(window.setTimeout(() => {
        if (phaseRef.current !== "committed") return;
        setCurrentPhase("navigating");
        router.push("/gear");
        timers.current.push(window.setTimeout(() => {
          if (phaseRef.current === "navigating") setCurrentPhase("idle");
        }, 15_000));
      }, CHARGE_MS));
    }, CHARGE_MS));
  }, [router, setCurrentPhase]);

  const cancel = useCallback(() => {
    if (phaseRef.current !== "charging") return;
    clearTimers();
    setProgress(0);
    setCurrentPhase("idle");
  }, [clearTimers, setCurrentPhase]);

  useEffect(() => {
    if (phase !== "charging" && phase !== "committed") return;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const value = Math.min(1, (now - startedAt) / CHARGE_MS);
      setProgress(value);
      if (value < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (phase !== "navigating" || pathname !== "/gear") return;
    clearTimers();
    setCurrentPhase("revealing");
    timers.current.push(window.setTimeout(() => {
      setProgress(0);
      setCurrentPhase("idle");
    }, REVEAL_MS));
  }, [clearTimers, pathname, phase, setCurrentPhase]);

  useEffect(() => {
    if (phase === "idle") {
      delete document.body.dataset.apertureTransition;
      return;
    }
    document.body.dataset.apertureTransition = phase;
    return () => { delete document.body.dataset.apertureTransition; };
  }, [phase]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const value = useMemo(() => ({ phase, progress, begin, cancel }), [begin, cancel, phase, progress]);
  return <TransitionContext.Provider value={value}>
    {children}
    {(phase === "committed" || phase === "navigating" || phase === "revealing") && typeof document !== "undefined"
      ? createPortal(<ApertureTransitionOverlay origin={origin} phase={phase} />, document.body)
      : null}
  </TransitionContext.Provider>;
}

export function useHomeApertureTransition() {
  const value = useContext(TransitionContext);
  if (!value) throw new Error("HomeApertureTransitionProvider is missing");
  return value;
}

type Particle = {
  angle: number;
  startRadius: number;
  delay: number;
  drift: number;
  size: number;
  hue: number;
};

function ApertureTransitionOverlay({ origin, phase }: { origin: Origin; phase: Exclude<TransitionPhase, "idle" | "charging"> }) {
  const shell = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const homeStage = phase === "committed";
  const revealing = phase === "revealing";

  useEffect(() => {
    const element = shell.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!element || !canvas || !context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles: Particle[] = Array.from({ length: 72 }, (_, index) => ({
      angle: Math.random() * Math.PI * 2,
      startRadius: 0.28 + Math.random() * 1.05,
      delay: Math.random() * 0.38,
      drift: (Math.random() - 0.5) * 2.7,
      size: 0.55 + Math.random() * 1.8,
      hue: index % 5 === 0 ? 36 : 24 + Math.random() * 16,
    }));
    let width = 0;
    let height = 0;
    let maxRadius = 0;
    let frame = 0;
    let startedAt = 0;
    let revealStart = 0;
    let lastFrame = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, width < 640 ? 1 : 1.2);
      maxRadius = Math.hypot(width, height) * 1.12;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const pointOnCurve = (angle: number, radius: number, bend: number, t: number) => {
      const sx = origin.x + Math.cos(angle) * radius;
      const sy = origin.y + Math.sin(angle) * radius * 0.78;
      const ex = origin.x + Math.cos(angle + bend) * 5;
      const ey = origin.y + Math.sin(angle + bend) * 5;
      const c1x = origin.x + Math.cos(angle - bend * 0.5) * radius * 0.68;
      const c1y = origin.y + Math.sin(angle - bend * 0.5) * radius * 0.48;
      const c2x = origin.x + Math.cos(angle + bend) * radius * 0.28;
      const c2y = origin.y + Math.sin(angle + bend) * radius * 0.2;
      const inverse = 1 - t;
      return {
        x: inverse ** 3 * sx + 3 * inverse ** 2 * t * c1x + 3 * inverse * t ** 2 * c2x + t ** 3 * ex,
        y: inverse ** 3 * sy + 3 * inverse ** 2 * t * c1y + 3 * inverse * t ** 2 * c2y + t ** 3 * ey,
      };
    };

    const draw = (now: number) => {
      if (now - lastFrame < 1000 / 30) {
        frame = requestAnimationFrame(draw);
        return;
      }
      lastFrame = now;
      if (!startedAt) startedAt = now;
      if (revealing && !revealStart) revealStart = now;
      const elapsed = now - startedAt;
      const rawProgress = homeStage
        ? Math.min(1, elapsed / CHARGE_MS)
        : revealing ? Math.min(1, (now - revealStart) / REVEAL_MS) : 0;
      const eased = 1 - Math.pow(1 - rawProgress, 3.2);
      const revealRadius = revealing ? 12 + eased * maxRadius : 12 + Math.sin(elapsed / 310) * 2;
      if (homeStage) {
        element.style.maskImage = "none";
        element.style.setProperty("-webkit-mask-image", "none");
      } else {
        const gradient = `radial-gradient(circle at ${origin.x}px ${origin.y}px, transparent 0, transparent ${Math.max(0, revealRadius - 2)}px, #000 ${revealRadius}px)`;
        element.style.maskImage = gradient;
        element.style.setProperty("-webkit-mask-image", gradient);
      }
      element.style.setProperty("--aperture-x", `${origin.x}px`);
      element.style.setProperty("--aperture-y", `${origin.y}px`);

      context.clearRect(0, 0, width, height);
      context.save();
      context.globalCompositeOperation = "screen";
      const turn = elapsed * 0.00018;
      const lensRadius = homeStage ? 45 + eased * 300 : revealing ? Math.max(30, revealRadius + 15) : 45 + Math.sin(elapsed / 500) * 5;

      for (let layer = 0; layer < 3; layer += 1) {
        context.save();
        context.translate(origin.x, origin.y);
        context.rotate(turn * (layer % 2 ? -1.2 : 1));
        context.scale(1, 0.37 + layer * 0.035);
        const radius = lensRadius + layer * (revealing ? 8 : 6);
        const arc = context.createLinearGradient(-radius, 0, radius, 0);
        arc.addColorStop(0, "rgba(202,94,48,0)");
        arc.addColorStop(0.25, "rgba(255,177,112,0.18)");
        arc.addColorStop(0.48, layer === 1 ? "rgba(255,235,201,0.93)" : "rgba(247,146,83,0.72)");
        arc.addColorStop(0.73, "rgba(230,111,59,0.34)");
        arc.addColorStop(1, "rgba(202,94,48,0)");
        context.beginPath();
        context.ellipse(0, 0, radius, radius, 0, 0.18 + layer * 0.38, Math.PI * (1.58 + layer * 0.12));
        context.strokeStyle = arc;
        context.lineWidth = layer === 1 ? 2.2 : 1.05;
        context.shadowColor = "transparent";
        context.shadowBlur = 0;
        context.stroke();
        context.restore();
      }

      const spiralExtent = Math.max(120, (homeStage ? 80 + eased * 360 : revealing ? revealRadius : Math.min(width, height) * 0.42) * 0.9);
      for (let arm = 0; arm < 3; arm += 1) {
        context.beginPath();
        for (let step = 0; step <= 88; step += 1) {
          const fraction = step / 88;
          const angle = arm * (Math.PI * 2 / 3) + turn * (arm % 2 ? -3 : 3) + fraction * 7.8;
          const radius = 8 + fraction * spiralExtent;
          const x = origin.x + Math.cos(angle) * radius;
          const y = origin.y + Math.sin(angle) * radius * (0.34 + fraction * 0.12);
          if (step === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle = arm % 2 ? "rgba(248,164,105,.16)" : "rgba(255,218,176,.22)";
        context.lineWidth = arm % 2 ? 1.2 : 2;
        context.shadowBlur = 0;
        context.stroke();
      }

      const streamRadius = Math.max(width, height) * 0.88;
      for (let stream = 0; stream < 18; stream += 1) {
        const angle = (stream / 18) * Math.PI * 2 + turn * 1.6;
        const flow = 0.12 + ((stream * 7) % 11) / 16;
        const head = pointOnCurve(angle, streamRadius, 0.36 + Math.sin(elapsed / 450 + stream) * 0.18, flow);
        const tail = pointOnCurve(angle, streamRadius, 0.36 + Math.sin(elapsed / 450 + stream) * 0.18, Math.max(0, flow - 0.11));
        context.beginPath();
        context.moveTo(tail.x, tail.y);
        context.quadraticCurveTo(origin.x + Math.cos(angle - 0.4) * streamRadius * 0.28, origin.y + Math.sin(angle - 0.4) * streamRadius * 0.22, head.x, head.y);
        context.strokeStyle = stream % 4 === 0 ? "rgba(255,231,203,.62)" : "rgba(248,164,105,.27)";
        context.lineWidth = stream % 6 === 0 ? 1.35 : 0.7;
        context.shadowBlur = 0;
        context.stroke();
      }

      particles.forEach((particle, index) => {
        const life = revealing
          ? Math.max(0, Math.min(1, rawProgress * 1.55 - particle.delay * 0.54))
          : (elapsed * (0.00016 + particle.size * 0.00002) + particle.delay) % 1;
        if (revealing && life <= 0) return;
        const fall = revealing ? life : 0.25 + life * 0.66;
        const radius = maxRadius * particle.startRadius * Math.pow(1 - fall, 1.32);
        const angle = particle.angle + particle.drift * fall + turn * (index % 2 ? 2.4 : -2.1);
        const x = origin.x + Math.cos(angle) * radius;
        const y = origin.y + Math.sin(angle) * radius * 0.78;
        const tailRadius = radius + Math.min(36, 7 + particle.size * 7);
        const tx = origin.x + Math.cos(angle - 0.1) * tailRadius;
        const ty = origin.y + Math.sin(angle - 0.1) * tailRadius * 0.78;
        const alpha = revealing ? Math.sin(Math.PI * Math.max(0.02, life)) * 0.88 : 0.35 + Math.sin(elapsed / 180 + index) * 0.24;
        context.beginPath();
        context.moveTo(tx, ty);
        context.lineTo(x, y);
        context.globalAlpha = alpha;
        context.strokeStyle = `hsl(${particle.hue}, 92%, ${index % 4 === 0 ? 82 : 68}%)`;
        context.lineWidth = particle.size;
        context.shadowBlur = 0;
        context.stroke();
        if (index % 3 === 0) {
          context.fillStyle = "#ffe2c4";
          context.fillRect(x - particle.size * 0.45, y - particle.size * 0.45, particle.size * 0.9, particle.size * 0.9);
        }
      });
      context.globalAlpha = 1;
      context.restore();

      if (!reduceMotion) frame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [homeStage, origin, phase, revealing]);

  return <div ref={shell} className={`${styles.portal} ${homeStage ? styles.homeStage : ""}`} data-testid="home-aperture-portal" data-transition-phase={phase} aria-hidden="true">
    {!homeStage && <div className={styles.curtain} />}
    <canvas ref={canvasRef} className={styles.particleField} />
  </div>;
}
