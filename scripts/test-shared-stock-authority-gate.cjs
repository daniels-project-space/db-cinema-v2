const assert = require('node:assert/strict');
const { load } = require('./lib/rentalTestHarness.cjs');
const { swapAuthorityAvailable, rentalItemSwapFeatureReady } = load('convex/lib/rentalSwapAuthority.ts');

const keys = ['SHARED_STOCK_AUTHORITY_READY', 'SHARED_STOCK_BRIDGE_EXPERIMENTAL', 'RMV2_WEBHOOK_URL', 'SHARED_STOCK_WEBSITE_SECRET', 'RENTAL_ITEM_SWAP_ENABLED', 'RMV2_OUTBOUND_ENABLED'];
const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
function clear() { for (const key of keys) delete process.env[key]; }
function restore() { for (const key of keys) prior[key] === undefined ? delete process.env[key] : process.env[key] = prior[key]; }

try {
  clear();
  assert.equal(swapAuthorityAvailable(), false, 'No configuration keeps stock swaps disabled');
  assert.equal(rentalItemSwapFeatureReady(), false, 'The item-swap feature is closed without stock authority');
  process.env.SHARED_STOCK_AUTHORITY_READY = 'enabled';
  assert.equal(swapAuthorityAvailable(), false, 'Readiness alone cannot enable an incomplete bridge');
  process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL = 'true';
  process.env.RMV2_WEBHOOK_URL = 'https://fixture-manager.convex.site/dbcinema/booking-sync';
  process.env.SHARED_STOCK_WEBSITE_SECRET = 'synthetic-stock-secret-at-least-32-characters';
  assert.equal(swapAuthorityAvailable(), true, 'A complete, explicitly enabled Manager bridge may be activated');
  process.env.RENTAL_ITEM_SWAP_ENABLED = 'true';
  assert.equal(rentalItemSwapFeatureReady(), true, 'The selector is ready only with the feature flag and shared authority');
  process.env.RMV2_OUTBOUND_ENABLED = 'false';
  assert.equal(rentalItemSwapFeatureReady(), false, 'A paused outbound RMV2 sync closes item swaps');
  delete process.env.RMV2_OUTBOUND_ENABLED;
  process.env.RENTAL_ITEM_SWAP_ENABLED = 'false';
  assert.equal(rentalItemSwapFeatureReady(), false, 'Disabling the item-swap feature closes its selector');
  process.env.RENTAL_ITEM_SWAP_ENABLED = 'true';
  process.env.RMV2_WEBHOOK_URL = 'https://fixture-manager.convex.site.evil.test/dbcinema/booking-sync';
  assert.equal(swapAuthorityAvailable(), false, 'An untrusted Manager hostname fails closed');
  assert.equal(rentalItemSwapFeatureReady(), false, 'A misconfigured Manager bridge also closes item swaps');
  process.env.RMV2_WEBHOOK_URL = 'https://fixture-manager.convex.site/dbcinema/booking-sync';
  process.env.SHARED_STOCK_WEBSITE_SECRET = 'short';
  assert.equal(swapAuthorityAvailable(), false, 'A short shared secret fails closed');
} finally {
  restore();
}

console.log('PASS shared stock authority remains closed unless explicit readiness and valid private transport settings are present.');
