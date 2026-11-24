const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), os = require("node:os"), path = require("node:path"), { spawn } = require("node:child_process");
const esbuild = require("esbuild"), postcss = require("postcss");
const source = fs.readFileSync("scripts/test-membership-browser.cjs", "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + "\nreturn connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const bundle = await esbuild.build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {RentalVerificationSummary} from './src/components/rentals/RentalVerificationSummary';const params=new URLSearchParams(location.search);const admin=!params.has('renter')&&!params.has('guest');function Fixture(){const [bookingId,setBookingId]=useState('synthetic-rental');window.setFixtureBookingId=setBookingId;return <main style={{padding:16,maxWidth:440}}><RentalVerificationSummary token="admin-fixture" bookingId={bookingId} admin={admin}/></main>}createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, plugins: [{ name: "verification-fixture", setup(build) {
    build.onResolve({ filter: /^next\/link$|^convex\/react$|_generated\/api$|^\.\/VerificationProgress$|^\.\/useVerificationRefresh$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "convex/react" ? `const params=new URLSearchParams(location.search);export const useQuery=(_ref,args)=>({status:params.has('approved')?'confirmed':params.has('closed-active')?'active':'pending_verification',idVerifyStatus:params.has('approved')?'verified':'manual_review',idVerificationSource:'didit',verificationExpiresAt:params.has('approved')?Date.now()+86400000:undefined,verificationProvider:'didit',verificationNote:'A required check needs review.',diditSessionId:params.has('missing-session')?undefined:args?.bookingId==='second-synthetic-rental'?'synthetic-session-456':'synthetic-session-123',checkoutPaidAt:params.has('unpaid')?undefined:Date.now()-60000,verificationWindowClosed:(params.has('closed')||params.has('closed-active'))&&!params.has('override'),verificationLateOverrideAt:params.has('override')?Date.now():undefined,verificationChecks:params.has('approved')?{identity:'approved',selfie:'approved',address:'approved'}:{identity:'approved',selfie:'approved',address:'review'}});export const useMutation=()=>async args=>{window.mutationCalls.push(args);return {alreadyAllowed:false}};export const useAction=action=>async args=>{if(action==='refresh'){window.refreshCalls.push(args);return {status:params.get('refresh')||'unchanged',providerStatus:'In Review'}}if(action==='link'){window.linkCalls.push(args);const second=args.bookingId==='second-synthetic-rental';return {url:second?'https://verify.didit.me/session/synthetic-session-456':'https://verify.didit.me/session/synthetic-session-123',issues:[{feature:'POA',risk:second?'NEW_CASE':'ADDRESS_MISMATCH',summary:second?'A different case has a new finding.':'The address differs from proof of address.',detail:second?'This finding belongs to the second case.':'Didit found a mismatch.'}]}}window.reviewCalls.push(args);if(params.has('mismatch'))return {status:'verified',providerStatus:'Approved'};return {approve:{status:'verified',providerStatus:'Approved'},resubmit:{status:'requires_input',providerStatus:'Resubmitted'},decline:{status:'rejected',providerStatus:'Declined'}}[args.decision]};` : args.path.endsWith("api") ? `export const api={rentalOperations:{details:'details'},bookings:{verificationProgress:'progress',adminAllowLateVerification:'late'},didit:{refreshProgress:'refresh',adminReview:'review',adminVerificationLink:'link'}};` : args.path === "next/link" ? `import React from 'react';export default function Link({href,children,...rest}){return <a href={href} {...rest}>{children}</a>}` : args.path.includes("useVerificationRefresh") ? `export const useVerificationRefresh=()=>null;` : `import React from 'react';export const VerificationBar=()=> <div>Verification progress</div>;` }));
  } }] });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    response.setHeader("content-type", "text/html"); response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:#111;color:white"><div id="root"></div><script>window.refreshCalls=[];window.reviewCalls=[];window.linkCalls=[];window.mutationCalls=[];window.copyCalls=[];window.openedUrls=[];window.openCalls=[];window.open=(url,target)=>{window.openCalls.push({url,target});return{opener:{},location:{replace:next=>window.openedUrls.push(next)},close:()=>window.popupClosed=true}};Object.defineProperty(navigator,"clipboard",{value:{writeText:async value=>window.copyCalls.push(value)}})</script><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-verification-review-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temporary}`], { stdio: "ignore" });
  let client;
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${temporary}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; client = await connect(); await client.cmd("Page.enable");
    for (const width of [320, 1440]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width === 320 });
      await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter` });
      for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Rental verification progress\\"]")'); attempt++) await wait(100);
      assert.equal(await client.evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'renter verification does not overflow');
      assert.deepEqual(await client.evaluate(`Array.from(document.querySelectorAll('[aria-label="Document checks"] > div')).map(row => row.innerText.trim().replace(/\\s+/g,' '))`), ['Photo ID Passed', 'Selfie & face match Passed', 'Proof of address Review']);
      assert.equal(await client.evaluate(`document.querySelector('a[href="/account/verification/synthetic-rental"]')?.textContent.includes('Open verification')`), true, 'verification action remains bound to the rental');
      const image = await client.cmd('Page.captureScreenshot', {format:'png'}); fs.writeFileSync(`/tmp/dbc-renter-verification-card-${width}.png`, Buffer.from(image.data,'base64'));
    }
    await client.cmd('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[aria-label="Rental verification progress"] svg[viewBox="0 0 100 100"]')).animationName`), 'none', 'aperture respects reduced motion');
    await client.cmd('Emulation.setEmulatedMedia', {features:[]});
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Rental verification progress\\"]")'); attempt++) await wait(100);
    assert.match(await client.evaluate('document.body.textContent'), /Action needed/);
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.equal(await client.evaluate('document.documentElement.scrollWidth > innerWidth'), false, "desktop review layout does not overflow horizontally");
    assert.ok(await client.evaluate(`(()=>{const card=document.querySelector('[aria-label="Didit review"]');return !!card&&card.getBoundingClientRect().width<=480})()`), "desktop review card remains compact rather than stretching across the workspace");
    const desktopScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-verification-review-1440.png", Buffer.from(desktopScreenshot.data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 900, deviceScaleFactor: 1, mobile: true });
    assert.match(await client.evaluate('document.body.textContent'), /synthetic-session-123/);
    assert.match(await client.evaluate('document.body.textContent'), /Decision updates Didit first, then syncs this rental/);
    assert.equal(await client.evaluate(`document.querySelectorAll('[aria-label="Check Didit status"]').length`), 1, "one manual-review card has a single provider status check");
    assert.doesNotMatch(await client.evaluate('document.body.textContent'), /Sync Didit status/, "manual review does not show a duplicate refresh action");
    assert.ok(await client.evaluate(`!!document.querySelector('[aria-label="Open Didit verification"]')`), "admins can open the provider case");
    await client.evaluate(`document.querySelector('[aria-label="Open Didit verification"]').click()`); await wait(80);
    assert.deepEqual(await client.evaluate("window.linkCalls"), [{bookingId:"synthetic-rental",token:"admin-fixture"}], "the secure action looks up the session bound to this booking");
    assert.deepEqual(await client.evaluate("window.openedUrls"), ["https://verify.didit.me/session/synthetic-session-123"], "the UI opens the exact provider-returned verification URL");
    assert.deepEqual(await client.evaluate("window.openCalls"), [{url:"about:blank",target:"_blank"}]);
    assert.match(await client.evaluate("document.body.textContent"), /Didit returned 1 finding/);
    assert.match(await client.evaluate("document.body.textContent"), /Didit findings/);
    assert.match(await client.evaluate("document.body.textContent"), /The address differs from proof of address/);
    assert.match(await client.evaluate("document.body.textContent"), /Didit found a mismatch/);
    await client.evaluate(`document.querySelector('[aria-label="Copy Didit session ID"]').click()`); await wait(30);
    assert.deepEqual(await client.evaluate('window.copyCalls'), ["synthetic-session-123"], "Copy ID saves the exact Didit session ID for its User verifications search");
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Copy Didit session ID"]').textContent`), "Copied");
    assert.deepEqual(await client.evaluate(`["Approve Didit review","Request Didit resubmission","Decline Didit review"].map(label=>!!document.querySelector('button[aria-label="'+label+'"]'))`), [true,true,true], "admins receive the three explicit Didit review decisions");
    assert.match(await client.evaluate(`document.querySelector('[aria-label="Request Didit resubmission"]').textContent`), /updated checks/i, "resubmission can request provider-supported checks beyond documents");
    assert.equal(await client.evaluate(`!!document.querySelector('textarea[id^="didit-review-reason-"]')`), true, "provider decisions include a short reason field");
    assert.match(await client.evaluate('document.body.textContent'), /Reason for decision/);
    assert.doesNotMatch(await client.evaluate('document.body.textContent'), /Reason sent to Didit/, "an unsent reason must not be presented as already sent");
    assert.deepEqual(await client.evaluate(`['Approve in Didit','Request updated checks','Decline in Didit'].map(label=>[...document.querySelectorAll('button')].some(button=>button.textContent===label))`),[true,true,true],"visible labels distinguish provider decisions and resubmission");
    assert.equal(await client.evaluate('document.documentElement.scrollWidth > innerWidth'), false);
    assert.equal(await client.evaluate(`(()=>{const labels=[...document.querySelectorAll('[aria-label="Document checks"] [data-testid="verification-check-label"]')].map(node=>node.textContent);return labels.includes('Selfie & face match')&&labels.includes('Proof of address')})()`), true, 'Long check labels remain fully visible');
    assert.equal(await client.evaluate(`(()=>[...document.querySelectorAll('[aria-label="Document checks"] > div')].every(node=>node.scrollWidth<=node.clientWidth))()`), true, 'Check chips do not clip at 320px');
    const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-verification-review-320.png", Buffer.from(screenshot.data, "base64"));
    await client.evaluate(`document.querySelector('[aria-label="Check Didit status"]').click()`); await wait(80);
    assert.deepEqual(await client.evaluate('window.refreshCalls'), [{ bookingId: "synthetic-rental", accountToken: "admin-fixture", admin: true }]);
    assert.match(await client.evaluate('document.body.textContent'), /No change yet/);
    for (const [status, expected] of [
      ["confirmation_retry_queued", "Didit passed · booking confirmation is retrying."],
      ["decision_uncertain", "Decision still uncertain · check the Didit case before taking further action."],
      ["throttled", "Checked recently · try again shortly."],
      ["late", "Verification deadline passed · rental remains pending."],
      ["closed", "Rental closed · status refresh is unavailable."],
      ["not_started", "No Didit session is linked to this rental."],
    ]) {
      await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?refresh=${status}` });
      for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Didit review\\"]")'); attempt++) await wait(100);
      await client.evaluate(`document.querySelector('[aria-label="Check Didit status"]').click()`);
      for (let attempt = 0; attempt < 40 && !await client.evaluate(`document.body.textContent.includes(${JSON.stringify(expected)})`); attempt++) await wait(20);
      assert.ok(await client.evaluate(`document.body.textContent.includes(${JSON.stringify(expected)})`), `refresh status ${status} has a clear result message`);
    }
    await client.evaluate(`document.querySelector('[aria-label="Decline Didit review"]').click()`); await wait(30);
    assert.match(await client.evaluate('document.body.textContent'), /Add a short reason first/);
    assert.equal(await client.evaluate('window.reviewCalls.length'),0,"the review decision needs a reason before writing to Didit");
    await client.evaluate(`(()=>{const field=document.querySelector('textarea[id^="didit-review-reason-"]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,'Didit declined after provider review.');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await client.evaluate(`document.querySelector('[aria-label="Decline Didit review"]').click()`);
    for (let attempt = 0; attempt < 40 && !await client.evaluate('window.reviewCalls.length'); attempt++) await wait(20);
    assert.deepEqual(await client.evaluate('window.reviewCalls.map(({bookingId,token,decision,note})=>({bookingId,token,decision,note}))'), [{bookingId:"synthetic-rental",token:"admin-fixture",decision:"decline",note:"Didit declined after provider review."}], "the explicit decision is bound to the displayed rental and includes its recorded reason");
    assert.match(await client.evaluate('document.body.textContent'), /Didit declined · rental remains unconfirmed; no bonus credit applies/);
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?approval=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Didit review\\"]")'); attempt++) await wait(100);
    await client.evaluate(`(()=>{const field=document.querySelector('textarea[id^="didit-review-reason-"]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,'Provider approved the complete verification.');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await client.evaluate(`document.querySelector('[aria-label="Approve Didit review"]').click()`);
    for (let attempt = 0; attempt < 40 && !await client.evaluate('document.body.textContent.includes("Didit approved · website verification synced")'); attempt++) await wait(20);
    assert.match(await client.evaluate('document.body.textContent'), /Didit approved · website verification synced; booking confirmation may still be pending/,"approval copy separates Didit's result from subsequent rental confirmation");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?mismatch=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Didit review\\"]")'); attempt++) await wait(100);
    await client.evaluate(`(()=>{const field=document.querySelector('textarea[id^="didit-review-reason-"]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,'Reviewed the provider decision.');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await client.evaluate(`document.querySelector('[aria-label="Decline Didit review"]').click()`);
    for (let attempt = 0; attempt < 40 && !await client.evaluate('document.body.textContent.includes("Didit did not confirm this decision")'); attempt++) await wait(20);
    assert.match(await client.evaluate('document.body.textContent'), /Didit did not confirm this decision/);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=didit-review-card]")'), true, "a mismatched provider receipt does not claim success or dismiss the pending review");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?closed=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Didit review\\"]")'); attempt++) await wait(100);
    assert.match(await client.evaluate('document.body.textContent'), /Window closed · use the one-rental override above to decide/);
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent.includes('Allow verification for this rental'))`),true,"a pending rental with a closed window shows its available one-rental override");
    assert.equal(await client.evaluate(`document.querySelector('button[data-testid="allow-late-verification"]').disabled`),true,"late verification cannot be reopened without a recorded reason");
    assert.deepEqual(await client.evaluate(`["Approve Didit review","Request Didit resubmission","Decline Didit review"].map(label=>document.querySelector('button[aria-label="'+label+'"]')?.disabled)`), [true,true,true], "a closed rental cannot submit a decision before its one-rental override");
    await client.evaluate(`(()=>{const field=document.querySelector('[data-testid="late-verification-reason"]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,'Renter contacted us and has a live provider case.');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await client.evaluate(`document.querySelector('button[data-testid="allow-late-verification"]').click()`);
    for (let attempt = 0; attempt < 40 && !await client.evaluate('document.body.textContent.includes("Allowed for this rental only")'); attempt++) await wait(20);
    assert.deepEqual(await client.evaluate('window.mutationCalls'),[{token:"admin-fixture",bookingId:"synthetic-rental",reason:"Renter contacted us and has a live provider case."}],"the admin action records a reason against only the displayed rental ID");
    assert.match(await client.evaluate('document.body.textContent'),/Allowed for this rental only · syncing Didit now/);
    assert.equal(await client.evaluate('window.reviewCalls.length'),0,"reopening verification does not itself approve or decline a Didit case");
    const closedWindowScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-verification-review-closed-320.png", Buffer.from(closedWindowScreenshot.data, "base64"));
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?closed-active=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Didit review\\"]")'); attempt++) await wait(100);
    assert.match(await client.evaluate('document.body.textContent'), /Window closed · decisions are unavailable for this rental/);
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent.includes('Allow verification for this rental'))`),false,"a closed active rental does not promise an override button that is unavailable");
    assert.deepEqual(await client.evaluate(`['Approve Didit review','Request Didit resubmission','Decline Didit review'].map(label=>document.querySelector('button[aria-label="'+label+'"]')?.disabled)`),[true,true,true],"closed active rentals keep all Didit decision actions disabled");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?closed=1&override=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=late-verification-override-active]")'); attempt++) await wait(100);
    assert.match(await client.evaluate('document.querySelector("[data-testid=late-verification-override-active]")?.textContent'),/Didit must still pass/);
    assert.match(await client.evaluate('document.querySelector("[data-testid=late-verification-override-active]")?.textContent'),/does not approve the booking/);
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?closed=1&unpaid=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Rental verification progress\\"]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate(`!!document.querySelector('button[data-testid="allow-late-verification"]')`),false,"an unpaid pending rental never shows the admin override");
    assert.equal(await client.evaluate('window.mutationCalls.length'),0,"unpaid rental state cannot trigger an override mutation");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?missing-session=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Didit review\\"]")'); attempt++) await wait(100);
    assert.match(await client.evaluate('document.body.textContent'), /Didit case ID missing/);
    assert.deepEqual(await client.evaluate(`['Approve Didit review','Request Didit resubmission','Decline Didit review'].map(label=>document.querySelector('button[aria-label="'+label+'"]')?.disabled)`),[true,true,true],"a review without its Didit session keeps all provider decisions disabled");
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Open Didit verification"]')?.disabled`),true,"a review without its Didit session cannot open an unrelated provider case");
    await client.evaluate(`document.querySelector('[aria-label="Decline Didit review"]').click()`);
    assert.equal(await client.evaluate('window.reviewCalls.length'),0,"a missing provider session cannot submit a decision");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Rental verification progress\\"]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Rental verification progress"] a')?.getAttribute('href')`), '/account/verification/synthetic-rental', 'The renter action opens this rental’s verification');
    assert.equal(await client.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'Renter verification fits on mobile');
    const renterScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-verification-renter-320.png", Buffer.from(renterScreenshot.data, "base64"));
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?closed=1&renter=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Rental verification progress\\"]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\\"Didit review\\"]")'),false,"renters do not see the manual-review decision panel");
    assert.equal(await client.evaluate(`[...document.querySelectorAll("button")].some(button => /^Approve|^Decline|^Request Didit resubmission/.test(button.getAttribute('aria-label')||''))`),false,"renters do not receive Didit decision controls");
    assert.equal(await client.evaluate(`!!document.querySelector('button[data-testid="allow-late-verification"]')`),false,"renters cannot access the late-verification override");
    assert.equal(await client.evaluate('window.mutationCalls.length'),0,"renter view cannot invoke the admin override");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?closed=1&guest=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Rental verification progress\\"]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate(`!!document.querySelector('button[data-testid="allow-late-verification"]')`),false,"guest view cannot access the late-verification override");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?approved=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Rental verification progress\\"]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=didit-review-card]")'),false,"an approved verification shows progress without the manual-review panel");
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\\"Check Didit status\\"]")'),false,"an approved case does not show a review refresh control");
    assert.equal(await client.evaluate('document.querySelector("[aria-label=\\"Rental verification progress\\"]")?.textContent.includes("Verification approved")'),true,"the normal state shows approval only when the 90-day pass and provider checks are complete");
    const approvedScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-verification-approved-320.png", Buffer.from(approvedScreenshot.data, "base64"));
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?case-switch=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Didit review\\"]")'); attempt++) await wait(100);
    await client.evaluate(`document.querySelector('[aria-label="Open Didit verification"]').click()`); await wait(80);
    assert.match(await client.evaluate('document.body.textContent'), /The address differs from proof of address/);
    await client.evaluate(`(()=>{const field=document.querySelector('textarea[id^="didit-review-reason-"]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(field,'Reason for the first renter.');field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await client.evaluate(`window.setFixtureBookingId('second-synthetic-rental')`); await wait(80);
    assert.match(await client.evaluate('document.body.textContent'), /synthetic-session-456/);
    assert.doesNotMatch(await client.evaluate('document.body.textContent'), /The address differs from proof of address|Didit found a mismatch|Reason for the first renter/,'provider findings and typed decisions never carry over to another renter');
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Copy Didit session ID"]').textContent`),"Copy ID","copy feedback resets when the selected case changes");
    await client.evaluate(`document.querySelector('[aria-label="Open Didit verification"]').click()`); await wait(80);
    assert.deepEqual(await client.evaluate('window.linkCalls.map(call=>call.bookingId)'),["synthetic-rental","second-synthetic-rental"],"provider lookups remain bound to the currently selected rental");
    assert.match(await client.evaluate('document.body.textContent'), /A different case has a new finding/);
    assert.doesNotMatch(await client.evaluate('document.body.textContent'), /The address differs from proof of address|Didit found a mismatch/);
    console.log("PASS verification review, approved no-review state, closed-window actions, provider link, and renter visibility at 320px; synthetic data only.");
  } finally { if (client) client.close(); if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; } server.close(); await wait(200); await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
