/** Gaffer — the Db Cinema kit assistant's face. Hand-drawn cine-camera
 * character: film-reel ears, big lens eye, waveform mouth, REC dot.
 * Moods drive the animated parts (see .ba-* / .bot-* in globals.css):
 *   idle     — slow iris breathe
 *   thinking — reels spin, iris quickens, REC blinks
 *   talking  — waveform mouth draws, REC blinks
 */
import Image from "next/image";

export type BotMood = "idle" | "thinking" | "talking";

export function BotAvatar({
  mood = "idle",
  className = "",
}: {
  mood?: BotMood;
  className?: string;
}) {
  return (
    <Image
      src="/db-cinema-aperture-blue.png"
      alt=""
      width={48}
      height={48}
      data-mood={mood}
      className={`rounded-full object-cover ${className}`}
      aria-hidden
      draggable={false}
    />
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
      className={`relative flex shrink-0 items-center justify-center rounded-full bg-black ring-1 ${mood === "thinking" ? "animate-pulse ring-sky-300/80" : mood === "talking" ? "ring-sky-200/90" : "ring-sky-300/45"} ${className}`}
      style={{ width: size, height: size }}
    >
      <BotAvatar mood={mood} className="h-full w-full" />
    </span>
  );
}
