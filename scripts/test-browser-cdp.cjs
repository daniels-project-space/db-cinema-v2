const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + '\nreturn connect;')(require);

(async () => {
  const c = await connect();
  try {
    await c.cmd('Page.enable');
    await c.cmd('Page.navigate', { url: 'data:text/html;charset=utf-8,<title>Protocol checks</title><main>Isolated test page</main>' });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { ready = await c.evaluate('document.title === "Protocol checks" && document.readyState === "complete"'); }
      catch (e) {
        if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/.test(e.message)) throw e;
      }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(ready, 'The actual browser calibration page must load');
    assert.deepEqual(await c.evaluate('({ok:true,count:2})'), { ok: true, count: 2 });
    assert.equal(await c.evaluate('Promise.resolve("async result")'), 'async result');
    assert.equal(await c.evaluate('undefined'), undefined, 'Legitimate undefined remains a successful result');
    await assert.rejects(c.evaluate('const = ;'), /SyntaxError/);
    await assert.rejects(c.evaluate('(() => { throw Error("Checkout action failed"); })()'), /Checkout action failed/);
    await assert.rejects(c.evaluate('Promise.reject(Error("Async checkout action failed"))'), /Async checkout action failed/);
    console.log('PASS actual CDP client: ordinary/async/undefined results preserved; syntax, runtime and awaited promise failures reject with their browser error.');
  } finally {
    c.close();
    const endpoint = process.env.DBC_CDP_URL || 'http://localhost:9224';
    await fetch(`${endpoint}/json/close/${c.tabId}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
