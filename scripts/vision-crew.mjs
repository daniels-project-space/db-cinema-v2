// vision-crew.mjs — (1) fetch placeholder professional headshots, (2) vision-verify
// each role background clip is cinematic + appropriate, re-fetching any that aren't.
import { execSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";

const VAULT = "https://fantastic-roadrunner-485.convex.cloud";
async function vq(path, args) {
  const r = await fetch(VAULT + "/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, args, format: "json" }) });
  return (await r.json()).value;
}
const PEXELS = (await vq("secrets:getOne", { service: "pexels", keyName: "PEXELS_API_KEY" })).value;
const OR = (await vq("secrets:getOne", { service: "openrouter", keyName: "OPENROUTER_API_KEY" })).value;
const DIR = "public/crew", HS = "public/crew/headshots";
mkdirSync(HS, { recursive: true });
const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "ignore"] });

// ── 1) headshots (gender-matched placeholders) ───────────────────────
const OPS = [
  { n: "marco", g: "man" }, { n: "alex", g: "man" }, { n: "liam", g: "man" }, { n: "theo", g: "man" },
  { n: "ryan", g: "man" }, { n: "sam", g: "man" }, { n: "noah", g: "man" }, { n: "tom", g: "man" },
  { n: "jess", g: "woman" }, { n: "nadia", g: "woman" }, { n: "priya", g: "woman" }, { n: "maya", g: "woman" }, { n: "elena", g: "woman" },
];
async function photos(q) {
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=40&orientation=square`, { headers: { Authorization: PEXELS } });
  const j = await r.json();
  return (j.photos || []).map((p) => p.src.large || p.src.medium).filter(Boolean);
}
let men = [], wom = [];
try { men = await photos("professional headshot man studio portrait neutral background"); } catch {}
try { wom = await photos("professional headshot woman studio portrait neutral background"); } catch {}
let mi = 0, wi = 0;
for (const o of OPS) {
  try {
    const url = o.g === "man" ? men[mi++] : wom[wi++];
    if (!url) { console.log("no headshot", o.n); continue; }
    sh(`curl -s -L "${url}" -o /tmp/hs.jpg`);
    sh(`ffmpeg -y -i /tmp/hs.jpg -vf "scale=480:480" -q:v 4 ${HS}/${o.n}.jpg -loglevel error`);
    console.log("headshot", o.n);
  } catch (e) { console.log("headshot FAIL", o.n); }
}

// ── 2) vision-verify role clips ──────────────────────────────────────
const ROLES = {
  "drone-operator": { q: ["aerial drone mountain landscape", "cinematic aerial nature coastline"], desc: "a cinematic aerial drone shot flying over landscape or nature" },
  "music-composer": { q: ["music recording studio session", "recording studio microphone musician"], desc: "a music recording studio or a musician composing" },
  "videographer": { q: ["videographer filming event", "wedding videographer camera"], desc: "a videographer filming with a camera (events/weddings)" },
  "cinematographer": { q: ["cinema camera film set", "cinematographer camera operator filming"], desc: "a cinematographer with a cinema camera on a film set" },
  "dop": { q: ["film set lighting crew", "movie set production lights"], desc: "a film set with professional lighting / a DP at work" },
  "editor": { q: ["video editing software timeline", "editor color grading computer screen"], desc: "a video editor working at an editing computer/screen" },
  "sound-operator": { q: ["sound recording microphone studio", "audio mixing console boom mic"], desc: "professional sound recording gear (microphone / mixer / boom)" },
};
async function vision(jpg, desc) {
  const b64 = readFileSync(jpg).toString("base64");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${OR}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini", response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text: `Frame from a short looping background video for a crew-hire tile. Judge (a) is it visually cinematic & professional, and (b) does it clearly depict ${desc}? Reply ONLY JSON {"cinematic":1-10,"appropriate":true|false,"desc":"under 6 words"}.` },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
      ] }],
    }),
  });
  const j = await r.json();
  try { return JSON.parse(j.choices[0].message.content); } catch { return { cinematic: 6, appropriate: true, desc: "verify-skip" }; }
}
function refetch(q, role) {
  const r = sh(`curl -s -G "https://api.pexels.com/videos/search" --data-urlencode "query=${q}" --data-urlencode "orientation=landscape" --data-urlencode "size=medium" --data-urlencode "per_page=12" -H "Authorization: ${PEXELS}"`).toString();
  let best = null;
  try {
    const j = JSON.parse(r);
    for (const v of j.videos || []) { const pref = (v.duration || 0) >= 15 ? 0 : 1; for (const f of v.video_files || []) { if (f.file_type !== "video/mp4") continue; const w = f.width || 0; if (w >= 800 && w <= 1300) { const s = Math.abs(w - 1000); if (!best || pref < best.pref || (pref === best.pref && s < best.s)) best = { pref, s, link: f.link }; } } }
  } catch { return false; }
  if (!best) return false;
  sh(`curl -s -L "${best.link}" -o /tmp/${role}.src.mp4`);
  sh(`ffmpeg -y -ss 1 -t 22 -i /tmp/${role}.src.mp4 -an -vf "scale=640:-2,fps=24,format=yuv420p" -c:v libx264 -crf 30 -preset veryfast -movflags +faststart ${DIR}/${role}.mp4 -loglevel error`);
  sh(`ffmpeg -y -i ${DIR}/${role}.mp4 -frames:v 1 -vf scale=640:-2 ${DIR}/${role}.jpg -loglevel error`);
  return true;
}
for (const [role, cfg] of Object.entries(ROLES)) {
  try {
    sh(`ffmpeg -y -ss 3 -i ${DIR}/${role}.mp4 -frames:v 1 -vf scale=640:-2 /tmp/${role}.chk.jpg -loglevel error`);
    let v = await vision(`/tmp/${role}.chk.jpg`, cfg.desc);
    console.log(`${role}: cinematic=${v.cinematic} appropriate=${v.appropriate} (${v.desc})`);
    if (Number(v.cinematic) < 6 || !v.appropriate) {
      for (const q of cfg.q) {
        if (!refetch(q, role)) continue;
        sh(`ffmpeg -y -ss 3 -i ${DIR}/${role}.mp4 -frames:v 1 -vf scale=640:-2 /tmp/${role}.chk.jpg -loglevel error`);
        v = await vision(`/tmp/${role}.chk.jpg`, cfg.desc);
        console.log(`  retry "${q}": cinematic=${v.cinematic} appropriate=${v.appropriate} (${v.desc})`);
        if (Number(v.cinematic) >= 6 && v.appropriate) break;
      }
    }
  } catch (e) { console.log(`${role}: VERIFY FAIL`, String(e).slice(0, 80)); }
}
console.log("DONE vision-crew");
