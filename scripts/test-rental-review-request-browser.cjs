const assert = require("node:assert/strict"), fs = require("node:fs"), http = require("node:http"), os = require("node:os"), path = require("node:path"), { spawn } = require("node:child_process");
const esbuild = require("esbuild"), postcss = require("postcss");
const source = fs.readFileSync("scripts/test-membership-browser.cjs", "utf8");
const connect = new Function("require", source.slice(0, source.indexOf("const { ConvexHttpClient }")) + "\nreturn connect;")(require);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const conversationSource = fs.readFileSync("src/components/rentals/RentalConversation.tsx", "utf8");
const renterReviewSource = fs.readFileSync("src/components/account/BookingReview.tsx", "utf8");
const invitationSource = fs.readFileSync("convex/reviewInvitations.ts", "utf8");
assert.match(conversationSource, /m\.meta\?\.kind === "review_invitation" && !admin && bookingId && <BookingReview key=\{bookingId\} bookingId=\{bookingId\} token=\{token\} inline \/>/, "a review invitation chat message mounts the inline renter review form");
assert.match(invitationSource, /await assertAdmin\(ctx, token, "reviewInvitations\.sendByAdmin"\)[\s\S]*?await postInvitation\(ctx, booking, result\.account\)/, "the admin control uses the authenticated invitation action");
assert.match(invitationSource, /meta: \{ kind: "review_invitation" \}/, "the backend message uses the renderer's native review-card marker");
assert.match(renterReviewSource, /<ReviewEye \/>/, "the interactive review card includes the animated eye glyph");
assert.match(renterReviewSource, /aria-label="Rental rating"[\s\S]*?\[1,2,3,4,5\]/, "the renter card exposes five star choices");
assert.match(renterReviewSource, /aria-label="Your rental review"/, "the renter card includes a review text box");

