const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  let revision = 'v1:0';
  let rows = [{ slug: 'fixture-owned-a', title: 'Fixture Camera A Sony FX3', category: 'Cameras', image: null, lastModified: 1 }];
  let reads = 0;
  const mock = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body || '{}');
    const name = String(input.path || '').replace(':', '.');
    let value;
    if (name === 'catalog.publicRevision') value = revision;
    else if (name === 'catalog.discovery') { reads++; value = { page: rows, isDone: true, continueCursor: '' }; }
    else if (name === 'catalog.bestSellers') value = rows.map(row => ({ _id: row.slug, ...row, heroImage: null, imageSources: [], pricing: { daily: 25 }, depositAmount: 0 }));
    else if (name === 'catalog.categories') value = [{ name: 'Cameras', count: rows.length }];
    else if (name === 'catalog.discoveryCameraPage') value = { page: rows, nextAfter: null };
    else if (name === 'catalog.discoveryOffers') value = rows.map(row => ({ ...row, daily: 25, minimumRentalDays: 1 }));
    else if (name === 'reviews.stats') value = { count: 0 };
    else if (name === 'catalog.getListingBySlug') value = null;
    else { response.writeHead(500); response.end(JSON.stringify({ status: 'error', errorMessage: `Unexpected query ${name}` })); return; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ status: 'success', value }));
  });
  const mockPort = await listen(mock);
  const reservation = http.createServer();
  const webPort = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)], {
    cwd: root, env: { ...process.env, NEXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${mockPort}`, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const url = `http://127.0.0.1:${webPort}/gear`;
  const page = async () => {
    const response = await fetch(url);
    assert.equal(response.status, 200, 'Directory responds successfully');
    return response.text();
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw Error(`Next exited early: ${logs.slice(-2000)}`);
      try { const response = await fetch(url); if (response.ok) { ready = true; break; } } catch {}
      await wait(500);
    }
    assert(ready, `Next server did not become ready: ${logs.slice(-2000)}`);
    const first = await page();
    assert(first.includes('Fixture Camera A'));
    const initialHome = await (await fetch(`http://127.0.0.1:${webPort}/`)).text();
    assert(initialHome.includes('Fixture Camera A'), 'Homepage initially renders the featured catalogue');
    const initialHire = await (await fetch(`http://127.0.0.1:${webPort}/hire/camera-hire-london`)).text();
    assert(initialHire.includes('Fixture Camera A'), 'Camera directory initially renders the current catalogue');
    const firstReads = reads;
    rows = [{ slug: 'fixture-owned-b', title: 'Fixture Camera B Sony FX3', category: 'Cameras', image: null, lastModified: 2 }];
    const cached = await page();
    assert(cached.includes('Fixture Camera A') && !cached.includes('Fixture Camera B'), 'Unchanged revision reuses the bounded directory cache');
    assert.equal(reads, firstReads);
    revision = 'v1:1';
    const changed = await page();
    assert(!changed.includes('Fixture Camera A') && changed.includes('Fixture Camera B'), 'A visibility revision immediately replaces stale SSR results');
    assert(reads > firstReads);
    const nextHome = await (await fetch(`http://127.0.0.1:${webPort}/`)).text();
    assert(!nextHome.includes('Fixture Camera A') && nextHome.includes('Fixture Camera B'), 'Homepage SSR uses the new catalogue revision');
    const nextHire = await (await fetch(`http://127.0.0.1:${webPort}/hire/camera-hire-london`)).text();
    assert(!nextHire.includes('Fixture Camera A') && nextHire.includes('Fixture Camera B'), 'Camera hire SSR uses current inventory');
    const fx3Hire = await (await fetch(`http://127.0.0.1:${webPort}/hire/sony-fx3-hire-london`)).text();
    assert(!fx3Hire.includes('Fixture Camera A') && fx3Hire.includes('Fixture Camera B'), 'FX3 comparison excludes the old result');
    assert.equal((await fetch(`http://127.0.0.1:${webPort}/gear/fixture-owned-a`)).status, 404, 'A removed product detail is not served from an old static page');
    rows = [{ slug: 'fixture-owned-c', title: 'Fixture Camera C', category: 'Cameras', image: null, lastModified: 3 }];
    revision = 'v2:1';
    const policy = await page();
    assert(!policy.includes('Fixture Camera B') && policy.includes('Fixture Camera C'), 'Policy generation also invalidates old cache entries');
    console.log('PASS real Next SSR: shared cache hit, live directory/home/hire revision, removed detail and policy-generation invalidation');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => mock.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
