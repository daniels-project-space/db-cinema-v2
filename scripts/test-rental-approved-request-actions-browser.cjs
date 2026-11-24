const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");

const root = path.resolve(__dirname, "..");
const membershipTest = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", membershipTest.slice(0, membershipTest.indexOf("const { ConvexHttpClient }")) + "\nreturn connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-approved-request-actions-"));
  const entry = `import React,{useState} from 'react';
    import{createRoot}from'react-dom/client';
    import{RentalOrderTools}from'./src/components/admin/RentalOrderTools';
    function Fixture(){const[,refresh]=useState(0);window.setRequests=rows=>{window.fixtureRequests=rows;refresh(value=>value+1)};window.setBooking=booking=>{window.fixtureBooking=booking;refresh(value=>value+1)};return <main><RentalOrderTools token="fixture-admin" bookingId="fixture-booking" showReturn={false} showSavedCardTools={false} compactControls/></main>}
    createRoot(document.getElementById('root')).render(<Fixture/>);`;

  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{ name: "synthetic-admin-controls", setup(build) {
      build.onResolve({ filter: /^@\/components\/rentals\/RentalRequestHistory$/ }, () => ({ path: path.join(root, "src/components/rentals/RentalRequestHistory.tsx") }));
      build.onResolve({ filter: /^convex\/react$|^@cvx\/_generated\/api$|^@\/lib\/(cancellationPolicy|pricing|rentalPresentation)$|^@\/components\/(SmartImage|rentals\/(RentalConversation\.module\.css|SavedCardCharges))$|\.module\.css$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onResolve({ filter: /^\.\/(ReturnRentalForm|DepositRefundStatus|ReturnInspectionHistory|RentalManagerDelivery|SavedCardCharges|OperatorCancellationStatus|RentalDeliveryQuotePanel|RentalReviewRequest|RentalCasePanel|RentalSwapRecovery|RentalSwapStockReview|RentalSwapProposal|InventoryConflictRefund|RentalRequestApply)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
        if (args.path.endsWith("_generated/api")) return { loader: "js", resolveDir: root, contents: `export const api=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>String(group)+'.'+String(method)})});` };
        if (args.path === "convex/react") return { loader: "js", resolveDir: root, contents: `const blockers=()=>{const rows=(window.fixtureRequests||[]).filter(row=>row.status==='pending'||row.status==='approved'&&!((row.kind==='items'||row.kind==='extension')&&!row.execution)&&row.execution?.status!=='applied');return{ready:true,any:rows.length>0,dates:rows.some(row=>row.kind==='dates'),cancel:rows.some(row=>row.kind==='cancel'),handover:rows.some(row=>row.kind==='handover'),other:rows.some(row=>row.kind==='items'||row.kind==='extension')}};export const useQuery=(ref)=>ref==='rentalOperations.details'?window.fixtureBooking:ref==='rentalAdditionState.list'?[]:ref==='rentalRequests.blockingActions'?blockers():null;export const useMutation=()=>async()=>({});export const useAction=ref=>async args=>{window.fixtureActionCalls.push({ref,args});const request=(window.fixtureRequests||[]).find(row=>row._id===args.id);window.setRequests((window.fixtureRequests||[]).map(row=>row._id===args.id?{...row,status:'approved'}:row));if(window.failNextAction){window.failNextAction=false;throw new Error('fixture apply failure')}if(request?.kind==='cancel')window.fixtureBooking.status='cancelled';window.setRequests((window.fixtureRequests||[]).map(row=>row._id===args.id?{...row,status:'approved',execution:{status:'applied',detail:'Fixture applied'}}:row));return{status:'applied',detail:'Fixture applied'}};export const usePaginatedQuery=(ref)=>({results:ref==='rentalRequests.list'?window.fixtureRequests:[],status:'Exhausted',loadMore:()=>{}});` };
        if (args.path.endsWith("cancellationPolicy")) return { loader: "js", resolveDir: root, contents: `export const cancellationTimingBasis=()=>null;export const isNoRefundWithin48HoursCancellationVersion=()=>false;` };
        if (args.path.endsWith("pricing")) return { loader: "js", resolveDir: root, contents: `export const formatGbp=value=>'£'+Number(value||0).toFixed(2);` };
        if (args.path.endsWith("rentalPresentation")) return { loader: "js", resolveDir: root, contents: `export const rentalTitle=value=>value;export const rentalDate=()=>'';` };
        if (args.path.endsWith("SmartImage")) return { loader: "jsx", resolveDir: root, contents: `export const SmartImage=()=>null;` };
        if (args.path.includes("RentalConversation.module.css") || args.path.endsWith(".module.css")) return { loader: "js", resolveDir: root, contents: `export default new Proxy({},{get:(_,key)=>String(key)});` };
        if (args.path.endsWith("RentalRequestApply")) return { loader: "jsx", resolveDir: root, contents: `export function RentalRequestApply({kind}){return <button type="button" data-testid={'approved-'+(kind==='dates'?'date':kind==='cancel'?'cancel':'handover')+'-apply'}>Apply approved {kind}</button>}` };
        return { loader: "jsx", resolveDir: root, contents: `export const ${args.path.split("/").at(-1)}=()=>null;` };
      });
    }}],
  });

  const css = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const booking = {
    _id: "fixture-booking", status: "confirmed", guestEmail: "renter@example.invalid", stripePaymentIntentId: "pi_fixture",
    fulfilment: "pickup", total: 100, depositAmount: 0, rentalRefunds: [], controlsSnapshot: "fixture-snapshot",
    lineItems: [{ listingId: "fixture-listing", title: "Camera kit", qty: 1, start: Date.UTC(2030, 0, 1), end: Date.UTC(2030, 0, 2), pickupTime: "10:00", returnTime: "18:00", lineTotal: 100 }],
  };
  const html = `<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body style="background:#111;color:white"><div id="root"></div><script>window.fixtureBooking=${JSON.stringify(booking)};window.fixtureRequests=[];window.fixtureActionCalls=[];window.failNextAction=false</script><script src="/bundle.js"></script>`;
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); return response.end(bundle.outputFiles[0].text); }
    if (request.url === "/style.css") { response.setHeader("content-type", "text/css"); return response.end(css.css); }
    response.setHeader("content-type", "text/html"); response.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = path.join(directory, "chrome");
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let client;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "temporary Chrome did not start");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect();
    await client.cmd("Page.enable");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=rental-action-reschedule]")'); attempt++) await wait(50);
    const waitFor = async expression => { for (let attempt = 0; attempt < 100; attempt++) { if (await client.evaluate(expression)) return; await wait(25); } assert.fail(`Timed out waiting for ${expression}`); };

    await waitFor('!!document.querySelector("[data-testid=rental-action-reschedule]") && !!document.querySelector("[data-testid=rental-action-cancel]")');
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-return-time]")'), true, "a confirmed rental exposes its direct handover control when there are no open renter requests");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=approved-date-apply]")'), false);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=approved-cancel-apply]")'), false);

    const declinedDiditBooking = { ...booking, status: "pending_verification", verificationProvider: "didit", idVerifyStatus: "rejected", paidConfirmedAt: Date.UTC(2029, 11, 31) };
    await client.evaluate(`window.setBooking(${JSON.stringify({ ...declinedDiditBooking, verificationProvider: "other" })})`);
    await waitFor('!document.querySelector("[data-testid=rental-action-cancel]")');
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=didit-declined-rental-notice]")'), false, "a different provider's rejected verification does not unlock the special cancellation action");
    await client.evaluate(`window.setBooking(${JSON.stringify(declinedDiditBooking)})`);
    await waitFor('!!document.querySelector("[data-testid=rental-action-cancel]") && !!document.querySelector("[data-testid=didit-declined-rental-notice]")');
    assert.equal(await client.evaluate('document.querySelector("[data-testid=rental-action-cancel]").textContent.trim()'), "Retry settlement");
    assert.equal(await client.evaluate('document.querySelector("[data-testid=didit-declined-rental-notice]").textContent.includes("No 130% bonus")'), true, "the declined Didit rental follows accepted cancellation terms without promotional credit");
    await client.evaluate('document.querySelector("[data-testid=rental-action-cancel]").click()');
    await waitFor('!![...document.querySelectorAll("h4")].find(node=>node.textContent==="Cancel this rental")');
    assert.equal(await client.evaluate("window.fixtureActionCalls.length"), 0, "opening the protected cancellation form performs no settlement by itself");
    await client.evaluate('document.querySelector("button[type=button]") && [...document.querySelectorAll("button")].find(node=>node.textContent.trim()==="Close")?.click()');
    await client.evaluate(`window.setBooking(${JSON.stringify(booking)})`);
    await waitFor('document.querySelector("[data-testid=rental-action-reschedule]") && document.querySelector("[data-testid=rental-action-cancel]").textContent.trim()==="Cancel rental"');

    const approve = async (kind, id) => {
      await client.evaluate(`document.querySelector('[data-testid="approve-request-${kind}-${id}"]').click()`);
      await waitFor('!!document.querySelector("[aria-label=\\"Reply to request\\"]")');
      await client.evaluate(`(()=>{const field=document.querySelector('[aria-label="Reply to request"]');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(field,'Approved after checking availability and the saved renter request.');field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await client.evaluate(`document.querySelector('[data-testid="approve-request-submit-${kind}"]').click()`);
    };
    const pendingDate = [{ _id: "pending-date", kind: "dates", status: "pending", detail: "Move all items to the requested date", requestedStart: Date.UTC(2030, 0, 3), requestedEnd: Date.UTC(2030, 0, 4), requestedSnapshot: "fixture-snapshot", createdAt: Date.UTC(2029, 0, 1) }];
    await client.evaluate(`window.setRequests(${JSON.stringify(pendingDate)})`);
    await waitFor('!!document.querySelector("[data-testid=approve-request-dates-pending-date]")');
    await approve("dates", "pending-date");
    await waitFor('window.fixtureActionCalls.length===1 && !!document.querySelector("[data-testid=rental-action-reschedule]")');
    assert.equal(await client.evaluate('window.fixtureActionCalls[0].ref'), "rentalRequests.approveAndApply", "one admin approval invokes the guarded combined backend action");
    assert.equal(await client.evaluate('window.fixtureActionCalls[0].args.id'), "pending-date");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=approved-date-apply]")'), false, "successful approval has no second apply click");

    await client.evaluate(`window.failNextAction=true;window.setRequests(${JSON.stringify(pendingDate.map(row=>({...row,_id:"retry-date"})))})`);
    await waitFor('!!document.querySelector("[data-testid=approve-request-dates-retry-date]")');
    await approve("dates", "retry-date");
    await waitFor('window.fixtureActionCalls.length===2 && !!document.querySelector("[data-testid=approved-date-apply]")');
    assert.equal(await client.evaluate('!!document.querySelector("[role=alert]")'), true, "an interrupted apply surfaces a recovery action and error");
    const pendingCancel = [{ _id: "pending-cancel", kind: "cancel", status: "pending", detail: "Cancel this rental under my accepted terms", cancellationKindAtRequest: "no_refund", cancellationTermsVersion: "2026-11-v22", createdAt: Date.UTC(2029, 0, 2) }];
    await client.evaluate(`window.setRequests(${JSON.stringify(pendingCancel)})`);
    await waitFor('!!document.querySelector("[data-testid=approve-request-cancel-pending-cancel]")');
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-cancel]")'), false, "a pending renter cancellation blocks the overlapping generic cancel path");
    await approve("cancel", "pending-cancel");
    await waitFor('window.fixtureActionCalls.length===3 && !document.querySelector("[data-testid=rental-action-cancel]")');
    assert.equal(await client.evaluate('window.fixtureActionCalls[2].ref'), "rentalRequests.approveAndApply", "cancellation approval also uses the same guarded apply endpoint");
    assert.equal(await client.evaluate('window.fixtureActionCalls[2].args.id'), "pending-cancel");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=approved-cancel-apply]")'), false, "a completed cancellation has no extra admin apply click");
    await client.evaluate('window.fixtureBooking.status="confirmed";window.setRequests([])');

    const approvedDate = [{ _id: "date-request", kind: "dates", status: "approved", detail: "Move the rental dates", decisionNote: "Approved", requestedStart: Date.UTC(2030, 0, 3), requestedEnd: Date.UTC(2030, 0, 4), createdAt: Date.UTC(2029, 0, 1) }];
    await client.evaluate(`window.setRequests(${JSON.stringify(approvedDate)})`);
    await waitFor('!!document.querySelector("[data-testid=approved-date-apply]")');
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-reschedule]")'), false, "approved dates have one execution control");
    assert.equal(await client.evaluate('document.querySelector("[data-testid=rental-action-cancel]")?.disabled'), true, "direct cancellation stays visible but disabled until the approved date request is applied");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-return-time]")'), false, "handover edits cannot overlap an unresolved date request");

    const approvedCancellation = [{ _id: "cancel-request", kind: "cancel", status: "approved", detail: "Cancel the rental", decisionNote: "Approved", createdAt: Date.UTC(2029, 0, 2) }];
    await client.evaluate(`window.setRequests(${JSON.stringify(approvedCancellation)})`);
    await waitFor('!!document.querySelector("[data-testid=approved-cancel-apply]")');
    await waitFor('!document.querySelector("[data-testid=rental-action-cancel]")');
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-cancel]")'), false, "approved cancellation has one execution control");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-reschedule]")'), false, "direct date changes cannot overlap an unresolved cancellation request");

    await client.evaluate(`window.setRequests(${JSON.stringify([{ ...approvedDate[0], execution: { status: "applied" } }])})`);
    await waitFor('!!document.querySelector("[data-testid=rental-action-reschedule]")');
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=approved-date-apply]")'), false, "completed request does not keep the generic action hidden");
    const pendingHandover = [{ _id: "pending-handover", requestId: "handover-fixture-request-001", kind: "handover", status: "pending", detail: "Move the return to 19:00", requestedHandover: { lineIndexes: [0], kind: "return", time: "19:00" }, requestedSnapshot: "fixture-snapshot", createdAt: Date.UTC(2029, 0, 3) }];
    await client.evaluate(`window.setRequests(${JSON.stringify(pendingHandover)})`);
    await waitFor('!!document.querySelector("[data-testid=approve-request-handover-pending-handover]") && !document.querySelector("[data-testid=rental-action-return-time]") && !document.querySelector("[data-testid=rental-action-pickup-time]")');
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-return-time]")'), false, "pending renter handover hides direct admin time changes");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-pickup-time]")'), false, "pending renter handover also hides the direct pickup-time change");
    const approvedHandover = [{ ...pendingHandover[0], status: "approved" }];
    await client.evaluate(`window.setRequests(${JSON.stringify(approvedHandover)})`);
    await waitFor('!!document.querySelector("[data-testid=approved-handover-apply]")');
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-return-time]")'), false, "approved but unapplied renter handover keeps direct return-time change hidden");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-pickup-time]")'), false, "approved but unapplied renter handover keeps direct pickup-time change hidden");
    const processingHandover = [{ ...pendingHandover[0], status: "approved", execution: { operation: "handover", status: "processing" } }];
    await client.evaluate(`window.setRequests(${JSON.stringify(processingHandover)})`);
    await waitFor('[...document.querySelectorAll("[data-status]")].some(node=>node.textContent.includes("Settlement processing"))');
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-return-time]")'), false, "processing renter handover keeps direct return-time change hidden");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-action-pickup-time]")'), false, "processing renter handover keeps direct pickup-time change hidden");
    await client.evaluate(`window.setRequests(${JSON.stringify(pendingHandover)})`);
    await waitFor('!!document.querySelector("[data-testid=approve-request-handover-pending-handover]")');
    await approve("handover", "pending-handover");
    await waitFor('window.fixtureActionCalls.length===4 && !!document.querySelector("[data-testid=rental-action-return-time]") && !!document.querySelector("[data-testid=rental-action-pickup-time]")');
    assert.equal(await client.evaluate('window.fixtureActionCalls[3].args.id'), "pending-handover", "the approved renter time request remains the only time-change path");
    assert.equal(await client.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "control groups fit the synthetic viewport");
    console.log("PASS rejected Didit rentals expose only the protected cancellation path; renter-request blockers keep overlapping admin edits hidden, and approved changes expose recovery. Synthetic admin rental only.");
  } finally {
    if (client) client.close();
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    await new Promise(resolve => server.close(resolve));
    await wait(200);
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
