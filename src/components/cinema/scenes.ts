// Cinema scene state machine. Each scene = one Higgsfield looping clip.
// Drop the rendered MP4 (and a poster JPG) into `idle` and it goes live —
// transitions between scenes use the clip in TRANSITION (last frame of the
// transition must equal the first frame of the destination idle loop).

export type SceneKey = "home" | "gear" | "assembly" | "checkout" | "done";
export type Layout = "full" | "dock";

export interface Scene {
  label: string;
  hint: string;
  layout: Layout; // full = fullscreen background, dock = top-third banner
  idle: string | null; // looping clip URL (R2). null → animated placeholder
  poster?: string | null;
  tint: string; // placeholder gradient until the real clip is set
}

export const SCENES: Record<SceneKey, Scene> = {
  home: {
    label: "The studio",
    hint: "Slow orbit on the Alexa cinema rig — fan turning, neon glowing, light rays + dust.",
    layout: "full",
    idle: null,
    tint: "from-amber-800/40 via-charcoal-900 to-charcoal-950",
  },
  gear: {
    label: "The workbench",
    hint: "Dolly to the workbench — gear laid out, ready to build a kit.",
    layout: "dock",
    idle: null,
    tint: "from-sky-800/40 via-charcoal-900 to-charcoal-950",
  },
  assembly: {
    label: "Assembling the kit",
    hint: "The operator choosing lenses and handling gear on the camera.",
    layout: "dock",
    idle: null,
    tint: "from-indigo-800/40 via-charcoal-900 to-charcoal-950",
  },
  checkout: {
    label: "At the counter",
    hint: "Card over the reader — processing — looping on the pending state.",
    layout: "dock",
    idle: null,
    tint: "from-emerald-900/40 via-charcoal-900 to-charcoal-950",
  },
  done: {
    label: "Approved",
    hint: "Handed the box + gear bags, walking out — camera holds on the door.",
    layout: "full",
    idle: null,
    tint: "from-emerald-700/50 via-charcoal-900 to-charcoal-950",
  },
};

// one-way transition clips (author so the final frame == destination idle's first frame)
export const TRANSITION: Record<string, string | null> = {
  "home>gear": null,
  "gear>assembly": null,
  "assembly>checkout": null,
  "checkout>done": null,
};

export const FLOW: SceneKey[] = ["home", "gear", "assembly", "checkout", "done"];

export const transitionKey = (from: SceneKey, to: SceneKey) => `${from}>${to}`;
