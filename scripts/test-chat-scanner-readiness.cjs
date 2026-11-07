const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createScannerServer } = require('../services/chat-scanner/scanner.cjs');
const { checkScannerHealth } = require('./check-chat-scanner-health.cjs');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbc-health-test-'));
const temporary = fs.mkdtempSync('/dev/shm/dbc-health-test-');
const socketPath = path.join(directory, 'clamd.sock');
const token = 'fixture-scanner-token-at-least-32-characters';
const now = Date.now();
let detects = true, stale = false;
const daemon = net.createServer(socket => {
  let bytes = Buffer.alloc(0);
  socket.on('error', () => {});
  socket.on('data', chunk => {
    bytes = Buffer.concat([bytes, chunk]);
    if (bytes.subarray(0, 9).toString() === 'zVERSION\0') {
      const time = new Date(now - (stale ? 49 * 3600000 : 1000)).toUTCString().replace(/ GMT$/, '');
      socket.end('ClamAV 1.5.4/1234/' + time + '\0');
    } else if (bytes.subarray(0, 10).toString() === 'zINSTREAM\0' && bytes.length >= 14 && bytes.readUInt32BE(bytes.length - 4) === 0) {
      socket.end(detects ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
    }
  });
});
const service = createScannerServer({token, socketPath, tmpDir:temporary});

(async () => {
  try {
    await new Promise(resolve => daemon.listen(socketPath, resolve));
    await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
    const local = 'http://127.0.0.1:' + service.address().port + '/health';
    const fetcher = (_url, options) => fetch(local, options);
    const options = {endpoint:'https://scanner.example.invalid/scan',token,fetcher};
    assert.equal((await checkScannerHealth(options)).engine, 'ClamAV 1.5.4');
    assert.equal((await fetch(local, {headers:{'X-Scan-Nonce':'a'.repeat(32)}})).status, 403);
    assert.equal((await fetch(local, {headers:{authorization:'Bearer ' + token}})).status, 400);
    detects = false; await assert.rejects(checkScannerHealth(options), /not ready/);
    detects = true; stale = true; await assert.rejects(checkScannerHealth(options), /not ready/);
    stale = false;
    await assert.rejects(checkScannerHealth({...options, endpoint:'http://scanner.example.invalid/scan'}), /configuration/);
    await assert.rejects(checkScannerHealth({...options, fetcher:async () => new Response(JSON.stringify({ready:true,nonce:'wrong'}), {headers:{'content-type':'application/json'}})}), /could not be verified/);
    await assert.rejects(checkScannerHealth({...options, fetcher:async () => new Response('a'.repeat(4097), {headers:{'content-type':'application/json'}})}), /too large/);
    console.log('PASS authenticated scanner readiness, signature freshness, EICAR self-test and bounded client; simulated engine only.');
  } finally {
    service.closeAllConnections();
    await Promise.all([new Promise(resolve => service.close(resolve)), new Promise(resolve => daemon.close(resolve))]);
    fs.rmSync(directory, {recursive:true,force:true});
    fs.rmSync(temporary, {recursive:true,force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
