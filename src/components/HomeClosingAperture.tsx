"use client";

import { useLayoutEffect, useRef } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { useHomeApertureTransition } from "./HomeApertureTransition";
import styles from "./HomeClosingAperture.module.css";

const copy = [
  { text: "Your story is waiting", className: styles.kicker, delay: 0, stagger: 12 },
  { text: "Your next shot starts here.", className: styles.title, delay: 190, stagger: 10 },
  { text: "Pick your dates, build your kit, and get back to the work that matters.", className: styles.description, delay: 460, stagger: 5 },
];

function LetteredCopy({ text, className, delay, stagger }: { text: string; className: string; delay: number; stagger: number }) {
  return <span className={className} aria-hidden="true">{Array.from(text).map((letter, letterIndex) => {
    const style = { "--letter-index": letterIndex, "--letter-delay": `${delay + letterIndex * stagger}ms`, "--letter-twist": `${(letterIndex % 2 ? 1 : -1) * (8 + letterIndex % 9 * 2)}deg` } as CSSProperties;
    return letter === " "
      ? <span key={letterIndex} data-portal-letter className={`${styles.letter} ${styles.space}`} style={style}>{"\u00a0"}</span>
      : <span key={letterIndex} data-portal-letter className={styles.letter} style={style}>{letter}</span>;
  })}</span>;
}

export function HomeClosingAperture() {
  const { phase, progress, begin, cancel } = useHomeApertureTransition();
  const section = useRef<HTMLElement>(null);
  const apertureButton = useRef<HTMLButtonElement>(null);
  const iris = useRef<HTMLSpanElement>(null);
  const engaged = phase !== "idle";
  const committed = phase === "committed" || phase === "revealing";

  useLayoutEffect(() => {
    if (!committed || !section.current || !iris.current) return;
    const target = iris.current.getBoundingClientRect();
    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;
    section.current.querySelectorAll<HTMLElement>("[data-portal-letter]").forEach(letter => {
      const rect = letter.getBoundingClientRect();
      letter.style.setProperty("--pull-x", `${targetX - rect.left - rect.width / 2}px`);
      letter.style.setProperty("--pull-y", `${targetY - rect.top - rect.height / 2}px`);
    });
  }, [committed]);

  const start = () => begin(apertureButton.current);
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") start();
  };
  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") cancel();
  };

  return <section ref={section} className={`section-window relative overflow-hidden px-6 py-28 text-center ${styles.section}`} aria-labelledby="home-closing-title">
    <div className={styles.lights} aria-hidden="true"><span/><span/><span/><span/><span/><span/></div>
    <div className={`${styles.content} ${committed ? styles.sucked : ""}`}>
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
        className={`${styles.irisButton} ${engaged ? styles.active : ""} ${phase === "charging" ? styles.charging : ""} ${committed ? styles.committed : ""}`}
        aria-label="Press and hold or keep focused to open the gear catalogue"
        aria-describedby="home-aperture-hint"
        aria-busy={engaged}
        onPointerEnter={event => { if (event.pointerType !== "touch") start(); }}
        onPointerLeave={event => { if (event.pointerType !== "touch") cancel(); }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancel}
        onFocus={start}
        onBlur={cancel}
        onClick={event => { if (event.detail === 0) start(); }}
      >
        <span ref={iris} data-testid="home-aperture-iris" className={styles.aperture} aria-hidden="true">
          <svg className={styles.blades} viewBox="0 0 120 120" focusable="false">
            <defs>
              <radialGradient id="home-aperture-depth"><stop offset="0" stopColor="#010102"/><stop offset=".58" stopColor="#090809"/><stop offset=".9" stopColor="#160f0b"/><stop offset="1" stopColor="#030304"/></radialGradient>
              <linearGradient id="home-aperture-metal" x1=".1" y1=".12" x2=".88" y2=".93"><stop offset="0" stopColor="#fff0d8"/><stop offset=".12" stopColor="#9f623d"/><stop offset=".38" stopColor="#34231b"/><stop offset=".64" stopColor="#d38a56"/><stop offset=".82" stopColor="#513324"/><stop offset="1" stopColor="#f4bd8b"/></linearGradient>
              <linearGradient id="home-aperture-edge" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff0d8" stopOpacity=".68"/><stop offset=".45" stopColor="#df9562" stopOpacity=".14"/><stop offset="1" stopColor="#1c100a" stopOpacity=".7"/></linearGradient>
              <filter id="home-aperture-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>
            <circle cx="60" cy="60" r="57" className={styles.outerRing}/>
            <circle cx="60" cy="60" r="52" className={styles.trackRing}/>
            <circle cx="60" cy="60" r="47" className={styles.innerRing}/>
            <g className={styles.ticks}>{Array.from({ length: 48 }, (_, index) => <line key={index} x1="60" y1={index % 4 === 0 ? 3.5 : 4.5} x2="60" y2={index % 4 === 0 ? 9 : 7} transform={`rotate(${index * 7.5} 60 60)`} className={index % 4 === 0 ? styles.majorTick : ""}/>)}</g>
            <circle cx="60" cy="60" r="47" fill="url(#home-aperture-depth)" />
            <g className={styles.bladeStack}>
              {Array.from({ length: 8 }, (_, index) => <g key={index} transform={`rotate(${index * 45} 60 60)`}>
                <g className={styles.blade} data-aperture-blade="">
                  <path className={styles.bladeFace} d="M55 14 C73 9 92 17 104 30 L87 43 C78 33 67 27 53 29 Z" />
                  <path className={styles.bladeHighlight} d="M55 15 C73 10 91 18 102 30" />
                </g>
              </g>)}
            </g>
            <circle cx="60" cy="60" r="20" fill="url(#home-aperture-depth)" className={styles.core}/>
            <circle cx="60" cy="60" r="20" className={styles.coreRim}/>
            <circle cx="60" cy="60" r="4" className={styles.coreGlint}/>
            <g className={styles.screws}>{Array.from({ length: 8 }, (_, index) => <g key={index} transform={`rotate(${index * 45} 60 60)`}><circle cx="60" cy="8" r="1.4"/><path d="M59.1 8h1.8"/></g>)}</g>
          </svg>
          <span className={styles.apertureHalo}/><span className={styles.aperturePulse}/><span className={styles.apertureFlare}/>
        </span>
        <span className={styles.buttonLabel}>Open the gear room <span aria-hidden="true">↗</span></span>
      </button>
      <p id="home-aperture-hint" className={styles.hint} aria-live="polite">
        {phase === "idle" ? "Hover, focus, or press and hold to enter" : phase === "charging" ? "Hold steady · the iris is opening" : "Committed · opening the gear room"}
      </p>
      {engaged && <div className={`${styles.progressTrack} ${committed ? styles.progressCommitted : ""}`} role="progressbar" aria-label="Opening the gear catalogue" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ "--charge-progress": `${progress * 100}%` } as CSSProperties}/></div>}
    </div>
  </section>;
}
