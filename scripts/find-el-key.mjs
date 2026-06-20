import { ConvexHttpClient } from "convex/browser";
const c = new ConvexHttpClient("https://fantastic-roadrunner-485.convex.cloud");
const services = ["elevenlabs", "eleven_labs", "11labs", "ELEVENLABS"];
const keys = ["ELEVENLABS_API_KEY", "ELEVEN_API_KEY", "XI_API_KEY", "API_KEY", "key"];
for (const s of services) {
  for (const kn of keys) {
    try {
      const k = await c.query("secrets:getOne", { service: s, keyName: kn });
      const v = k && (k.value || k.secret || k.key || (typeof k === "string" ? k : null));
      if (v) console.log(`${s}/${kn}: present (${v.length} chars)`);
    } catch {}
  }
}
console.log("scan done");
