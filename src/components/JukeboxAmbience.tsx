"use client";

import { useEffect, useState } from "react";
import { ambienceRunning, isMuted, playCoinInsert, setMuted, startAmbienceAfter, stopAmbience } from "@/lib/siteAudio";

/**
 * The diner ambience, and the only control for it.
 *
 * Browsers refuse to start audio before a real user gesture, and they are right
 * to — so nothing plays on load. The first click anywhere drops a coin, and the
 * music fades up behind it. After that the speaker in the corner is the switch,
 * and the choice is remembered.
 *
 * Kept quiet on purpose: background audio on a site is a liability if it can't
 * be found and turned off in a second.
 */
export function JukeboxAmbience() {
  const [muted, setMutedState] = useState(true);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const startedMuted = isMuted();
    setMutedState(startedMuted);
    if (startedMuted) return; // they've turned it off before — don't ask again

    /**
     * Arm on the first genuine interaction. `once` plus removal on unmount, so
     * this can never fire twice and start two jukeboxes.
     */
    const arm = () => {
      if (ambienceRunning()) return;
      const delay = playCoinInsert(); // the coin goes in first
      startAmbienceAfter(delay);
      setArmed(true);
    };
    const opts = { once: true, passive: true } as AddEventListenerOptions;
    window.addEventListener("pointerdown", arm, opts);
    window.addEventListener("keydown", arm, opts);
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);

  const toggle = () => {
    const next = !muted;
    setMutedState(next);
    setMuted(next);
    if (next) {
      stopAmbience();
      return;
    }
    // turning it back on: coin first, same as the first time
    const delay = playCoinInsert();
    startAmbienceAfter(delay);
    setArmed(true);
  };

  return (
    <button
      onClick={toggle}
      className="jukebox-toggle"
      aria-label={muted ? "Turn on the background music" : "Turn off the background music"}
      aria-pressed={!muted}
      title={muted ? "Sound on" : "Sound off"}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
        <path d="M4 9.5v5h3.2L12 18.5v-13L7.2 9.5H4Z" />
        {muted ? (
          <path d="M16.5 9.5l4 5m0-5l-4 5" />
        ) : (
          <>
            <path d="M15.8 9.4a3.6 3.6 0 0 1 0 5.2" />
            <path d="M18.4 7.2a7 7 0 0 1 0 9.6" className={armed ? "jukebox-wave" : ""} />
          </>
        )}
      </svg>
    </button>
  );
}
