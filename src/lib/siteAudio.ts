"use client";

/**
 * The sound of the site, synthesised rather than shipped.
 *
 * Every cue here is generated with Web Audio at runtime: no audio files to
 * download on a page that already streams three hero clips, no licensing to
 * track, and each sound can be shaped in code rather than re-exported.
 *
 * Two rules the browser imposes, both handled here:
 *   - no audio may start before a real user gesture, so the context is created
 *     lazily and the ambience waits for the first click
 *   - a suspended context must be resumed explicitly after a tab switch
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

const MUTE_KEY = "dbc_audio_muted";

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* private mode */
  }
  if (master && ctx) {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.25);
  }
}

/** Lazily create the context. Returns null before any user gesture. */
function audio(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = isMuted() ? 0 : 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return { ctx, master: master! };
}

/** A short noise burst — the grit inside a physical sound. */
function noise(a: AudioContext, seconds: number) {
  const buffer = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * seconds)), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buffer;
  return src;
}

/**
 * Hovering the FORM / SEVEN coin: a high, short synth blip.
 *
 * Deliberately tiny — this fires on mouse-over, so anything with a tail would
 * stack into a mess when someone sweeps across the header.
 */
export function playCoinHover() {
  const a = audio();
  if (!a || isMuted()) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1180, t);
  osc.frequency.exponentialRampToValueAtTime(1720, t + 0.07);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.07, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

  // a touch of air above it so it reads as synth rather than beep
  const shimmer = c.createOscillator();
  const shimmerGain = c.createGain();
  shimmer.type = "sine";
  shimmer.frequency.setValueAtTime(2360, t);
  shimmerGain.gain.setValueAtTime(0.0001, t);
  shimmerGain.gain.exponentialRampToValueAtTime(0.022, t + 0.02);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

  osc.connect(gain).connect(out);
  shimmer.connect(shimmerGain).connect(out);
  osc.start(t); shimmer.start(t);
  osc.stop(t + 0.2); shimmer.stop(t + 0.2);
}

/**
 * Clicking the coin: the "match found" clash.
 *
 * Built the way that family of sounds is built — a metallic strike layered over
 * a low impact, with a bright noise transient on the front and a long ringing
 * tail. The inharmonic partials are what make it read as struck metal rather
 * than a chord.
 */
export function playCoinClash() {
  const a = audio();
  if (!a || isMuted()) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;

  const bus = c.createGain();
  bus.gain.value = 0.9;
  bus.connect(out);

  // 1. the strike — bright noise through a high band, very short
  const hit = noise(c, 0.25);
  const hitFilter = c.createBiquadFilter();
  hitFilter.type = "bandpass";
  hitFilter.frequency.setValueAtTime(3200, t);
  hitFilter.Q.value = 0.8;
  const hitGain = c.createGain();
  hitGain.gain.setValueAtTime(0.5, t);
  hitGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  hit.connect(hitFilter).connect(hitGain).connect(bus);

  // 2. the body — inharmonic partials, i.e. metal rather than a note
  const partials = [523.25, 784, 1046.5, 1567.98, 2093, 2637];
  partials.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = i < 2 ? "triangle" : "sine";
    // detune the upper partials off the harmonic series so it clangs
    osc.frequency.setValueAtTime(freq * (1 + i * 0.006), t);
    const peak = 0.16 / (i + 1.4);
    const tail = 1.9 - i * 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + tail);
    osc.connect(gain).connect(bus);
    osc.start(t);
    osc.stop(t + tail + 0.05);
  });

  // 3. the weight underneath — the thump that makes it feel like an event
  const sub = c.createOscillator();
  const subGain = c.createGain();
  sub.type = "sine";
  sub.frequency.setValueAtTime(150, t);
  sub.frequency.exponentialRampToValueAtTime(48, t + 0.5);
  subGain.gain.setValueAtTime(0.0001, t);
  subGain.gain.exponentialRampToValueAtTime(0.34, t + 0.02);
  subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
  sub.connect(subGain).connect(bus);

  hit.start(t);
  sub.start(t);
  sub.stop(t + 0.9);
}

/**
 * A coin dropping into the jukebox: the clink, the fall, the mechanism.
 * Plays once, immediately before the music starts.
 */
