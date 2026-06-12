/** Gaffer — the Db Cinema kit assistant's face. Hand-drawn cine-camera
 * character: film-reel ears, big lens eye, waveform mouth, REC dot.
 * Moods drive the animated parts (see .ba-* / .bot-* in globals.css):
 *   idle     — slow iris breathe
 *   thinking — reels spin, iris quickens, REC blinks
 *   talking  — waveform mouth draws, REC blinks
 */
export type BotMood = "idle" | "thinking" | "talking";

export function BotAvatar({
  mood = "idle",
  className = "",
}: {
  mood?: BotMood;
  className?: string;
}) {
  const moodCls = mood === "thinking" ? "bot-thinking" : mood === "talking" ? "bot-talking" : "";
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      className={`${moodCls} ${className}`}
      aria-hidden
    >
      {/* film-reel ears */}
      <g className="ba-part ba-reel" style={{ stroke: "var(--color-accent-300)" }} strokeWidth="1.6">
        <circle cx="13.5" cy="10.5" r="5" />
        <path d="M13.5 7v7M10 10.5h7" strokeWidth="1.1" />
      </g>
      <g className="ba-part ba-reel" style={{ stroke: "var(--color-accent-300)" }} strokeWidth="1.6">
        <circle cx="34.5" cy="10.5" r="5" />
        <path d="M34.5 7v7M31 10.5h7" strokeWidth="1.1" />
      </g>

      {/* head */}
      <rect x="7" y="14" width="34" height="28" rx="9" fill="#16161d" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />

      {/* lens eye */}
      <circle cx="24" cy="26" r="8.5" style={{ stroke: "var(--color-accent-400)" }} strokeWidth="1.8" />
      <circle
        className="ba-part ba-iris"
        cx="24"
        cy="26"
        r="4.6"
        style={{
          fill: "color-mix(in srgb, var(--color-accent-400) 30%, transparent)",
          stroke: "var(--color-accent-300)",
        }}
        strokeWidth="1.4"
      />
      <circle cx="26" cy="24" r="1.3" fill="#fff" opacity="0.85" />

      {/* waveform mouth */}
      <path
        className="ba-wave"
        d="M16 37.5l2.5-2 2.5 3 3-4 3 4 2.5-3 2.5 2"
        style={{ stroke: "var(--color-accent-300)" }}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* REC dot */}
      <circle className="ba-rec" cx="37" cy="19" r="2" fill="#f43f5e" />
    </svg>
  );
}

/** Avatar in a glowing chip — the standard chat profile picture. */
export function BotAvatarBadge({
  mood = "idle",
  size = 36,
  className = "",
}: {
  mood?: BotMood;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center rounded-full bg-charcoal-800 ring-1 ring-accent-400/40 ${className}`}
      style={{ width: size, height: size }}
    >
      <BotAvatar mood={mood} className="h-[72%] w-[72%]" />
    </span>
  );
}
