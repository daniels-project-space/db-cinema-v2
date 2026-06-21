export type GuideVideo = { id: string; title: string; author: string };
export type GuideSection = { h: string; p: string; video?: GuideVideo; tips?: string[] };
export type Guide = {
  slug: string;
  title: string;
  description: string;
  category: string;
  intro: string;
  sections: GuideSection[];
};

export const GUIDE_CATEGORIES = ["Renting", "Gear how-to", "Choosing gear"] as const;

export const GUIDES: Guide[] = [
  // ─────────────────────────── Renting ───────────────────────────
  {
    slug: "camera-hire-london-guide",
    title: "Camera hire in London: the complete 2026 guide",
    category: "Renting",
    description:
      "How to rent cinema cameras, lenses and lighting in London — costs, delivery, deposits and how to pick the right kit for your shoot.",
    intro:
      "Renting camera gear in London is the fastest way to shoot on professional kit without the five-figure outlay. This guide covers what it costs, how delivery works, and how to choose the right setup for your project.",
    sections: [
      { h: "What does camera hire in London cost?", p: "Daily rates scale with the camera tier — a mirrorless body is a fraction of a full cinema package. The longer you book, the lower the per-day rate: our 3-day and weekly rates are applied automatically at checkout, so a 3-day shoot is far cheaper per day than a single day.", tips: ["Book Friday-to-Monday and you often get the weekend at a 3-day rate.", "Members save a further 10-30% on every rental.", "Bundles (body + lens + media) come in cheaper than the same items added separately."] },
      { h: "Delivery or pickup?", p: "You can collect from central London or have the kit delivered to set. Delivery is quoted both ways (there and back) based on distance and load, and larger setups (speakers, lighting, DJ rigs) travel by van. Pickup and return happen in set time windows so handover is smooth." },
      { h: "Deposits and insurance", p: "Instead of a large held deposit, ID-verified renters pay a small refundable damage hold plus insurance cover — verify once and it's saved to your account for next time. It keeps cash free for the shoot itself." },
      { h: "Picking the right kit", p: "Match the camera to the deliverable: a documentary wants a light, fast body; a commercial wants a large-sensor cinema camera and cine glass. Add ND filters for lenses, a gimbal for movement, and wireless audio for interviews. Browse the full catalogue and the site suggests what pairs well.", tips: ["Always add a variable ND if you're shooting outdoors — it's the cheapest line item that saves the day.", "Pack a spare battery per body and double your media estimate.", "Tell our AI kit-builder your shoot and budget and it specs a compatible kit in seconds."] },
    ],
  },

  // ─────────────────────────── Choosing gear ───────────────────────────
  {
    slug: "music-video-camera-gear",
    title: "What camera gear do you need for a music video?",
    category: "Choosing gear",
    description:
      "The exact camera, lens, lighting and movement kit to rent for a music video shoot in London — on any budget.",
    intro:
      "Music videos live and die on look and movement. Here's the gear that gets you a polished, high-energy result, and what you can rent for each part of the rig.",
    sections: [
      { h: "Camera + lenses", p: "A large-sensor cinema camera gives you the shallow depth and dynamic range that reads as 'expensive'. Pair it with a fast prime set or a cine zoom. Add a variable ND so you can shoot wide open in daylight.", tips: ["Fast primes (f/1.4-2.8) give you that creamy, expensive separation.", "Shoot in a log profile (S-Log3 / V-Log) for the most grading room."] },
      { h: "Movement", p: "Movement sells energy. A gimbal for run-and-gun, a slider for controlled reveals, and — budget allowing — a follow-focus for sharp tracking shots. Rent the gimbal that matches your camera's weight.", tips: ["Balance the gimbal before you leave home, not on set — see our gimbal guide.", "Match the gimbal payload to your body + heaviest lens, with headroom."] },
      { h: "Lighting", p: "Colour is everything in music videos. RGB LED panels and tube lights let you build saturated, moody looks fast. Add a hard key for contrast and haze for beams." },
      { h: "Audio + playback", p: "You'll shoot to playback, so a portable speaker keeps the artist in time. If you're capturing live vocals or behind-the-scenes, add a wireless mic kit." },
    ],
  },
  {
    slug: "red-arri-sony-fx-which-to-rent",
    title: "RED vs ARRI vs Sony FX: which cinema camera should you rent?",
    category: "Choosing gear",
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

  // ─────────────────────────── Gear how-to (with video) ───────────────────────────
  {
    slug: "how-to-balance-a-gimbal",
    title: "How to balance a gimbal (DJI RS) — step by step",
    category: "Gear how-to",
    description:
      "Balance a DJI RS-series gimbal correctly so the motors run cool, the battery lasts and your footage stays smooth. A clear step-by-step with video.",
    intro:
      "A gimbal that isn't balanced fights itself — the motors strain, the battery drains fast and you get micro-jitters in the footage. Spend five minutes balancing it properly and everything downstream gets easier. Here's the order that works on every DJI RS gimbal.",
    sections: [
      {
        h: "Watch: balancing a DJI RS gimbal",
        p: "This walkthrough covers the full balance routine on the DJI RS series (RS 2, RS 3, RS 3 Pro, RS 4, RS 4 Pro). Follow it once with your kit on the bench and it becomes second nature.",
        video: { id: "HlhAX5w7QgQ", title: "How to Properly Balance a DJI RS Gimbal", author: "Hyph Tech" },
      },
      {
        h: "Before you start",
        p: "Build the camera exactly as you'll shoot it — lens, filter, cage, top handle and a fully-seated battery and card. If you add anything after balancing, you have to rebalance. Lock all three axes before mounting so nothing swings while you set up.",
        tips: ["Set your lens to the focal length / focus distance you'll mostly use — zooming or focusing shifts the centre of mass.", "Mount the camera and tighten the quick-release plate firmly before you unlock anything."],
      },
      {
        h: "Balance in the right order: tilt, roll, pan",
        p: "Always go tilt → roll → pan. For each axis, unlock only that axis, slide the camera until it holds position on its own with the gimbal powered off, then re-lock. Tilt has two parts: front-to-back, then the vertical (camera tilted up to check it doesn't drift).",
        tips: ["Tilt (front/back): slide the plate until the camera stays level when you let go.", "Tilt (vertical): point the lens up ~45° — it should hold, not fall back.", "Roll: slide left/right until the camera sits flat with no lean.", "Pan: with the gimbal tilted forward ~45°, the arm should not swing to either side."],
      },
      {
        h: "Fine-tune and auto-tune",
        p: "Once it's mechanically balanced, power on and run the gimbal's auto-tune (motor stiffness) from the screen or the Ronin app. Good mechanical balance means the auto-tune lands a high stiffness without buzzing — that's your sign it's right.",
        tips: ["If a motor buzzes or feels hot, it's not balanced — go back and re-do that axis.", "A balanced gimbal can hold any pose with the power off; test that before you trust it.", "Re-balance whenever you swap lens, filter or battery."],
      },
    ],
  },
  {
    slug: "how-to-set-up-a-drone",
    title: "How to set up a drone for your first flight",
    category: "Gear how-to",
    description:
      "Set up a DJI drone safely for the first flight — firmware, calibration, props, RTH and UK flying rules. Step-by-step with video.",
    intro:
      "Most drone mishaps happen on the ground, before take-off. A calm pre-flight routine — update, calibrate, check home point — is what separates clean aerials from a fly-away. Here's the setup we run before every shoot, plus the UK rules you need to know.",
    sections: [
      {
        h: "Watch: drone setup and first flight",
        p: "A beginner-friendly run-through of unboxing, app setup and the first take-off. Watch it through once before you fly so nothing on the day is a surprise.",
        video: { id: "gktOHuztnUE", title: "DJI Drone Setup & First Flight — Beginner Guide", author: "Fly World Gadget" },
      },
      {
        h: "Before you leave: charge and update",
        p: "Charge every battery and the controller, then connect in the DJI app and install any firmware update — fly-aways and odd behaviour are often just out-of-date firmware. Format the microSD card in the drone, not the computer.",
        tips: ["Updates can take 20+ minutes — do them at home, never on location.", "Bring all batteries; cold weather cuts flight time noticeably."],
      },
      {
        h: "On site: calibrate and set home point",
        p: "On open ground away from metal and power lines, calibrate the compass if the app asks, wait for a strong GPS lock (enough satellites), and confirm the home point is recorded at your take-off spot. Set a sensible Return-to-Home altitude that clears every tree and building around you.",
        tips: ["Wait for 'Home Point Updated' before take-off — that's where it returns on signal loss.", "Set RTH height above the tallest obstacle in the area.", "Hover at 1-2 m for a few seconds to check it's stable before climbing."],
      },
      {
        h: "Fly legally in the UK",
        p: "In the UK you need an Operator ID (and usually a Flyer ID) from the CAA, displayed on the aircraft, plus you must keep the drone in sight, under 120 m, and away from people and airports. For paid/commercial work, fly insured and within your competency. Our drone operators are CAA-licensed and fully insured if you'd rather hand it off.",
        tips: ["Check the airspace with a drone-safety app before you fly — central London is heavily restricted.", "Never fly over crowds or within the legal distance of uninvolved people.", "Want the shot without the admin? Book one of our CAA-licensed drone operators."],
      },
    ],
  },
  {
    slug: "variable-nd-filters-explained",
    title: "Variable ND filters: how to nail exposure outdoors",
    category: "Gear how-to",
    description:
      "What a variable ND filter does, how to set the 180° shutter rule, and how to avoid the cross-polarisation 'X'. With video.",
    intro:
      "If your daytime footage looks like a phone video, the fix is almost always a variable ND. It lets you keep a cinematic shutter and shoot wide open in bright light instead of stopping down to f/16. Here's how to use one properly.",
    sections: [
      {
        h: "Watch: using a variable ND",
        p: "A quick, practical demo of dialling in a variable ND on a real shoot — what to watch for and how it changes the look.",
        video: { id: "oguW3rYppKs", title: "How to Use a Variable ND Filter", author: "Treyleelee" },
      },
      {
        h: "Why you need one",
        p: "For natural motion, set shutter to roughly double your frame rate (the 180° rule — 1/50 at 25fps). In daylight that overexposes badly. A variable ND is sunglasses for your lens: it cuts light so you can hold that shutter and your chosen aperture without blowing out.",
        tips: ["24/25fps → 1/50 shutter. 50fps → 1/100. Keep the shutter, change the ND.", "It also lets you stay at f/2.8 in sun for shallow depth of field."],
      },
      {
        h: "Avoid the cross-polarisation 'X'",
        p: "Variable NDs work by rotating two polarisers. Push past their range and you get an ugly dark 'X' across the frame and weird colour shifts. Stay within the marked min-max, and pick a quality filter sized to your widest lens with step-up rings for the rest.",
        tips: ["If you see an X or magenta cast, you've turned it too far — back off.", "Rent one ND that fits your largest thread and use step-up rings on smaller lenses.", "A matte box with ND trays is the cleaner option on cine glass."],
      },
    ],
  },
  {
    slug: "wireless-audio-for-film",
    title: "Wireless audio for film: lav and mic setup",
    category: "Gear how-to",
    description:
      "Get clean interview and dialogue audio with a wireless lav system — placement, levels and avoiding dropouts. With video.",
    intro:
      "Audiences forgive imperfect picture far sooner than bad sound. A wireless lav (Rode Wireless / DJI Mic) gets clean, close dialogue without a boom op. Here's how to rig and level it so it sounds professional.",
    sections: [
      {
        h: "Watch: wireless lav setup",
        p: "How to set up and use a wireless lavalier system for filmmaking — clipping, hiding the mic and getting usable levels.",
        video: { id: "pvmYEFATC1k", title: "How To Set Up & Use a Wireless Lavalier Mic", author: "Rite Visuals" },
      },
      {
        h: "Placement is everything",
        p: "Clip the lav about a hand's width below the chin, centred on the chest. Keep it clear of clothing that rubs (scarves, zips, jackets) and any jewellery that clinks. Hidden under fabric, use a foam/fur cover and a small loop of cable as strain relief.",
        tips: ["A hand-span below the chin, centred — consistent placement = consistent sound.", "Use the windshield outdoors; even a light breeze ruins a take.", "Mind clothing rustle — tape the cable to skin or fabric near the capsule."],
      },
      {
        h: "Set levels and check the link",
        p: "Aim for peaks around -12 dBFS with healthy headroom — loud enough to be clean, quiet enough not to clip. Do a line-of-sight check between transmitter and receiver before rolling, and always record a safety scratch track on the camera mic.",
        tips: ["Peaks around -12 dBFS leave room for a sudden laugh or shout.", "Keep transmitter and receiver in line of sight; bodies and walls cause dropouts.", "Record a backup on the camera mic so you can re-sync if a pack glitches."],
      },
    ],
  },
  {
    slug: "three-point-lighting-setup",
    title: "Three-point lighting: the setup that flatters everyone",
    category: "Gear how-to",
    description:
      "Key, fill and back light explained — the dependable interview and portrait setup, plus how to shape it with the gear we rent. With video.",
    intro:
      "Three-point lighting is the foundation every other setup builds on. Once you can place a key, fill and back light with intent, interviews and portraits look intentional instead of accidental. Here's the setup and how to shape it.",
    sections: [
      {
        h: "Watch: three-point lighting",
        p: "A clear filmmaking-101 breakdown of key, fill and back light and how each one changes the look.",
        video: { id: "j_Sov3xmgwg", title: "Three-Point Lighting Tutorial (Filmmaking 101)", author: "DiCasaFilm" },
      },
      {
        h: "Key, fill, back",
        p: "The key is your main light, off to one side at ~45°, shaping the face. The fill sits opposite, softer and dimmer, to control how deep the shadows go. The back (or hair) light sits behind the subject to separate them from the background and add depth.",
        tips: ["Start with just the key and get it right before adding the others.", "Fill is for shadow control — keep it softer and weaker than the key.", "Back light separates subject from background; nudge it until they 'pop'."],
      },
      {
        h: "Shape it with the right modifiers",
        p: "Soften an LED panel or COB light (Aputure / Amaran class) with a softbox or diffusion for flattering skin; the bigger and closer the source, the softer the look. Add a bounce board as a cheap fill, and flags or barn doors to keep spill off the background.",
        tips: ["Bigger, closer source = softer light. Small, far = hard and contrasty.", "A 5-in-1 reflector is the cheapest fill you can rent.", "RGB tubes make a great, controllable back/accent light.", "Add haze for visible beams and atmosphere."],
      },
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
