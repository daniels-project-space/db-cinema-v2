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
    const style = { "--letter-index": letterIndex, "--letter-delay": `${delay + letterIndex * stagger}ms`, "--strain-delay": `${letterIndex % 9 * 24}ms`, "--letter-twist": `${(letterIndex % 2 ? 1 : -1) * (8 + letterIndex % 9 * 2)}deg` } as CSSProperties;
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
  const releasedLetters = useRef<Array<{ letter: HTMLElement; transform: string }>>([]);
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
    if (phase !== "charging" || !section.current || !iris.current) return;
    const target = iris.current.getBoundingClientRect();
    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;
    const letters = Array.from(section.current.querySelectorAll<HTMLElement>("[data-portal-letter]"), letter => ({ letter, rect: letter.getBoundingClientRect() }));
    letters.forEach(({ letter, rect }) => {
      letter.style.setProperty("--pull-x", `${targetX - rect.left - rect.width / 2}px`);
      letter.style.setProperty("--pull-y", `${targetY - rect.top - rect.height / 2}px`);
      letter.style.setProperty("--strain-x", `${Math.max(-12, Math.min(12, (targetX - rect.left - rect.width / 2) * .045))}px`);
      letter.style.setProperty("--strain-y", `${Math.max(-12, Math.min(12, (targetY - rect.top - rect.height / 2) * .045))}px`);
    });
  }, [phase]);

  useLayoutEffect(() => {
    if (phase !== "canceling") return;
    releasedLetters.current.forEach(({ letter, transform }) => {
      letter.animate([{ transform }, { transform: "none" }], { duration: 480, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
    releasedLetters.current = [];
  }, [phase]);

  useLayoutEffect(() => {
    if (!committed || !section.current || !iris.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const copyElement = section.current.querySelector<HTMLElement>("[data-portal-copy]");
    if (!copyElement) return;
    const target = iris.current.getBoundingClientRect();
    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;
    const copyTransform = getComputedStyle(copyElement).transform;
    const letters = Array.from(copyElement.querySelectorAll<HTMLElement>("[data-portal-letter]"), letter => {
      const rect = letter.getBoundingClientRect();
      const computed = getComputedStyle(letter);
      return {
        letter,
        transform: computed.transform === "none" ? "translate(0px, 0px)" : computed.transform,
        delay: parseFloat(computed.getPropertyValue("--letter-delay")) || 0,
        twist: parseFloat(computed.getPropertyValue("--letter-twist")) || 0,
        x: targetX - rect.left - rect.width / 2,
        y: targetY - rect.top - rect.height / 2,
      };
    });
    copyElement.style.animation = "none";
    copyElement.style.transform = copyTransform;
    const animations = letters.map(({ letter, transform, delay, twist, x, y }) => {
      letter.style.animation = "none";
      return letter.animate([
        { transform, opacity: 1, offset: 0 },
        { transform: `translate(${x * .16}px, ${y * .16}px) ${transform} rotate(${twist * -.2}deg) scale(1.02)`, opacity: 1, offset: .42 },
        { transform: `translate(${x * .7}px, ${y * .7}px) ${transform} rotate(${twist}deg) scale(.58)`, opacity: .95, offset: .8 },
        { transform: `translate(${x}px, ${y}px) ${transform} rotate(${twist * 1.4}deg) scale(.015)`, opacity: 0, offset: 1 },
      ], { duration: 1200, delay, easing: "cubic-bezier(.45,0,.6,1)", fill: "both" });
    });
    return () => {
      animations.forEach(animation => animation.cancel());
      copyElement.style.removeProperty("animation");
      copyElement.style.removeProperty("transform");
      letters.forEach(({ letter }) => letter.style.removeProperty("animation"));
    };
  }, [committed]);

  const start = () => begin(apertureButton.current);
  const release = () => {
    if (phase === "charging" && section.current) {
      releasedLetters.current = Array.from(section.current.querySelectorAll<HTMLElement>("[data-portal-copy], [data-portal-letter]"), letter => ({ letter, transform: getComputedStyle(letter).transform }));
    }
    cancel();
  };
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") start();
  };
  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") release();
  };

  return <section ref={section} className={`section-window relative overflow-hidden px-6 py-28 text-center ${styles.section}`} aria-labelledby="home-closing-title">
    <div className={styles.lights} aria-hidden="true"><span/><span/><span/><span/><span/><span/></div>
    <div className={`${styles.content} ${phase === "charging" || committed ? styles.anticipating : ""} ${committed ? styles.sucked : ""}`}>
      <div className={styles.accessibleCopy}>
        <p>Your story is waiting</p><h2 id="home-closing-title">Your next shot starts here.</h2><p>Pick your dates, build your kit, and get back to the work that matters.</p>
      </div>
      <div data-portal-copy className={styles.visibleCopy} aria-hidden="true">
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
        onPointerLeave={event => { if (event.pointerType !== "touch") release(); }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={release}
        onFocus={start}
        onBlur={release}
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
