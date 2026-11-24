const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

const publicPages = walk(path.join(root, "src/app"))
  .filter((file) => path.basename(file) === "page.tsx")
  .filter((file) => !["admin", "account"].some((segment) => path.relative(path.join(root, "src/app"), file).split(path.sep)[0] === segment))
  .map((file) => path.relative(root, file));

const publicComponents = walk(path.join(root, "src/components"))
  .filter((file) => /\.(?:tsx|ts)$/.test(file))
  .map((file) => path.relative(root, file));

for (const file of [
  ...publicPages,
  "src/app/contact/page.tsx",
  "src/app/how-it-works/page.tsx",
  "src/app/legal/review-prize/page.tsx",
  "scripts/lib/gafferVoicePrompt.cjs",
  "scripts/gaffer-knowledge.js",
  "scripts/gaffer-system-prompt.js",
  "src/app/api/voice/route.ts",
  "shared/gafferPublicKnowledge.ts",
]) {
  const contents = fs.readFileSync(path.join(root, file), "utf8");
  assert.doesNotMatch(contents, /The Grand Building|Waterstones|WC2N\s*5EJ/i, `${file} must not disclose the collection meeting point`);
}

for (const file of publicComponents) {
  const contents = fs.readFileSync(path.join(root, file), "utf8");
  assert.doesNotMatch(contents, /The Grand Building|WC2N\s*5EJ/i, `${file} must not embed the exact private pickup address in client-rendered UI`);
}

const gafferChatSource = fs.readFileSync(path.join(root, "src/lib/gaffer.ts"), "utf8");
assert.match(gafferChatSource, /PICKUP AREA: In-person collection is in Trafalgar Square/i, "Chat Gaffer exposes the area, not the precise meeting point, in public facts");
assert.match(gafferChatSource, /Do not disclose the exact handover address[\s\S]*?general chat/i, "Chat Gaffer keeps exact handover details behind verified booking facts");
assert.doesNotMatch(gafferChatSource, /The Grand Building|WC2N\s*5EJ/i, "Chat Gaffer prompt contains no exact pickup address");

const voiceRoute = fs.readFileSync(path.join(root, "src/app/api/voice/route.ts"), "utf8");
assert.match(voiceRoute, /pickup is in Trafalgar Square/i, "Voice business info uses the confirmed public pickup area");
assert.doesNotMatch(voiceRoute, /The Grand Building|Waterstones|WC2N\s*5EJ/i, "voice tools never return the exact meeting point");
const businessInfo = voiceRoute.match(/case "business_info":([\s\S]*?)(?=\/\* ── Capture the lead)/)?.[1] ?? "";
assert.match(businessInfo, /pickup is in Trafalgar Square/i, "the voice business-info response names the area");
assert.doesNotMatch(businessInfo, /businessAddress|pickupAddress|The Grand Building|Waterstones|WC2N\s*5EJ/i,
  "the general voice response cannot read or disclose the configured private address");

const contactPage = fs.readFileSync(path.join(root, "src/app/contact/page.tsx"), "utf8");
assert.match(contactPage, /Trafalgar Square, London/i, "Contact page keeps the public pickup area visible");
assert.match(contactPage, /exact meeting point after payment, verification and booking confirmation/i,
  "Contact page explains when the exact point is shared");

const checkout = fs.readFileSync(path.join(root, "src/app/checkout/page.tsx"), "utf8");
assert.match(checkout, /Pick up in Trafalgar Square/i, "Pre-payment checkout identifies only the public pickup area");

console.log(`Public pickup privacy checks passed across ${publicPages.length} public pages and both Gaffer prompt sources.`);
