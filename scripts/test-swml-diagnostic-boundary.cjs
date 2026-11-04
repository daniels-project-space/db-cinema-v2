const assert = require('node:assert/strict');
const { load, setMock } = require('./lib/rentalTestHarness.cjs');
setMock('next/server', { NextResponse: { json: body => ({ status: 200, body }) } });
const route = load('src/app/api/swml/inbound/route.ts');
const diagnostics = load('convex/swml.ts');
const previous = process.env.ADMIN_TOKEN;
process.env.ADMIN_TOKEN = 'synthetic-admin-token';
(async () => {
  try {
    assert.equal(diagnostics.record, undefined);
    assert.deepEqual(await diagnostics.recent.handler({}, { token: 'foreign' }), { authorized: false, hits: [] });
    const status = await diagnostics.recent.handler({}, { token: 'synthetic-admin-token' });
    assert.equal(status.authorized, true);
    assert.equal(status.diagnosticsAvailable, false);
    assert.match(status.reason, /disabled/);
    assert.deepEqual(status.hits, []);
    const expected = { version: '1.0.0', sections: { main: [{ connect: { to: 'sip:+12053513784@sip.rtc.elevenlabs.io:5061;transport=tls' } }] } };
    for (const method of ['GET', 'POST']) {
      const result = await route[method]({ json: async () => { throw Error('untrusted body'); } });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, expected);
    }
    console.log('PASS inbound voice routing and disabled untrusted diagnostics; synthetic only.');
  } finally {
    if (previous === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = previous;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