export function playCoinInsert(): number {
  const a = audio();
  if (!a || isMuted()) return 0;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;

  // two bright clinks, the second slightly lower — coin against slot, then drop
  [0, 0.11].forEach((offset, i) => {
    const when = t + offset;
    [2400, 3350, 4700].forEach((freq, j) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * (i ? 0.82 : 1), when);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.06 / (j + 1), when + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.3 - j * 0.06);
      osc.connect(gain).connect(out);
      osc.start(when);
      osc.stop(when + 0.35);
    });
  });

  // the mechanism turning over: a short filtered noise sweep
  const mech = noise(c, 0.4);
  const mechFilter = c.createBiquadFilter();
  mechFilter.type = "bandpass";
  mechFilter.frequency.setValueAtTime(900, t + 0.28);
  mechFilter.frequency.exponentialRampToValueAtTime(320, t + 0.66);
  mechFilter.Q.value = 3;
  const mechGain = c.createGain();
  mechGain.gain.setValueAtTime(0.0001, t + 0.28);
  mechGain.gain.exponentialRampToValueAtTime(0.09, t + 0.34);
  mechGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.68);
  mech.connect(mechFilter).connect(mechGain).connect(out);
  mech.start(t + 0.28);

  return 0.8; // seconds until the music should come in
}

/**
 * The diner ambience: a slow, faint chord loop pushed through a narrow band so
 * it sounds like it is coming out of a valve radio in the corner.
 *
 * The bandpass is doing the period work — cutting the bass and the air is
 * exactly what a small paper cone does — and the slow detune drift stands in
 * for the pitch instability of a belt-driven mechanism.
 */
let ambience: { stop: () => void } | null = null;

export function startAmbience() {
  const a = audio();
  if (!a || ambience) return;
  const { ctx: c, master: out } = a;

  // ── the radio itself ──
  const radio = c.createBiquadFilter();
  radio.type = "bandpass";
  radio.frequency.value = 1000;   // small speaker, no bass and no top
  radio.Q.value = 0.72;

  const presence = c.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 1900; // the honk a cheap cone always has
  presence.gain.value = 5;
  presence.Q.value = 1.1;

  const bed = c.createGain();
  bed.gain.value = 0.0001;
  radio.connect(presence).connect(bed).connect(out);
  bed.gain.setTargetAtTime(0.055, c.currentTime, 3); // faint, and arrives slowly

  // valve hiss, barely there — silence between notes is the giveaway
  const hiss = noise(c, 2);
  hiss.loop = true;
  const hissFilter = c.createBiquadFilter();
  hissFilter.type = "bandpass";
  hissFilter.frequency.value = 2600;
  hissFilter.Q.value = 0.6;
  const hissGain = c.createGain();
  hissGain.gain.value = 0.006;
  hiss.connect(hissFilter).connect(hissGain).connect(out);
  hiss.start();

  // ── the tune: a lazy ii–V–I–VI in Eb, one chord every eight seconds ──
  const chords = [
    [155.56, 233.08, 277.18, 349.23], // Fm9
    [116.54, 233.08, 293.66, 349.23], // Bb13
    [155.56, 246.94, 311.13, 392.0],  // Ebmaj9
    [130.81, 207.65, 261.63, 329.63], // Cm7
  ];
  const voices: OscillatorNode[] = [];
  let chordIndex = 0;
  let stopped = false;

  const playChord = () => {
    if (stopped) return;
    const t = c.currentTime;
    const notes = chords[chordIndex % chords.length];
    chordIndex++;
    notes.forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = i === 0 ? "triangle" : "sine";
      osc.frequency.value = freq;
      // wow and flutter: the pitch never sits perfectly still
      osc.detune.setValueAtTime((Math.random() - 0.5) * 14, t);
      osc.detune.linearRampToValueAtTime((Math.random() - 0.5) * 14, t + 8);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.16 / (i + 1.6), t + 1.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 8);
      osc.connect(gain).connect(radio);
      osc.start(t);
      osc.stop(t + 8.2);
      voices.push(osc);
    });
  };

  playChord();
  const timer = window.setInterval(playChord, 7600); // slight overlap, so it breathes

  ambience = {
    stop: () => {
      stopped = true;
      window.clearInterval(timer);
      try { hiss.stop(); } catch { /* already stopped */ }
      voices.forEach((v) => { try { v.stop(); } catch { /* already stopped */ } });
      bed.gain.setTargetAtTime(0, c.currentTime, 0.4);
      ambience = null;
    },
  };
}

export function stopAmbience() {
  ambience?.stop();
}

export function ambienceRunning() {
  return ambience !== null;
}
