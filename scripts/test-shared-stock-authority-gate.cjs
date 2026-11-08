const assert = require('node:assert/strict');
const { load } = require('./lib/rentalTestHarness.cjs');
const { swapAuthorityAvailable } = load('convex/lib/rentalSwapAuthority.ts');

const keys = ['SHARED_STOCK_AUTHORITY_READY', 'SHARED_STOCK_BRIDGE_EXPERIMENTAL', 'RMV2_WEBHOOK_URL', 'SHARED_STOCK_WEBSITE_SECRET'];
const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
function clear() { for (const key of keys) delete process.env[key]; }
function restore() { for (const key of keys) prior[key] === undefined ? delete process.env[key] : process.env[key] = prior[key]; }

try {
  clear();
  assert.equal(swapAuthorityAvailable(), false, 'No configuration keeps stock swaps disabled');
  process.env.SHARED_STOCK_AUTHORITY_READY = 'enabled';
  assert.equal(swapAuthorityAvailable(), false, 'Readiness alone cannot enable an incomplete bridge');
  process.env.SHARED_STOCK_BRIDGE_EXPERIMENTAL = 'true';
  process.env.RMV2_WEBHOOK_URL = 'https://fixture-manager.convex.site/dbcinema/booking-sync';
  process.env.SHARED_STOCK_WEBSITE_SECRET = 'synthetic-stock-secret-at-least-32-characters';
  assert.equal(swapAuthorityAvailable(), true, 'A complete, explicitly enabled Manager bridge may be activated');
  process.env.RMV2_WEBHOOK_URL = 'https://fixture-manager.convex.site.evil.test/dbcinema/booking-sync';
  assert.equal(swapAuthorityAvailable(), false, 'An untrusted Manager hostname fails closed');
  process.env.RMV2_WEBHOOK_URL = 'https://fixture-manager.convex.site/dbcinema/booking-sync';
  process.env.SHARED_STOCK_WEBSITE_SECRET = 'short';
  assert.equal(swapAuthorityAvailable(), false, 'A short shared secret fails closed');
} finally {
  restore();
}

console.log('PASS shared stock authority remains closed unless explicit readiness and valid private transport settings are present.');
