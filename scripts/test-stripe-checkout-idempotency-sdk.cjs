const assert = require('node:assert/strict');
const http = require('node:http');
const Stripe = require('stripe');

(async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, key: request.headers['idempotency-key'], body });
      if (requests.length === 1) { request.socket.destroy(); return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'cs_local_fixture', object: 'checkout.session', url: 'https://fixture.invalid/checkout' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const stripe = new Stripe('sk_test_local_only', { host: '127.0.0.1', port: server.address().port, protocol: 'http', maxNetworkRetries: 1 });
    const params = { mode: 'payment', success_url: 'https://fixture.invalid/success', cancel_url: 'https://fixture.invalid/cancel', line_items: [{ price_data: { currency: 'gbp', unit_amount: 100, product_data: { name: 'Fixture' } }, quantity: 1 }], metadata: { bookingId: 'bookings_fixture' } };
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey: 'dbc-rental-checkout-bookings_fixture' });
    assert.equal(session.id, 'cs_local_fixture');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/v1/checkout/sessions');
    assert.equal(requests[0].key, 'dbc-rental-checkout-bookings_fixture');
    assert.equal(requests[1].key, requests[0].key);
    assert.equal(requests[1].body, requests[0].body);
    console.log('PASS installed Stripe SDK: local dropped connection retries identical session parameters and idempotency key. No provider requests.');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
