const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const membershipSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", membershipSource.slice(0, membershipSource.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checkoutSource = fs.readFileSync(path.join(__dirname, "../src/app/checkout/page.tsx"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../src/app/checkout/checkout.module.css"), "utf8");

assert.match(checkoutSource, /styles\.fulfilmentChoice/);
assert.match(checkoutSource, /data-testid=\{`fulfilment-glyph-\$\{f\}`\}/);
assert.match(checkoutSource, /data-testid="claim-consent-glyph"/);
assert.match(checkoutSource, /data-testid="hold-return-glyph"/);
assert.match(css, /prefers-reduced-motion:\s*reduce/);

const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main style="display:flex;gap:24px;padding:48px;background:#111;color:#eac8a4;font:16px sans-serif"><button class="fulfilmentChoice" aria-pressed="true" style="padding:24px;background:#201d1a;border:1px solid #9b7658;border-radius:16px;color:inherit"><span class="fulfilmentGlyph"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3 19 10 12 21 5 10Z"/></svg></span>Pick up</button><details class="agreementDetail" open style="padding:16px;background:#201d1a;border:1px solid #444;border-radius:16px"><summary style="display:flex;align-items:center;gap:8px;list-style:none"><svg class="detailGlyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"><circle class="glyphOrbit" cx="12" cy="12" r="10" stroke-dasharray="4 6"/><path d="M8 6.5h8v11l-4-2.2-4 2.2v-11Z"/><path class="glyphMark" d="M10 10h4M10 12.8h4" stroke-linecap="round"/></svg>Claim timing & details</summary><p>One documented payment attempt follows the itemised notice.</p></details></main>`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-checkout-glyphs-"));
  const server = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]; break; }
      catch { await wait(100); }
    }
    assert(port, "isolated Chrome DevTools port is available");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect();
    await browser.cmd("Page.enable");
    await browser.cmd("Runtime.enable");
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
    await wait(250);
    const active = await browser.evaluate(`({fulfilment:getComputedStyle(document.querySelector('.fulfilmentGlyph')).animationName, halo:getComputedStyle(document.querySelector('.fulfilmentGlyph'),'::after').animationName, agreement:getComputedStyle(document.querySelector('.detailGlyph')).animationPlayState, orbit:getComputedStyle(document.querySelector('.glyphOrbit')).animationPlayState})`);
    assert.notEqual(active.fulfilment, "none", "selected fulfilment glyph loops");
    assert.notEqual(active.halo, "none", "selected fulfilment glyph has a moving halo");
    assert.equal(active.agreement, "running", "expanded agreement glyph visibly loops");
    assert.equal(active.orbit, "running", "expanded agreement's orbit loops independently");
    const screenshot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync("/tmp/dbc-checkout-expanded-glyphs.png", Buffer.from(screenshot.data, "base64"));
    await browser.cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const reduced = await browser.evaluate(`({fulfilment:getComputedStyle(document.querySelector('.fulfilmentGlyph')).animationName, halo:getComputedStyle(document.querySelector('.fulfilmentGlyph'),'::after').animationName, agreement:getComputedStyle(document.querySelector('.detailGlyph')).animationName, orbit:getComputedStyle(document.querySelector('.glyphOrbit')).animationName})`);
    for (const animation of Object.values(reduced)) assert.equal(animation, "none", "reduced-motion disables checkout glyph animation");
    console.log("PASS checkout expanded glyphs: selected/open loops render in browser and stop for reduced motion. Screenshot: /tmp/dbc-checkout-expanded-glyphs.png");
  } finally {
    if (browser) browser.close();
    await new Promise(resolve => server.close(resolve));
    if (chrome.exitCode === null) {
      const done = new Promise(resolve => chrome.once("exit", resolve));
      chrome.kill();
      await done;
    }
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
