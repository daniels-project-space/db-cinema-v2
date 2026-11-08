const crypto = require('node:crypto');

async function checkScannerHealth({ endpoint, token, fetcher = fetch, now = Date.now() }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/scan' || !token || token.length < 32) throw Error('Scanner configuration unavailable');
  url.pathname = '/health';
  const nonce = crypto.randomBytes(16).toString('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Authorization: 'Bearer ' + token, 'X-Scan-Nonce': nonce } });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw Error('Scanner is not ready');
    const reader = response.body?.getReader();
    if (!reader) throw Error('Scanner response unavailable');
    const chunks = []; let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 4096) { await reader.cancel(); throw Error('Scanner response too large'); }
      chunks.push(part.value);
    }
    const result = JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size).toString('utf8'));
    if (result.nonce !== nonce || result.ready !== true || !/^ClamAV [0-9][0-9.]+$/.test(result.engine) || !/^\d+$/.test(result.signatureVersion) || !Number.isSafeInteger(result.signatureUpdatedAt) || result.signatureUpdatedAt > now || result.signatureUpdatedAt < now - 48 * 60 * 60 * 1000) throw Error('Scanner readiness could not be verified');
    return { engine: result.engine, signatureVersion: result.signatureVersion, signatureUpdatedAt: result.signatureUpdatedAt };
  } finally {
    clearTimeout(timer);
  }
}

if (require.main === module) {
  checkScannerHealth({ endpoint: process.env.CHAT_ATTACHMENT_SCANNER_URL, token: process.env.CHAT_ATTACHMENT_SCANNER_TOKEN })
    .then(result => console.log(JSON.stringify({ ready: true, ...result })))
    .catch(() => { console.error('Scanner readiness check failed.'); process.exitCode = 1; });
}
module.exports = { checkScannerHealth };
