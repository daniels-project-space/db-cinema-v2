const assert = require('node:assert/strict');
const fs = require('node:fs');
const h = require('./lib/rentalTestHarness.cjs');

const { bundleIncludes, categoryFor, isGenuineBundle } = h.load('convex/lib/taxonomy.ts');
const cases = [
  ['Sony FX3 + Sony G Master 24-70mm + DJI RS 3 Pro Gimbal', true, 'Packages'],
  ['DJI RS 3 Pro Gimbal + Sony FX3 + Sony G Master 24-70mm', true, 'Packages'],
  ['Sony FX3 + Sony G Master 24-70mm + Atomos Ninja V Monitor', true, 'Packages'],
  ['Sony FX3 + Nanlite Forza 300 + Rode Wireless GO', true, 'Packages'],
  ['Nanlite Forza 300 Light + Sennheiser Wireless Mic + Atomos Ninja Monitor', true, 'Packages'],
  ['Sony FX3 + Sony G Master 24-70mm', false, 'Cameras'],
  ['Sony FX3 + DJI RS 3 Pro Gimbal', false, 'Cameras'],
  ['Sony FX3 + G Master 24-70mm + 4x NP-FZ100 Batteries', false, 'Cameras'],
  ['Sony FX3 + 2x NP-FZ100 Batteries + CFexpress Card', false, 'Cameras'],
  ['2x Nanlite PavoTube 30X II Lights', false, 'Lighting'],
  ['Sony FX3 Set with G Master Lens', false, 'Cameras'],
  ['Sony FX3 Production Kit with G Master Lens', true, 'Packages'],
];

for (const [title, expectedPackage, expectedCategory] of cases) {
  assert.equal(isGenuineBundle(title), expectedPackage, title);
  assert.equal(categoryFor(title), expectedCategory, title);
}

const reverseOrder = bundleIncludes('DJI RS 3 Pro Gimbal + Sony FX3 + 24-70mm');
assert(reverseOrder.includes('lens'));
assert(reverseOrder.includes('gimbal'));

const prompt = fs.readFileSync('scripts/classify.mjs', 'utf8');
assert.match(prompt, /at least THREE DISTINCT major rental gear types/);
assert.match(prompt, /camera \+ gimbal \+ lens qualifies/);
assert.match(prompt, /A camera with a lens alone is not a package/);

console.log('Package taxonomy tests passed');
