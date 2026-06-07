export type GuideSection = { h: string; p: string };
export type Guide = {
  slug: string;
  title: string;
  description: string;
  intro: string;
  sections: GuideSection[];
};

export const GUIDES: Guide[] = [
  {
    slug: "camera-hire-london-guide",
    title: "Camera hire in London: the complete 2026 guide",
    description:
      "How to rent cinema cameras, lenses and lighting in London — costs, delivery, deposits and how to pick the right kit for your shoot.",
    intro:
      "Renting camera gear in London is the fastest way to shoot on professional kit without the five-figure outlay. This guide covers what it costs, how delivery works, and how to choose the right setup for your project.",
    sections: [
      { h: "What does camera hire in London cost?", p: "Daily rates scale with the camera tier — a mirrorless body is a fraction of a full cinema package. The longer you book, the lower the per-day rate: our 3-day and weekly rates are applied automatically at checkout, so a 3-day shoot is far cheaper per day than a single day." },
      { h: "Delivery or pickup?", p: "You can collect from central London or have the kit delivered to set. Delivery is quoted both ways (there and back) based on distance and load, and larger setups (speakers, lighting, DJ rigs) travel by van. Pickup and return happen in set time windows so handover is smooth." },
      { h: "Deposits and insurance", p: "Instead of a large held deposit, ID-verified renters pay a small refundable damage hold plus insurance cover — verify once and it's saved to your account for next time. It keeps cash free for the shoot itself." },
      { h: "Picking the right kit", p: "Match the camera to the deliverable: a documentary wants a light, fast body; a commercial wants a large-sensor cinema camera and cine glass. Add ND filters for lenses, a gimbal for movement, and wireless audio for interviews. Browse the full catalogue and the site suggests what pairs well." },
    ],
  },
  {
    slug: "music-video-camera-gear",
    title: "What camera gear do you need for a music video?",
    description:
      "The exact camera, lens, lighting and movement kit to rent for a music video shoot in London — on any budget.",
    intro:
      "Music videos live and die on look and movement. Here's the gear that gets you a polished, high-energy result, and what you can rent for each part of the rig.",
    sections: [
      { h: "Camera + lenses", p: "A large-sensor cinema camera gives you the shallow depth and dynamic range that reads as 'expensive'. Pair it with a fast prime set or a cine zoom. Add a variable ND so you can shoot wide open in daylight." },
      { h: "Movement", p: "Movement sells energy. A gimbal for run-and-gun, a slider for controlled reveals, and — budget allowing — a follow-focus for sharp tracking shots. Rent the gimbal that matches your camera's weight." },
      { h: "Lighting", p: "Colour is everything in music videos. RGB LED panels and tube lights let you build saturated, moody looks fast. Add a hard key for contrast and haze for beams." },
      { h: "Audio + playback", p: "You'll shoot to playback, so a portable speaker keeps the artist in time. If you're capturing live vocals or behind-the-scenes, add a wireless mic kit." },
    ],
  },
  {
    slug: "red-arri-sony-fx-which-to-rent",
    title: "RED vs ARRI vs Sony FX: which cinema camera should you rent?",
    description:
      "A plain-English comparison of RED, ARRI and Sony FX cinema cameras to help you rent the right body for your shoot in London.",
    intro:
      "The three names you'll see most in London rental houses are ARRI, RED and Sony's FX line. They all shoot beautifully — the right choice depends on your project, crew and budget.",
    sections: [
      { h: "ARRI — the colour-science benchmark", p: "ARRI's Alexa line is the drama and commercial standard. Skin tones and highlight roll-off are gorgeous straight out of camera, which saves time in the grade. It's the safe choice when the look has to be flawless." },
      { h: "RED — resolution and flexibility", p: "RED bodies deliver very high resolution and strong dynamic range in a compact, modular package — great for VFX-heavy work, reframing in post, and rigs where size matters." },
      { h: "Sony FX — value and run-and-gun", p: "The Sony FX line (FX3/FX6/FX9) punches well above its price, with excellent low light and autofocus. It's ideal for documentary, solo operators and fast commercial work where speed beats absolute pedigree." },
      { h: "How to decide", p: "Narrative/commercial with a colourist? ARRI. VFX or maximum resolution? RED. Lean crew, low light, tight budget? Sony FX. Not sure — message us and we'll spec it to your shoot." },
    ],
  },
];

export const guideBySlug = (s: string) => GUIDES.find((g) => g.slug === s);

export type Faq = { q: string; a: string };
export const FAQS: Faq[] = [
  { q: "How does renting work?", a: "Browse the catalogue, pick your dates on the calendar, add gear to your kit and check out. You'll get a confirmation by email, then collect from central London or have it delivered." },
  { q: "Do you deliver across London?", a: "Yes. Delivery is quoted both ways based on distance and load — larger setups travel by van. You choose pickup or delivery at checkout and pick your time window." },
  { q: "What about deposits and insurance?", a: "ID-verified renters pay a small refundable damage hold plus insurance cover instead of a large deposit. Verify your ID once and it's saved to your account." },
  { q: "How are the rates structured?", a: "Daily, 3-day and weekly rates — the longer you rent, the lower the per-day price, applied automatically. Members save a further 10-30% on every rental." },
  { q: "What are your opening hours?", a: "Pickups and returns run 10:00-12:00 and 19:00-21:00, every day. Delivery times are arranged when you book." },
  { q: "Can I extend or add to my booking?", a: "Yes — message us in your account and you can add compatible gear up to an hour before your rental starts, or ask about extending your dates." },
];
