const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + '\nreturn connect;')(require);
const navigationStart = source.indexOf('  async function loadDocument(');
const navigationEnd = source.indexOf('  async function shot(', navigationStart);
assert(navigationStart >= 0 && navigationEnd > navigationStart, 'Use the actual browser navigation helper');

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
    const loadDocument = new Function('c', source.slice(navigationStart, navigationEnd) + '\nreturn loadDocument;')(c);
    let beforeUnload = 0, alerts = 0;
    const unsubscribe = c.on(event => {
      if (event.method === 'Page.javascriptDialogOpening') {
        if (event.params.type === 'beforeunload') beforeUnload++;
        if (event.params.type === 'alert') alerts++;
      }
    });
    try {
      await c.evaluate(`document.body.innerHTML='<button style="position:fixed;left:10px;top:10px;width:100px;height:50px">Activate</button>';window.addEventListener('beforeunload',event=>{event.preventDefault();event.returnValue='';});true`);
      await c.cmd('Input.dispatchMouseEvent', {type:'mousePressed',x:50,y:30,button:'left',clickCount:1});
      await c.cmd('Input.dispatchMouseEvent', {type:'mouseReleased',x:50,y:30,button:'left',clickCount:1});
      await loadDocument('Page.reload');
      assert.equal(beforeUnload, 1, 'Confirm the actual native before-unload prompt during a deliberate reload');
      await assert.rejects(loadDocument('Page.navigate', {url:'data:text/html;charset=utf-8,<script>alert("Unexpected test alert")</script>'}), /Unexpected browser dialog.*alert/);
      assert.equal(alerts, 1, 'An unexpected alert must fail instead of being silently accepted');
      // Dismiss only the isolated calibration alert after its rejection check.
      await c.cmd('Page.handleJavaScriptDialog', {accept:true});
    } finally { unsubscribe(); }
    console.log('PASS actual CDP client: successful results preserved; JavaScript errors reject; deliberate before-unload confirmed and unexpected alert rejected.');
  } finally {
    c.close();
    const endpoint = process.env.DBC_CDP_URL || 'http://localhost:9224';
    await fetch(`${endpoint}/json/close/${c.tabId}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