(async () => {
  const bundle = await esbuild.build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {RentalReviewRequest} from './src/components/admin/RentalReviewRequest';import {BookingReview} from './src/components/account/BookingReview';function Fixture(){const [booking,setBooking]=useState('rental-one');const [token,setToken]=useState('fixture-admin');const [state,setState]=useState('ready');const [view,setView]=useState('admin');window.fixture={setBooking,setState,setToken,setView};return <main style={{padding:16}}>{view==='admin'?<RentalReviewRequest token={token} bookingId={booking}/>:<BookingReview token={token} bookingId={booking} inline/>}</main>}createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: process.cwd(), loader: "jsx" }, bundle: true, write: false, plugins: [{ name: "mock-convex", setup(build) {
    build.onResolve({ filter: /^convex\/react$|_generated\/api$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", contents: args.path === "convex/react" ? `export const useQuery=(ref,args)=>ref==='eligibility'?(window.fixtureEligibility??{eligible:true,encoreEligible:false,canCheck:true,reviewed:false}):({state:window.fixtureState??'ready',bookingId:args.bookingId});export const useMutation=(ref)=>async(args)=>{if(ref==='sendByAdmin')window.calls.push(args);else if(ref==='submitNative')window.submissions.push(args);return {state:'sent'}};export const useAction=()=>async(args)=>{window.actionCalls.push(args);return {eligible:true}};` : `export const api={reviewInvitations:{adminStatus:'adminStatus',sendByAdmin:'sendByAdmin',eligibility:'eligibility'},reviewActions:{checkEligibility:'checkEligibility'},reviews:{submitNative:'submitNative'}};` }));
  } }] });
  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    response.setHeader("content-type", "text/html"); response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:#111;color:white"><div id="root"></div><script>window.calls=[];window.submissions=[];window.actionCalls=[]</script><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-review-request-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${temporary}`], { stdio: "ignore" });
  let client;
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${temporary}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`; client = await connect(); await client.cmd("Page.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=admin-review-request]")'); attempt++) await wait(100);
    const click = async text => { const found = await client.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(element=>element.textContent.trim()===${JSON.stringify(text)});if(!button)return false;button.click();return true})()`); assert(found, `Missing button: ${text}`); await wait(80); };
    await client.evaluate('document.querySelector("summary").click()'); await wait(80);
    assert.equal(await client.evaluate("window.calls.length"), 0);
    await click("Send review request"); assert.equal(await client.evaluate("window.calls.length"), 0, "opening confirmation must not send");
    assert.match(await client.evaluate('document.querySelector("[role=group]").textContent'), /receive the review form in this rental chat/i);
    const reviewPreview = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-review-request-confirm-320.png", Buffer.from(reviewPreview.data, "base64"));
    await click("Cancel"); assert.equal(await client.evaluate("window.calls.length"), 0, "cancellation must not send");
    await click("Send review request"); await click("Confirm and send");
    assert.deepEqual(await client.evaluate("window.calls"), [{ token: "fixture-admin", bookingId: "rental-one" }]);
    assert.match(await client.evaluate('document.querySelector("[role=status]").textContent'), /review request is in this rental conversation/i);
    await client.evaluate("window.fixtureState='sent';window.fixture.setState('sent')"); await wait(80);
    assert.match(await client.evaluate('document.querySelector("[data-testid=admin-review-request]").textContent'), /review request was already sent/i);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-review-request] button").length'), 0);
    await client.evaluate("window.fixtureState='not_settled';window.fixture.setState('not_settled')"); await wait(80);
    assert.match(await client.evaluate('document.querySelector("[data-testid=admin-review-request]").textContent'), /settlement must be complete/i);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-review-request] button").length'), 0);
    await client.evaluate("window.fixtureState='ready';window.fixture.setState('ready')"); await wait(80);
    await click("Send review request");
    await client.evaluate("window.fixture.setBooking('rental-two')"); await wait(80);
    assert.equal(await client.evaluate(`[...document.querySelectorAll('button')].some(element=>element.textContent.trim()==='Confirm and send')`), false, "changing rental must discard the previous confirmation");
    await client.evaluate('document.querySelector("summary").click()'); await wait(80);
    await click("Send review request"); await click("Confirm and send");
    assert.deepEqual(await client.evaluate("window.calls[1]"), { token: "fixture-admin", bookingId: "rental-two" });
    assert.equal(await client.evaluate(`[...document.querySelectorAll('button')].some(element=>element.textContent.trim()==='Send review request')`), false, "A completed send cannot be repeated while status catches up");
    await client.evaluate("window.fixtureState='sent';window.fixture.setState('sent')"); await wait(80);
    await client.evaluate("window.fixtureState='ready';window.fixture.setState('ready')"); await wait(80);
    await click("Send review request");
    await client.evaluate("window.fixture.setToken('different-admin')"); await wait(80);
    assert.equal(await client.evaluate(`[...document.querySelectorAll('button')].some(element=>element.textContent.trim()==='Confirm and send')`), false, "changing admin must discard the previous confirmation");
    await client.evaluate('document.querySelector("summary").click()'); await wait(80);
    await click("Send review request"); await click("Confirm and send");
    assert.deepEqual(await client.evaluate("window.calls[2]"), { token: "different-admin", bookingId: "rental-two" });
    await client.evaluate("window.fixture.setView('customer')"); await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-review-form]")'), true, "the invitation renders the native review card for the renter");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=review-eye-glyph]")'), true, "the card shows the animated eye glyph");
    assert.equal(await client.evaluate('document.querySelectorAll("[role=group][aria-label=\\\"Rental rating\\\"] button").length'), 5, "the card exposes five star buttons");
    assert.equal(await client.evaluate('!!document.querySelector("textarea[aria-label=\\\"Your rental review\\\"]")'), true, "the card includes the review text box");
    await client.evaluate('document.querySelector("button[aria-label=\\\"5 stars\\\"]").click()');
    await client.evaluate(`(()=>{const field=document.querySelector("textarea[aria-label=\\\"Your rental review\\\"]");const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;setter.call(field,"A clear native review card with a smooth rental experience.");field.dispatchEvent(new Event("input",{bubbles:true}));field.dispatchEvent(new Event("change",{bubbles:true}));})()`); await wait(80);
    const cardPreview = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-rental-review-card-320.png", Buffer.from(cardPreview.data, "base64"));
    await click("Publish review");
    assert.deepEqual(await client.evaluate("window.submissions[0]"), { token: "different-admin", bookingId: "rental-two", rating: 5, text: "A clear native review card with a smooth rental experience.", showProfilePhoto: false });
    assert.match(await client.evaluate('document.querySelector("[role=status]").textContent'), /Reviewed — thank you/i);
    assert.equal(await client.evaluate("document.documentElement.scrollWidth > innerWidth"), false, "320px must not overflow horizontally");
    const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-review-request-320.png", Buffer.from(screenshot.data, "base64"));
    console.log("PASS admin review invitation and native renter card: confirmation, eligibility/dedup path, animated eye, five-star input, review text submission and 320px layout; synthetic data only.");
  } finally { if (client) client.close(); if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; } server.close(); await wait(200); await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
