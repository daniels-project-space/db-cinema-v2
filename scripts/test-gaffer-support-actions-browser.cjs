/** Browser regression for Contact Us Gaffer entry and renter-chat escalation actions; no messages or emails are sent. */
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), os = require("node:os"), assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), entry = root + "/scripts/fixtures/gaffer-support-actions.tsx", work = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-gaffer-actions-"));
const membershipSource = fs.readFileSync(root + "/scripts/test-membership-browser.cjs", "utf8"), connect = new Function("require", membershipSource.slice(0, membershipSource.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, chrome, browser;
(async () => {
  const esbuild = require("esbuild"), site = "export const CONTACT_EMAIL='dbcinemarentals@gmail.com';export const CONTACT_PHONE='';";
  await esbuild.build({ entryPoints: [entry], outfile: work + "/fixture.js", bundle: true, platform: "browser", format: "iife", jsx: "automatic", tsconfig: root + "/tsconfig.json", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent", plugins: [{ name: "contact-actions-browser", setup(build) {
    build.onResolve({ filter: /^@\/lib\/site$/ }, () => ({ path: "site", namespace: "support-fixture" }));
    build.onLoad({ filter: /.*/, namespace: "support-fixture" }, () => ({ contents: site, loader: "js" }));
  }}] });
  server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("content-type", "application/javascript"); response.end(fs.readFileSync(work + "/fixture.js")); return; }
    response.setHeader("content-type", "text/html"); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = work + "/chrome-profile", executable = process.env.DBC_CHROMIUM_PATH || "/snap/bin/chromium", port = process.env.DBC_SUPPORT_CDP_PORT || "9239";
  chrome = spawn(executable, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking", "--no-first-run", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
  process.env.DBC_CDP_URL = "http://127.0.0.1:" + port;
  let endpointReady = false;
  for (let i = 0; i < 100 && !endpointReady; i++) { if (chrome.exitCode !== null) throw Error("Chromium exited before its local debugging endpoint started"); try { endpointReady = (await fetch(process.env.DBC_CDP_URL + "/json/version")).ok; } catch {} if (!endpointReady) await wait(100); }
  assert(endpointReady, "Chromium exposes its local debugging endpoint");
  browser = await connect("http://127.0.0.1:" + server.address().port); await browser.cmd("Page.enable"); await browser.cmd("Runtime.enable");
  const errors = []; browser.on(message => { if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); });
  async function until(expression, label) { for (let i = 0; i < 100; i++) { if (await browser.evaluate(expression)) return; await wait(100); } throw Error(label + ": " + await browser.evaluate("JSON.stringify({body:document.body.innerText,root:document.querySelector('#root')?.innerHTML.slice(-800)})") + " browserErrors=" + JSON.stringify(errors)); }
  async function click(selector, label) { await until("!!document.querySelector(" + JSON.stringify(selector) + ")", label + " exists"); await browser.evaluate("document.querySelector(" + JSON.stringify(selector) + ").click()"); }
  await until("!!document.querySelector('[aria-label=\"Contact Us Gaffer entry\"]')", "Contact Us Gaffer entry renders");
  await click("[aria-label=\"Contact Us Gaffer entry\"] button", "Contact Us opens existing Gaffer chat");
  await until("window.fixture.openEvents.length===1", "Contact Us action opens Gaffer without sending a message");
  const contactOpen = await browser.evaluate("window.fixture.openEvents[0]"); assert.equal(contactOpen, "", "The Contact Us chat launcher opens the existing assistant without inventing or sending a prompt");
  await until("document.querySelectorAll('[aria-label=\"Contact Us Gaffer entry\"] button').length===6", "Contact Us quick-start actions render");
  await browser.evaluate("document.querySelectorAll('[aria-label=\"Contact Us Gaffer entry\"] button')[1].click()");
  await until("window.fixture.openEvents.length===2", "Contact Us quick-start opens chat with its selected prompt");
  assert.match(await browser.evaluate("window.fixture.openEvents[1]"), /build a kit/i, "The selected Contact Us starter carries its context into Gaffer chat");
  assert.match(await browser.evaluate("document.querySelector('[data-testid=resolved-answer]').innerText"), /£100 per day/, "A resolved answer remains visible");
  assert.equal(await browser.evaluate("document.querySelector('[data-testid=resolved-answer] a')"), null, "Resolved questions do not get an unsolicited contact handoff");
  const gafferAction = await browser.evaluate("(()=>{const root=document.querySelector('[data-testid=unresolved-contact-answer]'),link=root.querySelector('a');return {text:root.innerText,href:link?.getAttribute('href'),label:link?.innerText,className:link?.className,rawUrlVisible:root.innerText.includes('dbcinemarentals.com/contact')}})()");
  assert.equal(gafferAction.href, "/contact", "Gaffer contact escalation routes to the site's contact form"); assert.equal(gafferAction.label, "Open contact form↗", "A pasted Gaffer URL is replaced with a clear button label"); assert.match(gafferAction.className, /inline-flex/, "The Gaffer contact link is presented as a button, not bare text"); assert.equal(gafferAction.rawUrlVisible, false, "The raw contact URL is never shown in the Gaffer message");
  const rentalAction = await browser.evaluate("(()=>{const root=document.querySelector('[data-testid=rental-chat-contact-answer]'),link=root.querySelector('a');return {text:root.innerText,href:link?.href,label:link?.innerText,className:link?.className,rawUrlVisible:root.innerText.includes('dbcinemarentals.com/contact')}})()");
  const rentalTarget = new URL(rentalAction.href);
  assert.equal(rentalTarget.pathname.replace(/\/$/, ""), "/contact", "Rental-chat escalation reaches the site's contact form"); assert.equal(rentalAction.label, "Open contact form↗", "Rental chat renders the same labelled contact action"); assert.match(rentalAction.className, /inline-flex/, "Rental-chat contact action is visibly clickable"); assert.equal(rentalAction.rawUrlVisible, false, "Rental chat never leaves a pasted bare URL");
  const handoff = await browser.evaluate("document.querySelector('[data-testid=human-handoff-offer]')?.innerText"); assert.match(handoff, /Ask the team/, "A rental-specific escalation is offered inside the current rental chat");
  await browser.evaluate("(()=>{const button=document.querySelector('[data-testid=human-handoff-offer] button');button.click();button.click()})()"); await until("window.fixture.handoffCount===1&&document.querySelector('[data-testid=human-handoff-offer]').innerText.includes('Your request is in this chat.')", "Rental escalation remains in the existing conversation and duplicate clicks are ignored");
  assert.deepEqual(errors, [], "Contact and rental-chat actions render without browser errors");
  console.log(JSON.stringify({ result: "PASS", surfaces: ["Contact Us", "Gaffer message", "rental conversation"], resolvedAnswerHasNoUnsolicitedCTA: true, actionButtons: ["/contact", "current rental chat"], messagesSent: 0, emailsSent: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { browser?.close(); chrome?.kill("SIGTERM"); if (server) await new Promise(resolve => server.close(resolve)); fs.rmSync(work, { recursive: true, force: true }); });
