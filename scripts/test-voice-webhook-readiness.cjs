const assert = require('node:assert/strict');
const { load, setMock } = require('./lib/rentalTestHarness.cjs');

class Response {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
  }

  static json(body, init) {
    return new Response(body, init);
  }
}

let convexClients = 0;
setMock('next/server', { NextResponse: Response });
setMock('convex/browser', { ConvexHttpClient: class {
  constructor(url) {
    convexClients++;
    this.url = url;
  }
} });
setMock('@cvx/_generated/api', { api: {} });
setMock('@/lib/gaffer', {});
setMock('@/lib/inboundEmail', {});
setMock('../../../../shared/rentalEmail', {});
setMock('../../../../convex/lib/mailer', {});
setMock('../../../../convex/lib/taxonomy', {});
setMock('@/lib/voiceQuoteFormatting', {});
setMock('@/lib/site', { PICKUP_SLOTS: [], CONTACT_EMAIL: 'fixture@example.invalid' });
setMock('@/lib/dates', { dayMs: 86400000 });
setMock('@/lib/ratelimit', { rateLimit: async () => ({ allowed: true }) });
setMock('@/lib/pricing', { formatRate: value => String(value) });
setMock('@/lib/voiceDates', { londonToday: () => '2026-11-23', resolveDate: () => null, speak: value => value });

const voice = load('src/app/api/voice/route.ts');
const request = (url, secret = 'fixture-secret') => ({
  url,
  headers: new Headers({ 'x-voice-secret': secret }),
  json: async () => ({ name: 'check_availability', args: { item: 'FX3' } }),
});

(async () => {
  process.env.VOICE_WEBHOOK_SECRET = 'fixture-secret';
  process.env.NEXT_PUBLIC_CONVEX_URL = 'https://fixture.convex.cloud';
  assert.equal((await voice.GET()).status, 200);

  delete process.env.VOICE_WEBHOOK_SECRET;
  assert.equal((await voice.GET()).status, 503, 'health fails closed without webhook auth configuration');
  const missingSecretResponse = await voice.POST(request('https://fixture.invalid/api/voice'));
  assert.equal(missingSecretResponse.status, 503, 'the tool endpoint fails closed without webhook auth configuration');
  assert.equal(convexClients, 0, 'missing webhook auth is rejected before constructing the Convex client');
  process.env.VOICE_WEBHOOK_SECRET = 'fixture-secret';

  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  assert.equal((await voice.GET()).status, 503, 'health fails closed without Convex configuration');
  const missingUrlResponse = await voice.POST(request('https://fixture.invalid/api/voice'));
  assert.equal(missingUrlResponse.status, 503, 'the webhook reports missing Convex configuration clearly');
  assert.equal(convexClients, 0, 'missing configuration is rejected before constructing the Convex client');

  process.env.NEXT_PUBLIC_CONVEX_URL = 'not a URL';
  assert.equal((await voice.GET()).status, 503, 'health rejects malformed Convex URLs');
  assert.equal((await voice.POST(request('https://fixture.invalid/api/voice'))).status, 503);
  assert.equal(convexClients, 0, 'malformed configuration is rejected before constructing the Convex client');

  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  const unauthorized = await voice.POST(request('https://fixture.invalid/api/voice', 'wrong-secret'));
  assert.equal(unauthorized.status, 401, 'the webhook does not disclose config readiness before authenticating');
  assert.equal(convexClients, 0);

  console.log('PASS voice webhook readiness: health reflects required server config; POST fails closed before client construction; unauthorized callers cannot probe config.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
