const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./lib/rentalTestHarness.cjs');
const { getDiditEmbeddedUrl, getDiditStandaloneUrl, getDiditLayoutHeight } = load('src/lib/diditEmbed.ts');
const frameWindow = {};
const message = (origin, source, type, contentHeight) => ({
  origin,
  source,
  data: { type, data: { contentHeight } },
});

assert.equal(
  getDiditEmbeddedUrl('https://verify.didit.me/session/session-123?token=abc'),
  'https://verify.didit.me/session/session-123?token=abc&sdk_presentation=embedded',
);
assert.equal(
  getDiditEmbeddedUrl('https://verify.didit.me/session/session-123?sdk_presentation=standalone'),
  'https://verify.didit.me/session/session-123?sdk_presentation=embedded',
);
assert.equal(
  getDiditStandaloneUrl('https://verify.didit.me/session/session-123?token=abc&sdk_presentation=embedded'),
  'https://verify.didit.me/session/session-123?token=abc',
);
assert.equal(getDiditEmbeddedUrl('javascript:alert(1)'), null);
assert.equal(getDiditEmbeddedUrl('https://verify.didit.me.evil.example/session/session-123'), null);
assert.equal(getDiditEmbeddedUrl('https://user@verify.didit.me/session/session-123'), null);
assert.equal(getDiditLayoutHeight(message('https://verify.didit.me', frameWindow, 'didit:layout', 612), frameWindow), 612);
assert.equal(getDiditLayoutHeight(message('https://verify.didit.me', frameWindow, 'didit:layout', 10000), frameWindow), 1600);
assert.equal(getDiditLayoutHeight(message('https://verify.didit.me', frameWindow, 'didit:layout', 10), frameWindow), 320);
assert.equal(getDiditLayoutHeight(message('https://verify.didit.me.attacker.test', frameWindow, 'didit:layout', 612), frameWindow), null);
assert.equal(getDiditLayoutHeight(message('https://verify.didit.me', {}, 'didit:layout', 612), frameWindow), null);
assert.equal(getDiditLayoutHeight(message('https://verify.didit.me', frameWindow, 'didit:completed', 612), frameWindow), null);
assert.equal(getDiditLayoutHeight(message('https://verify.didit.me', frameWindow, 'didit:layout', Infinity), frameWindow), null);

const styles = fs.readFileSync(path.join(__dirname, '../src/components/IdVerify.module.css'), 'utf8');
assert.match(styles, /\.frame\s*\{[^}]*height:\s*700px;/s, 'desktop keeps the existing 700px frame height');
assert.match(styles, /@media\s*\(max-width:\s*540px\)[\s\S]*?\.frameShell\s*\{[^}]*position:\s*fixed;/);
assert.match(styles, /@media\s*\(max-width:\s*540px\)[\s\S]*?\.mobileBar\s*\{[^}]*display:\s*flex;/);

console.log('PASS Didit embed: mobile presentation URL, trusted responsive-layout messages and bounded iframe sizing.');
