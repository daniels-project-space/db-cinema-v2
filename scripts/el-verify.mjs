import { ConvexHttpClient } from "convex/browser";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const vault = new ConvexHttpClient("https://fantastic-roadrunner-485.convex.cloud");
const k = await vault.query("secrets:getOne", { service: "elevenlabs", keyName: "ELEVENLABS_API_KEY" });
const KEY = k.value || k.secret || k.key;
const H = { "xi-api-key": KEY };

// store gitignored for reuse
if (existsSync(".env.local")) {
  let env = readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => !/^ELEVENLABS_API_KEY=/.test(l)).join("\n");
  writeFileSync(".env.local", env.trimEnd() + "\nELEVENLABS_API_KEY=" + KEY + "\n");
}

// 1) verify + subscription tier
const sub = await (await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: H })).json();
console.log("tier:", sub.tier, "| convai allowed:", sub.tier !== "free" ? "likely" : "maybe-not");

// 2) Conversational AI access?
const agentsRes = await fetch("https://api.elevenlabs.io/v1/convai/agents?page_size=1", { headers: H });
console.log("convai list HTTP:", agentsRes.status, agentsRes.status === 200 ? "(ConvAI accessible ✓)" : "(no convai access?)");

// 3) British voices
const v = await (await fetch("https://api.elevenlabs.io/v1/voices", { headers: H })).json();
const voices = v.voices || [];
const brit = voices.filter((x) => /british|uk|england|en-gb/i.test([x.labels?.accent, x.name, x.labels?.description].join(" ")));
console.log("voices:", voices.length, "| british:", brit.length);
brit.slice(0, 8).forEach((x) => console.log("  ", x.voice_id, "-", x.name, "(" + (x.labels?.accent || "") + ", " + (x.labels?.gender || "") + ")"));
