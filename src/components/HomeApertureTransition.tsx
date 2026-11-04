"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { HomeApertureArt } from "./HomeApertureArt";
import irisStyles from "./HomeClosingAperture.module.css";
import styles from "./HomeApertureTransition.module.css";

type TransitionPhase = "idle" | "charging" | "canceling" | "committed" | "navigating" | "revealing";
type TransitionContextValue = { phase: TransitionPhase; begin: (source?: HTMLElement | null) => void; cancel: () => void; openNow: (source?: HTMLElement | null) => void };
type Origin = { x: number; y: number; size: number };
const TransitionContext = createContext<TransitionContextValue | null>(null);
const CHARGE_MS = 2500;
const REVEAL_MS = 1800;

export function HomeApertureTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const [origin, setOrigin] = useState<Origin>({ x: 0, y: 0, size: 132 });
  const [run, setRun] = useState(0);
  const phaseRef = useRef<TransitionPhase>("idle");
  const timers = useRef<number[]>([]);
  const clearTimers = useCallback(() => { timers.current.forEach(window.clearTimeout); timers.current = []; }, []);
  const setCurrentPhase = useCallback((next: TransitionPhase) => { phaseRef.current = next; setPhase(next); }, []);

  const begin = useCallback((source?: HTMLElement | null) => {
    if (phaseRef.current !== "idle" && phaseRef.current !== "canceling") return;
    clearTimers();
    router.prefetch("/gear");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { router.push("/gear"); return; }
    const aperture = source?.querySelector<HTMLElement>("[data-testid='home-aperture-iris']") ?? source;
    const rect = aperture?.getBoundingClientRect();
    setOrigin(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: rect.width } : { x: window.innerWidth / 2, y: window.innerHeight / 2, size: 132 });
    setRun(value => value + 1);
    setCurrentPhase("charging");
    timers.current.push(window.setTimeout(() => {
      if (phaseRef.current !== "charging") return;
      setCurrentPhase("committed");
      timers.current.push(window.setTimeout(() => {
        if (phaseRef.current !== "committed") return;
        setCurrentPhase("navigating");
        router.push("/gear");
        timers.current.push(window.setTimeout(() => { if (phaseRef.current === "navigating") setCurrentPhase("idle"); }, 15_000));
      }, 1700));
    }, CHARGE_MS));
  }, [clearTimers, router, setCurrentPhase]);

  const cancel = useCallback(() => {
    if (phaseRef.current !== "charging") return;
    clearTimers();
    setCurrentPhase("canceling");
    timers.current.push(window.setTimeout(() => setCurrentPhase("idle"), 400));
  }, [clearTimers, setCurrentPhase]);

  const openNow = useCallback((source?: HTMLElement | null) => {
    if (phaseRef.current === "committed" || phaseRef.current === "navigating" || phaseRef.current === "revealing") return;
    clearTimers();
    router.prefetch("/gear");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setCurrentPhase("idle"); router.push("/gear"); return; }
    if (phaseRef.current !== "charging") {
      const aperture = source?.querySelector<HTMLElement>("[data-testid='home-aperture-iris']") ?? source;
      const rect = aperture?.getBoundingClientRect();
      setOrigin(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: rect.width } : { x: window.innerWidth / 2, y: window.innerHeight / 2, size: 132 });
      setRun(value => value + 1);
    }
    setCurrentPhase("navigating");
    router.push("/gear");
    timers.current.push(window.setTimeout(() => { if (phaseRef.current === "navigating") setCurrentPhase("idle"); }, 15_000));
  }, [clearTimers, router, setCurrentPhase]);

  useLayoutEffect(() => {
    if (phase !== "navigating" || pathname !== "/gear") return;
    clearTimers();
    window.scrollTo({ top: 0, behavior: "instant" });
    const rect = document.getElementById("main-content")?.getBoundingClientRect();
    const horizon = document.querySelector<HTMLElement>("[data-testid='home-aperture-horizon']")?.getBoundingClientRect();
    const initialRadius = Math.max(4, (horizon?.width ?? 16) * .46);
    const finalRadius = Math.hypot(Math.max(origin.x, window.innerWidth - origin.x), Math.max(origin.y, window.innerHeight - origin.y)) + 8;
    document.body.style.setProperty("--aperture-main-x", `${origin.x - (rect?.left ?? 0)}px`);
    document.body.style.setProperty("--aperture-main-y", `${origin.y - (rect?.top ?? 0)}px`);
    document.body.style.setProperty("--aperture-reveal-start", `${initialRadius}px`);
    document.body.style.setProperty("--aperture-reveal-end", `${Math.max(initialRadius, finalRadius)}px`);
    setCurrentPhase("revealing");
    timers.current.push(window.setTimeout(() => setCurrentPhase("idle"), REVEAL_MS));
  }, [clearTimers, origin, pathname, phase, setCurrentPhase]);

  useLayoutEffect(() => {
    if (phase === "idle") {
      delete document.body.dataset.apertureTransition;
      document.body.style.removeProperty("--aperture-main-x");
      document.body.style.removeProperty("--aperture-main-y");
      document.body.style.removeProperty("--aperture-reveal-start");
      document.body.style.removeProperty("--aperture-reveal-end");
    } else document.body.dataset.apertureTransition = phase;
  }, [phase]);
  useEffect(() => () => { clearTimers(); delete document.body.dataset.apertureTransition; }, [clearTimers]);
  const value = useMemo(() => ({ phase, begin, cancel, openNow }), [begin, cancel, openNow, phase]);
  return <TransitionContext.Provider value={value}>
    {children}
    {phase !== "idle" && typeof document !== "undefined" ? createPortal(<ApertureTransitionOverlay key={run} origin={origin} phase={phase} />, document.body) : null}
  </TransitionContext.Provider>;
}

