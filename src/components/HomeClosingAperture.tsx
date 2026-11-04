"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import styles from "./HomeClosingAperture.module.css";

type Phase = "idle" | "charging" | "committed";

const copy = [
  { text: "Your story is waiting", className: styles.kicker, delay: 0, stagger: 14 },
  { text: "Your next shot starts here.", className: styles.title, delay: 320, stagger: 12 },
  { text: "Pick your dates, build your kit, and get back to the work that matters.", className: styles.description, delay: 750, stagger: 6 },
];

function LetteredCopy({ text, className, delay, stagger }: { text: string; className: string; delay: number; stagger: number }) {
  return <span className={className} aria-hidden="true">{Array.from(text).map((letter, letterIndex) => {
    const style = { "--letter-index": letterIndex, "--letter-delay": `${delay + letterIndex * stagger}ms`, "--letter-twist": `${letterIndex * 7}deg` } as CSSProperties;
    return letter === " "
      ? <span key={letterIndex} data-portal-letter className={`${styles.letter} ${styles.space}`} style={style}>{"\u00a0"}</span>
      : <span key={letterIndex} data-portal-letter className={styles.letter} style={style}>{letter}</span>;
  })}</span>;
}

export function HomeClosingAperture() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [portalOrigin, setPortalOrigin] = useState<{ x: number; y: number } | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const timers = useRef<number[]>([]);
  const section = useRef<HTMLElement>(null);
  const apertureButton = useRef<HTMLButtonElement>(null);
  const iris = useRef<HTMLSpanElement>(null);

  const clearTimers = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  }, []);

  const enterGear = useCallback(() => {
    clearTimers();
    router.push("/gear");
  }, [clearTimers, router]);

  const begin = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    router.prefetch("/gear");
    phaseRef.current = "charging";
    setPhase("charging");
    timers.current.push(window.setTimeout(() => {
      phaseRef.current = "committed";
      setPhase("committed");
      timers.current.push(window.setTimeout(enterGear, 2500));
    }, 2500));
  }, [enterGear]);

  const cancel = useCallback(() => {
    if (phaseRef.current !== "charging") return;
    clearTimers();
    phaseRef.current = "idle";
    setPhase("idle");
  }, [clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (phase !== "committed") return;
    const documentOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = documentOverflow;
      document.body.style.overflow = bodyOverflow;
    };
  }, [phase]);

  useLayoutEffect(() => {
    if (phase !== "committed" || !section.current || !iris.current) return;
    const target = iris.current.getBoundingClientRect();
    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;
    setPortalOrigin(current => current && Math.abs(current.x - targetX) < 0.5 && Math.abs(current.y - targetY) < 0.5 ? current : { x: targetX, y: targetY });
    section.current.querySelectorAll<HTMLElement>("[data-portal-letter]").forEach(letter => {
      const rect = letter.getBoundingClientRect();
      letter.style.setProperty("--pull-x", `${targetX - rect.left - rect.width / 2}px`);
      letter.style.setProperty("--pull-y", `${targetY - rect.top - rect.height / 2}px`);
    });
  }, [phase]);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") begin();
  };
  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") cancel();
  };
  const handlePreviewLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    try {
      const page = event.currentTarget.contentDocument;
      setPreviewLoaded(Boolean(page?.body?.children.length && page.location.origin === window.location.origin));
    } catch {
      setPreviewLoaded(false);
    }
  };

  return <>
    <section ref={section} className={`section-window relative overflow-hidden px-6 py-28 text-center ${styles.section}`} aria-labelledby="home-closing-title">
      <div className={styles.lights} aria-hidden="true"><span/><span/><span/><span/><span/></div>
      <div className={`${styles.content} ${phase === "committed" ? styles.sucked : ""}`}>
        <div className={styles.accessibleCopy}>
          <p>Your story is waiting</p><h2 id="home-closing-title">Your next shot starts here.</h2><p>Pick your dates, build your kit, and get back to the work that matters.</p>
        </div>
        <div className={styles.visibleCopy} aria-hidden="true">
          {copy.map(line => <LetteredCopy key={line.text} {...line} />)}
        </div>
        <button
          type="button"
          ref={apertureButton}
          data-testid="home-aperture-button"
          className={`${styles.irisButton} ${phase !== "idle" ? styles.active : ""} ${phase === "committed" ? styles.committed : ""}`}
          aria-label="Press and hold or keep focused to open the gear catalogue"
          aria-describedby="home-aperture-hint"
          aria-busy={phase !== "idle"}
          onPointerEnter={event => { if (event.pointerType !== "touch") begin(); }}
          onPointerLeave={event => { if (event.pointerType !== "touch") cancel(); }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancel}
          onFocus={begin}
          onBlur={cancel}
          onClick={event => {
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) enterGear();
            else if (event.detail === 0) begin();
          }}
        >
          <span ref={iris} data-testid="home-aperture-iris" className={styles.aperture} aria-hidden="true">
            <svg className={styles.blades} viewBox="0 0 120 120" focusable="false">
              <defs><radialGradient id="aperture-core"><stop offset="0" stopColor="#050506"/><stop offset=".58" stopColor="#100d10"/><stop offset="1" stopColor="#703615"/></radialGradient></defs>
              <circle cx="60" cy="60" r="57" className={styles.outerRing}/>
              <circle cx="60" cy="60" r="49" className={styles.innerRing}/>
              <circle cx="60" cy="60" r="34" fill="url(#aperture-core)" />
              {[0, 60, 120, 180, 240, 300].map(angle => <g key={angle} transform={`rotate(${angle} 60 60)`} className={styles.blade}>
                <path d="M60 12 C77 15 91 27 98 43 L68 58 C63 49 58 44 50 40 Z" />
              </g>)}
              <circle cx="60" cy="60" r="8" className={styles.core} />
              <circle cx="60" cy="60" r="3" className={styles.coreGlint} />
            </svg>
            <span className={styles.apertureHalo}/><span className={styles.aperturePulse}/>
          </span>
          <span className={styles.buttonLabel}>Open the gear room <span aria-hidden="true">↗</span></span>
        </button>
        <p id="home-aperture-hint" className={styles.hint} aria-live="polite">
          {phase === "idle" ? "Hover, focus, or press and hold to enter" : phase === "charging" ? "Hold steady · the iris is opening" : "Committed · completing in 2.5 seconds"}
        </p>
        {phase !== "idle" && <div className={`${styles.progressTrack} ${phase === "committed" ? styles.progressCommitted : ""}`} role="progressbar" aria-label="Opening the gear catalogue" aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase === "committed" ? 100 : 50}><span/></div>}
      </div>
    </section>
    {phase === "committed" && typeof document !== "undefined" && createPortal(<div data-testid="home-aperture-portal" style={portalOrigin ? { "--portal-x": `${portalOrigin.x}px`, "--portal-y": `${portalOrigin.y}px` } as CSSProperties : undefined} className={styles.portal} aria-hidden="true">
      <iframe className={`${styles.gearPage} ${previewLoaded ? styles.gearPageReady : ""}`} src="/gear" title="Gear catalogue preview" tabIndex={-1} loading="eager" onLoad={handlePreviewLoad}/>
      <div className={styles.accretion} />
      <div className={styles.vortex}/>
      <div className={styles.wind}>
        {Array.from({ length: 32 }, (_, index) => <i key={index} style={{ "--wind-index": index, "--wind-angle": `${index * 11.25}deg`, "--wind-x": `${(index - 15.5) * 2.5}%`, "--wind-y": `${(index - 15.5) * 1.5}%`, "--wind-width": `${70 + index % 8 * 16}px`, "--wind-travel": `${38 + index % 5 * 6}vw`, "--wind-delay": `${index * 42}ms` } as CSSProperties}/>) }
      </div>
      <div className={styles.portalCore}/>
    </div>, document.body)}
  </>;
}
