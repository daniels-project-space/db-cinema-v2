const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./lib/rentalTestHarness.cjs');
const { getDiditEmbeddedUrl, getDiditStandaloneUrl, getDiditLayoutHeight } = load('src/lib/diditEmbed.ts');
const { diditRenterOpenFailure } = load('src/lib/diditRenterError.ts');
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
const closedError = diditRenterOpenFailure(new Error('Uncaught Error: Verification for this rental closed two hours after its scheduled start. This does not affect future rentals.'));
assert.match(closedError.message, /verification window has closed/);
assert.equal(closedError.retryable, false, 'expired rental checks cannot be retried in a loop');
assert.match(diditRenterOpenFailure(new Error('Complete the rental payment and required card hold before verification.')).message, /Finish payment and card setup/);
assert.match(diditRenterOpenFailure(new Error('Please sign in to verify this booking.')).message, /Sign in to the account used/);
const unknownError = diditRenterOpenFailure(new Error('Sensitive provider response: raw token and document result'));
assert.match(unknownError.message, /No new payment was taken/);
assert.equal(unknownError.message.includes('raw token'), false, 'unknown provider details stay hidden from renters');
assert.equal(unknownError.retryable, true, 'unknown transient failures offer a safe retry');

const styles = fs.readFileSync(path.join(__dirname, '../src/components/IdVerify.module.css'), 'utf8');
const component = fs.readFileSync(path.join(__dirname, '../src/components/IdVerify.tsx'), 'utf8');
assert.match(styles, /\.frame\s*\{[^}]*height:\s*700px;/s, 'desktop keeps the existing 700px frame height');
assert.match(styles, /@media\s*\(max-width:\s*540px\)[\s\S]*?\.frameShell\s*\{[^}]*position:\s*fixed;/);
assert.match(styles, /@media\s*\(max-width:\s*540px\)[\s\S]*?\.mobileBar\s*\{[^}]*display:\s*flex;/);
assert.match(styles, /@media\s*\(max-width:\s*540px\)[\s\S]*?\.frameShell\s*\{[^}]*height:\s*100vh;\s*height:\s*100dvh;/s, 'phone shell follows the full dynamic viewport');
assert.match(styles, /@media\s*\(max-width:\s*540px\)[\s\S]*?\.frame\s*\{[^}]*position:\s*absolute;\s*inset:\s*0;[\s\S]*?height:\s*100%;/s, 'phone iframe stays full screen beneath floating host controls');
assert.match(styles, /\.mobileOptionsButton\s*\{[^}]*width:\s*40px;\s*height:\s*40px;/s, 'phone controls collapse to a small floating options button');
assert.match(styles, /\.mobileMenu\s*\{[^}]*position:\s*fixed;\s*top:\s*auto;[^}]*bottom:\s*max\(calc\(env\(safe-area-inset-bottom\) \+ 84px\), 100px\);/s, 'expanded phone fallback menu stays above the provider continue control');
assert.match(component, /allow="camera; microphone; geolocation; clipboard-write; fullscreen; autoplay; encrypted-media; digital-credentials-get"/, 'iframe delegates all capabilities documented by Didit');
assert.match(component, /aria-label="Verification options" aria-expanded=\{showFrameOptions\}/, 'verification fallback actions remain keyboard and screen-reader discoverable');
assert.match(component, /catch \(error\) \{ if \(mounted\.current\) \{ const failure = diditRenterOpenFailure\(error\); setErr\(failure\.message\); setRetryAllowed\(failure\.retryable\); \} \}/, 'safe server causes are shown instead of collapsing every failure into one generic error');
assert.match(component, /!reused && retryAllowed/, 'terminal errors remove the impossible retry button');
assert.match(component, /waitingForBookingId/, 'a paid booking linked to an in-progress same-account check shows a waiting state');
assert.match(component, /Open that rental’s verification/, 'the renter can open the exact booking that owns the active Didit session');

console.log('PASS Didit embed: mobile presentation URL, trusted responsive-layout messages and bounded iframe sizing.');