export function useHomeApertureTransition() {
  const value = useContext(TransitionContext);
  if (!value) throw new Error("HomeApertureTransitionProvider is missing");
  return value;
}

function ApertureTransitionOverlay({ origin, phase }: { origin: Origin; phase: Exclude<TransitionPhase, "idle"> }) {
  const committed = phase === "committed" || phase === "navigating" || phase === "revealing";
  const style = { "--aperture-x": `${origin.x}px`, "--aperture-y": `${origin.y}px`, "--iris-size": `${origin.size}px` } as CSSProperties;
  return <div data-testid="home-aperture-portal" data-transition-phase={phase} className={`${styles.portal} ${committed ? styles.committed : ""} ${phase === "canceling" ? styles.canceling : ""}`} style={style} aria-hidden="true">
    <div className={styles.curtain}/>
    <div className={styles.wind}>
      <svg viewBox="-500 -500 1000 1000" className={styles.windArt}>
        <defs><linearGradient id="aperture-wind" x1="0" x2="1" y1="0" y2="0"><stop stopColor="#ffb17b" stopOpacity="0"/><stop offset=".58" stopColor="#ffc99e" stopOpacity=".72"/><stop offset="1" stopColor="#f39a61" stopOpacity="0"/></linearGradient></defs>
        {Array.from({ length: 24 }, (_, index) => <path key={index} className={styles.stream} style={{ "--stream-delay": `${index % 8 * 230}ms` } as CSSProperties} transform={`rotate(${index * 15})`} d={index % 2 ? "M-490 -110 C-320 -160 -170 -145 -65 -30" : "M-500 35 C-310 -70 -180 -100 -70 -24"} />)}
        <ellipse className={styles.orbit} rx="210" ry="70"/><ellipse className={styles.orbitInner} rx="155" ry="50"/>
      </svg>
    </div>
    <div data-testid="home-aperture-portal-iris" className={`${styles.portalIris} ${irisStyles.active}`}><span className={irisStyles.aperture}><HomeApertureArt id="portal-aperture" /></span></div>
    <div data-testid="home-aperture-horizon" className={styles.horizon}/>
  </div>;
}
