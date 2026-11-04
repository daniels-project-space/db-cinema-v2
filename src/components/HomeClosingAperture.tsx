"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { HomeApertureArt } from "./HomeApertureArt";
import { useHomeApertureTransition } from "./HomeApertureTransition";
import styles from "./HomeClosingAperture.module.css";

const copy = [
  { text: "Your story is waiting", className: styles.kicker, delay: 0, stagger: 9 },
  { text: "Your next shot starts here.", className: styles.title, delay: 130, stagger: 7 },
  { text: "Pick your dates, build your kit, and get back to the work that matters.", className: styles.description, delay: 250, stagger: 3 },
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
  const { phase, begin, cancel, openNow } = useHomeApertureTransition();
  const section = useRef<HTMLElement>(null);
  const apertureButton = useRef<HTMLButtonElement>(null);
  const iris = useRef<HTMLSpanElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const engaged = phase !== "idle" && phase !== "canceling";
  const committed = phase === "committed" || phase === "navigating" || phase === "revealing";

  useEffect(() => {
    if (committed) { progress.current?.setAttribute("aria-valuenow", "100"); return; }
    if (phase !== "charging") return;
    const started = performance.now();
    const timer = window.setInterval(() => progress.current?.setAttribute("aria-valuenow", String(Math.min(100, Math.round((performance.now() - started) / 25)))), 200);
    return () => window.clearInterval(timer);
  }, [committed, phase]);

  useLayoutEffect(() => {
    if (!committed || !section.current || !iris.current) return;
    const target = iris.current.getBoundingClientRect();
    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;
    const letters = Array.from(section.current.querySelectorAll<HTMLElement>("[data-portal-letter]"), letter => ({ letter, rect: letter.getBoundingClientRect() }));
    letters.forEach(({ letter, rect }) => {
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
        aria-label="Click to open the gear catalogue, or hold for the full transition"
        aria-describedby="home-aperture-hint"
        aria-busy={engaged}
        onPointerEnter={event => { if (event.pointerType !== "touch") start(); }}
        onPointerLeave={event => { if (event.pointerType !== "touch") cancel(); }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancel}
        onFocus={start}
        onBlur={cancel}
        onClick={() => openNow(apertureButton.current)}
      >
        <span ref={iris} data-testid="home-aperture-iris" className={styles.aperture} aria-hidden="true">
          <HomeApertureArt id="home-aperture" />
          <span className={styles.apertureHalo}/><span className={styles.aperturePulse}/><span className={styles.apertureFlare}/>
        </span>
        <span className={styles.buttonLabel}>Open the gear room <span aria-hidden="true">↗</span></span>
      </button>
      <p id="home-aperture-hint" className={styles.hint} aria-live="polite">
        {!engaged ? "Click to enter, or hover and hold for the full reveal" : phase === "charging" ? "Click to enter now · or hold for the full reveal" : "Committed · opening the gear room"}
      </p>
      {engaged && <div ref={progress} className={`${styles.progressTrack} ${committed ? styles.progressCommitted : ""}`} role="progressbar" aria-label="Opening the gear catalogue" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}><span /></div>}
    </div>
  </section>;
}
