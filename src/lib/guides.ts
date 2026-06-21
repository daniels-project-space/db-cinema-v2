export type GuideVideo = { id: string; title: string; author: string };
export type GuideSection = { h: string; p: string; video?: GuideVideo; tips?: string[] };
export type Guide = {
  slug: string;
  title: string;
  description: string;
  category: string;
  intro: string;
  takeaways?: string[];
  sections: GuideSection[];
};

export const GUIDE_CATEGORIES = ["Renting", "Choosing gear", "Gear how-to", "Technique"] as const;

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
    takeaways: [
      "Longer bookings drop the per-day price — 3-day and weekly rates apply automatically.",
      "ID-verify once: a small refundable hold + insurance replaces a big deposit.",
      "Always add a variable ND for outdoor shoots — it's the cheapest day-saver.",
    ],
    sections: [
      { h: "What does camera hire in London cost?", p: "Daily rates scale with the camera tier — a mirrorless body is a fraction of a full cinema package. The longer you book, the lower the per-day rate: our 3-day and weekly rates are applied automatically at checkout, so a 3-day shoot is far cheaper per day than a single day.", tips: ["Book Friday-to-Monday and you often get the weekend at a 3-day rate.", "Members save a further 10-30% on every rental.", "Bundles (body + lens + media) come in cheaper than the same items added separately."] },
      { h: "Delivery or pickup?", p: "You can collect from central London or have the kit delivered to set. Delivery is quoted both ways (there and back) based on distance and load, and larger setups (speakers, lighting, DJ rigs) travel by van. Pickup and return happen in set time windows so handover is smooth." },
      { h: "Deposits and insurance", p: "Instead of a large held deposit, ID-verified renters pay a small refundable damage hold plus insurance cover — verify once and it's saved to your account for next time. It keeps cash free for the shoot itself." },
      { h: "Picking the right kit", p: "Match the camera to the deliverable: a documentary wants a light, fast body; a commercial wants a large-sensor cinema camera and cine glass. Add ND filters for lenses, a gimbal for movement, and wireless audio for interviews. Browse the full catalogue and the site suggests what pairs well.", tips: ["Pack a spare battery per body and double your media estimate.", "Tell our AI kit-builder your shoot and budget and it specs a compatible kit in seconds."] },
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
    takeaways: [
      "Large sensor + fast primes = the 'expensive' shallow look.",
      "Movement sells energy — match the gimbal to your camera's weight.",
      "Shoot in a log profile for the most grading room.",
    ],
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
    takeaways: [
      "ARRI = flawless colour science, the safe choice for drama & commercials.",
      "RED = maximum resolution & VFX flexibility in a modular body.",
      "Sony FX = value, low light and autofocus for lean crews.",
    ],
    sections: [
      { h: "ARRI — the colour-science benchmark", p: "ARRI's Alexa line is the drama and commercial standard. Skin tones and highlight roll-off are gorgeous straight out of camera, which saves time in the grade. It's the safe choice when the look has to be flawless." },
      { h: "RED — resolution and flexibility", p: "RED bodies deliver very high resolution and strong dynamic range in a compact, modular package — great for VFX-heavy work, reframing in post, and rigs where size matters." },
      { h: "Sony FX — value and run-and-gun", p: "The Sony FX line (FX3/FX6/FX9) punches well above its price, with excellent low light and autofocus. It's ideal for documentary, solo operators and fast commercial work where speed beats absolute pedigree." },
      { h: "How to decide", p: "Narrative/commercial with a colourist? ARRI. VFX or maximum resolution? RED. Lean crew, low light, tight budget? Sony FX. Not sure — message us and we'll spec it to your shoot." },
    ],
  },
  {
    slug: "choosing-camera-lenses",
    title: "Choosing camera lenses: focal length & aperture explained",
    category: "Choosing gear",
    description:
      "How focal length, aperture and prime-vs-zoom change your look — and which lenses to rent for your shoot. With video.",
    intro:
      "The lens shapes your image more than the body does. Get focal length and aperture right and even a modest camera looks cinematic. Here's how to choose, with a clear beginner breakdown.",
    takeaways: [
      "Focal length = your perspective: wide for space, long for compression.",
      "Fast primes (f/1.4-2.8) give the shallow, 'expensive' look in low light.",
      "Rent a 2-3 lens set that covers wide / normal / short-tele.",
    ],
    sections: [
      {
        h: "Watch: lenses explained for beginners",
        p: "A clear walkthrough of focal length, aperture and focusing — everything that actually changes how your footage looks.",
        video: { id: "T1-4n5AmGLQ", title: "Camera Lenses for Video — Understanding Lenses for Beginners", author: "Camber Film School" },
      },
      {
        h: "Focal length is perspective",
        p: "Wide lenses (16-35mm) exaggerate space and movement — great for establishing shots and tight rooms. Normal lenses (35-50mm) look natural. Longer lenses (85mm+) compress the background and flatter faces, which is why portraits and interviews love them.",
        tips: ["Wide for energy and context; long for intimacy and compression.", "On a full-frame body: 24mm wide, 35/50mm normal, 85mm portraits.", "Moving the camera changes perspective; zooming only changes framing."],
      },
      {
        h: "Aperture: light and depth of field",
        p: "A fast aperture (low f-number) lets in more light and throws the background out of focus for that shallow, cinematic separation. A variable ND lets you keep that wide aperture in daylight without overexposing.",
        tips: ["f/1.4-2.8 = shallow & low-light friendly; f/4-8 = sharper, more in focus.", "Cine zooms hold one aperture across the range; budget zooms don't.", "Pair fast glass with a variable ND for daytime shooting wide open."],
      },
      {
        h: "Prime vs zoom — and what to rent",
        p: "Primes are sharper, faster and lighter; zooms are flexible and faster to work with. A common rent is a fast prime set (e.g. 24/35/50/85) for the look, or one cine zoom for run-and-gun. Tell us your shoot and we'll spec a set that covers your range.",
        tips: ["Run-and-gun / events: one fast zoom beats swapping primes.", "Narrative / music video: a prime set for the cleanest look.", "Match the lens mount to your body — we check compatibility for you."],
      },
    ],
  },

  // ─────────────────────────── Gear how-to ───────────────────────────
  {
    slug: "how-to-balance-a-gimbal",
    title: "How to balance a gimbal (DJI RS) — step by step",
    category: "Gear how-to",
    description:
      "Balance a DJI RS-series gimbal correctly so the motors run cool, the battery lasts and your footage stays smooth. A clear step-by-step with video.",
    intro:
      "A gimbal that isn't balanced fights itself — the motors strain, the battery drains fast and you get micro-jitters in the footage. Spend five minutes balancing it properly and everything downstream gets easier. Here's the order that works on every DJI RS gimbal.",
    takeaways: [
      "Build the camera exactly as you'll shoot it before you balance.",
      "Balance in order: tilt → roll → pan.",
      "A balanced gimbal holds any pose with the power off — test that.",
    ],
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
      "Set up a DJI drone safely for the first flight — firmware, calibration, RTH and UK rules — plus cinematic moves to fly. With video.",
    intro:
      "Most drone mishaps happen on the ground, before take-off. A calm pre-flight routine — update, calibrate, check home point — is what separates clean aerials from a fly-away. Here's the setup we run before every shoot, the UK rules, and the moves that make footage look cinematic.",
    takeaways: [
      "Update firmware and charge everything at home, never on location.",
      "Wait for a strong GPS lock and 'Home Point Updated' before take-off.",
      "UK: register for an Operator/Flyer ID, keep it in sight, under 120m.",
    ],
    sections: [
      {
        h: "Watch: drone setup and first flight",
        p: "An honest beginner run-through of everything to get right before and during your first flight. Watch it once before you fly so nothing on the day is a surprise.",
        video: { id: "ETEFFA8Dn8Y", title: "Everything I Wish I Knew Before Flying My First DJI Drone", author: "DOATRIP-drone" },
      },
      {
        h: "Before you leave: charge and update",
        p: "Charge every battery and the controller, then connect in the DJI app and install any firmware update — fly-aways and odd behaviour are often just out-of-date firmware. Format the microSD card in the drone, not the computer.",
        tips: ["Updates can take 20+ minutes — do them at home, never on location.", "Bring all batteries; cold weather cuts flight time noticeably."],
      },
      {
        h: "On site: calibrate and set home point",
        p: "On open ground away from metal and power lines, calibrate the compass if the app asks, wait for a strong GPS lock, and confirm the home point is recorded at your take-off spot. Set a Return-to-Home altitude that clears every tree and building around you.",
        tips: ["Wait for 'Home Point Updated' before take-off — that's where it returns on signal loss.", "Set RTH height above the tallest obstacle in the area.", "Hover at 1-2m for a few seconds to check it's stable before climbing."],
      },
      {
        h: "Fly legally in the UK",
        p: "In the UK you need an Operator ID (and usually a Flyer ID) from the CAA, displayed on the aircraft, plus you must keep the drone in sight, under 120m, and away from people and airports. For paid work, fly insured and within your competency. Our drone operators are CAA-licensed and fully insured if you'd rather hand it off.",
        tips: ["Check the airspace with a drone-safety app before you fly — central London is heavily restricted.", "Never fly over crowds or within the legal distance of uninvolved people.", "Want the shot without the admin? Book one of our CAA-licensed drone operators."],
      },
      {
        h: "Cinematic moves to fly",
        p: "Once you're confident, a few repeatable moves make aerials look intentional rather than 'a drone went up'. This covers the beginner-friendly moves that read as cinematic.",
        video: { id: "IOtp2mIfITM", title: "10 Easy Cinematic Drone Moves for Beginners", author: "Air Photography" },
        tips: ["Slow and smooth beats fast — drop your stick sensitivity for film moves.", "The reveal (rise + tilt down) and the orbit are the highest-impact starters."],
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
    takeaways: [
      "Keep shutter at ~2× your frame rate; change the ND, not the shutter.",
      "A variable ND lets you stay wide open in daylight for shallow depth.",
      "Stay within the marked min-max to avoid the dark 'X'.",
    ],
    sections: [
      {
        h: "Watch: using a variable ND",
        p: "A clear, practical demo of dialling in a variable ND for photo and video — what to watch for and how it changes the look.",
        video: { id: "C3xxOpytMiM", title: "Using a Variable ND (Neutral Density) Filter", author: "TomPhoto" },
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
      "Audiences forgive imperfect picture far sooner than bad sound. A wireless lav gets clean, close dialogue without a boom op. Here's how to rig and level it so it sounds professional.",
    takeaways: [
      "Place the lav a hand-span below the chin, centred on the chest.",
      "Aim for peaks around -12 dBFS with headroom.",
      "Always record a safety scratch track on the camera mic.",
    ],
    sections: [
      {
        h: "Watch: lav mic setup & getting good levels",
        p: "How to set up a wireless lavalier and get clean, usable levels on a DSLR, mirrorless or XLR rig.",
        video: { id: "oSYnymq1bik", title: "How to Set Up a LAV MIC and Get GOOD Levels", author: "LensProToGo" },
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
    takeaways: [
      "Key at ~45°, fill opposite (softer/dimmer), back light for separation.",
      "Bigger and closer source = softer, more flattering light.",
      "Get the key right first, then add fill and back.",
    ],
    sections: [
      {
        h: "Watch: lighting an interview (3-point)",
        p: "A clear cinematography breakdown of key, fill and back light for interviews and how each one changes the look.",
        video: { id: "MLlMl2KuZi0", title: "How To Light An Interview (3-Point Lighting Tutorial)", author: "Stray Angel Films" },
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

  // ─────────────────────────── Technique ───────────────────────────
  {
    slug: "exposure-for-video",
    title: "Exposure for video: shutter, ISO, aperture & white balance",
    category: "Technique",
    description:
      "Master the exposure triangle for motion and set white balance properly so your footage is clean and gradeable. Two videos.",
    intro:
      "Exposure for video has one extra rule photographers don't worry about: your shutter is mostly fixed. Lock that, control light with aperture, ISO and ND, and set white balance on purpose — and your footage grades beautifully.",
    takeaways: [
      "Shutter ~2× frame rate (the 180° rule) — keep it fixed.",
      "Control light with aperture, ND and ISO, in that order.",
      "Set white balance manually so clips match in the edit.",
    ],
    sections: [
      {
        h: "Watch: the exposure triangle",
        p: "Shutter speed, ISO and aperture explained clearly and how they trade off — the foundation of every exposure decision.",
        video: { id: "4vuPrDdTzSY", title: "Master the Exposure Triangle: Shutter, ISO & Aperture", author: "John Gress" },
      },
      {
        h: "Exposure, the video way",
        p: "Set shutter to roughly double your frame rate for natural motion blur and leave it there. Now expose with aperture (which also sets depth of field), then ISO (watch for noise), and use a variable ND outdoors so you can keep shutter and aperture where you want them.",
        tips: ["24/25fps → 1/50. 50fps → 1/100. Don't 'fix' exposure with shutter.", "Use your camera's base/native ISO when you can for the cleanest image.", "Use zebras or false colour to judge skin tones, not just the screen."],
      },
      {
        h: "Watch: set white balance properly",
        p: "How to set white balance the right way so colours are accurate and every clip matches.",
        video: { id: "33kpaHECQ9Q", title: "How To PROPERLY Set White Balance | Filmmaking 101", author: "Brady Bessette" },
      },
      {
        h: "Nail white balance",
        p: "Auto white balance drifts shot to shot, which is a nightmare to match in the grade. Set a manual Kelvin value (≈5600K daylight, ≈3200K tungsten) or use a grey card. Consistency beats perfection — matching clips is easier than fixing each one.",
        tips: ["Daylight ≈ 5600K, indoor tungsten ≈ 3200K — set it, don't leave it on auto.", "A grey/white card at the top of a take gives you a reference in post.", "Shooting log? Still set WB — it bakes into the metadata for grading."],
      },
    ],
  },
  {
    slug: "shooting-log-picture-profiles",
    title: "Shooting Log & picture profiles (and how to expose them)",
    category: "Technique",
    description:
      "What Log and picture profiles do, when to use them, and how to expose S-Log3 correctly so it grades clean. With video.",
    intro:
      "Log footage looks flat and grey out of camera — on purpose. It captures more dynamic range so you have room to grade. But exposed wrong it gets noisy fast. Here's what Log is and how to nail it.",
    takeaways: [
      "Log captures more dynamic range for grading — it's meant to look flat.",
      "Expose Log a touch bright (to the right) to keep shadows clean.",
      "Only shoot Log if you'll grade — otherwise a standard profile is fine.",
    ],
    sections: [
      {
        h: "Watch: expose S-Log3 correctly",
        p: "A practical method for exposing Sony S-Log3 consistently so it grades cleanly every time (applies in principle to other Log formats).",
        video: { id: "vIvTgqWUD-c", title: "How to Expose S-Log3 Perfectly Every Time", author: "Jimmy on Film" },
      },
      {
        h: "What Log actually is",
        p: "A Log picture profile records the sensor's full dynamic range into a flat, low-contrast image. You add the contrast and colour back in the grade, which protects highlights and shadows. The trade-off: it needs correct exposure and a grade to look its best.",
        tips: ["Flat ≠ broken — that grey image is holding detail for the grade.", "Apply a LUT on your monitor to preview the graded look while shooting."],
      },
      {
        h: "Expose to protect the shadows",
        p: "Log shadows get noisy if underexposed, so most shooters expose a little bright ('expose to the right') and bring it down in the grade. Use the camera's tools — zebras at a known value, or rate the ISO — to keep it consistent across the shoot.",
        tips: ["Slightly over-expose, then pull it down in post for clean shadows.", "Pick one method (zebras / false colour) and use it every take.", "No grade in your workflow? Shoot a standard profile instead — it's fine."],
      },
    ],
  },
  {
    slug: "cinematic-camera-movement",
    title: "Cinematic camera movement: gimbal moves & when to use them",
    category: "Technique",
    description:
      "The core gimbal and camera moves that make footage feel intentional — and how to pick the right tool for the shot. With video.",
    intro:
      "Movement with intent looks cinematic; movement for its own sake looks amateur. Learn a handful of repeatable moves and when each one earns its place, and your footage instantly levels up.",
    takeaways: [
      "Every move should have a reason — reveal, follow, or emphasise.",
      "Slow and smooth reads as cinematic; fast and shaky doesn't.",
      "Match the tool to the shot: gimbal, slider, or locked-off tripod.",
    ],
    sections: [
      {
        h: "Watch: 10 gimbal moves every filmmaker should know",
        p: "A practical run-through of the core gimbal moves and how to execute them cleanly.",
        video: { id: "TilRJTR7HDU", title: "10 Gimbal Moves Every Filmmaker Should Know", author: "Learn Online Video" },
      },
      {
        h: "Pick the move for the moment",
        p: "The reveal introduces a subject; the follow keeps energy with a moving subject; the orbit adds production value to a static one; the push-in builds tension. Learn them as tools, then choose the one the scene needs.",
        tips: ["Walk heel-to-toe (the 'ninja walk') to smooth out steps on a gimbal.", "A slow push-in on dialogue quietly raises tension.", "Don't move and zoom at once unless you mean it — pick one."],
      },
      {
        h: "Gimbal, slider or tripod?",
        p: "A gimbal is for travelling moves and run-and-gun; a slider gives precise, repeatable reveals; a tripod (locked off) is still the right answer for interviews and clean compositions. Match the gimbal's payload to your camera and heaviest lens, with headroom.",
        tips: ["Interviews: lock off on a tripod, let the subject move, not the camera.", "Controlled product/beauty reveals: a slider beats a gimbal.", "Rent the gimbal rated above your rig's weight — see our gimbal balancing guide."],
      },
    ],
  },
  {
    slug: "how-to-film-an-interview",
    title: "How to film an interview: framing, audio & lighting",
    category: "Technique",
    description:
      "Set up a clean, professional interview — camera framing, clean audio and simple lighting — start to finish. With video.",
    intro:
      "A good interview is three things done well: framing, audio and light. Get those right and the content carries itself. Here's a dependable setup you can repeat on any shoot.",
    takeaways: [
      "Frame eyes on the upper third; subject looks just off-lens.",
      "Lav + a backup camera-mic track is non-negotiable for clean audio.",
      "A soft key + gentle fill + background separation is all you need.",
    ],
    sections: [
      {
        h: "Watch: how to shoot an interview",
        p: "A complete, beginner-friendly walkthrough of setting up and filming an in-person interview.",
        video: { id: "6zWF3nScMAA", title: "How to Shoot an Interview — In-Person Video Interview Tutorial", author: "Justin Brown - Primal Video" },
      },
      {
        h: "Framing & cameras",
        p: "Put the eyes on the upper third and leave a little look-room in the direction the subject faces (just off-lens, not down the barrel). A second camera at a different focal length gives you clean cutaways and a way to hide edits.",
        tips: ["Eyes on the upper third; subject looks just to one side of the lens.", "Two cameras (wide + tight) make editing painless.", "Lock the cameras off on tripods — let the subject move, not the frame."],
      },
      {
        h: "Audio first",
        p: "Audio makes or breaks an interview. Put a wireless lav on the subject for close, clean dialogue and record a backup on the camera mic. In a hard room, add soft furnishings or a blanket just out of frame to kill echo.",
        tips: ["Lav for the subject + camera-mic safety track — see our audio guide.", "Tame room echo with soft furnishings off-camera.", "Headphones on while you roll — catch problems before, not after."],
      },
      {
        h: "Simple, flattering light",
        p: "A soft key at ~45°, a gentle fill to lift the shadows, and a little separation behind the subject is all most interviews need. Soften your source with a softbox or diffusion and keep the background a stop or two darker.",
        tips: ["One soft key + bounce fill looks professional and is fast to set up.", "Separate the subject from the background with a kicker or practical.", "See our three-point lighting guide for the full setup."],
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
