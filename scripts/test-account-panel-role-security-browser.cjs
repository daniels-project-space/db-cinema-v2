/** Synthetic browser and local Convex authorization regression for renter/admin account separation. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const esbuild = require("esbuild");
const { ConvexHttpClient } = require("convex/browser");
const { makeFunctionReference } = require("convex/server");

const root = path.resolve(__dirname, "..");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const idempotent = fn => { let called = false; return async (...args) => { if (called) return; called = true; return fn(...args); }; };

async function browserRoleCheck() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-account-role-browser-"));
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { RentalConversation } from './src/components/rentals/RentalConversation';
    import { RenterChat } from './src/components/RenterChat';
    import { SavedCardCharges } from './src/components/rentals/SavedCardCharges';
    const adminMode = new URLSearchParams(location.search).has('admin');
    if (adminMode) {
      createRoot(document.getElementById('root')).render(<SavedCardCharges token="synthetic-admin" bookingId="booking-target" admin/>);
    } else if (new URLSearchParams(location.search).has('identity')) {
      createRoot(document.getElementById('root')).render(<RentalConversation
        token="synthetic-renter-session" bookingId="booking-renter" title="Sony FX3 camera" stage="pending_verification" renterWorkspace
        workspaceIdentity={{name:'Synthetic leaked admin identity',phone:'+447700900000',privatePortrait:<span data-private-portrait>private portrait</span>,verified:true,membershipLabel:'Pro',encoreLabel:'Encore III'}}
        onStar={()=>window.__starCalls.push('starred')} bookingSummary={{dates:'2 Jan 2030 – 4 Jan 2030',count:1,items:[{title:'Sony FX3 camera',qty:1,imageSources:['/synthetic-camera.jpg']}]}}
      />);
    } else {
      createRoot(document.getElementById('root')).render(<RenterChat focusBookingId="booking-renter"/>);
    }
  `;
  const fixtureData = `
    const renterBooking = {_id:'booking-renter',status:'pending_verification',idVerifyStatus:'manual_review',verificationProvider:'didit',diditSessionId:'synthetic-didit-session',verificationNote:'Synthetic review case',verificationChecks:{identity:'approved',selfie:'review',address:'waiting'},securityPolicyVersion:'2026-11-immediate-claim-v2',savedCardStatus:'saved',savedCardLimit:100,savedCardChargePaidPence:1200,savedCardChargeReservedPence:0,depositAmount:0,depositRefundAmount:0,fulfilment:'pickup',lineItems:[]};
    const adminBooking = {...renterBooking,_id:'booking-target',status:'confirmed',actualReturnedAt:Date.UTC(2030,0,4),savedCardDamageAssessed:25,lateFeeAmount:0};
    const fixtureCharge = (id,state,extra={})=>({id,kind:'damage',claimBasis:'severe_cosmetic_damage',amount:12,reason:'Synthetic itemised fixture assessment',state,paid:12,createdAt:Date.UTC(2030,0,4),noticeAt:Date.UTC(2030,0,4),collectAfter:Date.UTC(2030,0,11),disputeReason:null,disputeResolution:null,disputeResolvedAt:null,refunded:0,refundStatus:null,refundReason:null,error:null,...extra});
    const renterCharges = {depositPaid:0,depositRetained:0,depositRefunded:0,remaining:88,limit:100,used:12,paid:12,reserved:0,cardStatus:'saved',damageAssessed:25,lateAssessed:0,returnedAt:adminBooking.actualReturnedAt,securityPolicyVersion:'2026-11-immediate-claim-v2',rows:[fixtureCharge('charge-paid','paid'),fixtureCharge('charge-bank','requires_action'),fixtureCharge('charge-uncertain','uncertain')]};
    const adminCharges = {...renterCharges,rows:[fixtureCharge('charge-paid','paid',{paid:12}),fixtureCharge('charge-bank','requires_action'),fixtureCharge('charge-uncertain','uncertain')]};
    const bookingView = {_id:'booking-renter',status:'confirmed',start:Date.UTC(2030,0,2),end:Date.UTC(2030,0,4),items:[{title:'Sony FX3 camera',qty:1,heroImage:'/synthetic-camera.jpg',imageSources:['/synthetic-camera.jpg']}],handoverDetails:null,escalated:false,unreadRenter:0};
    const requestContext = {status:'confirmed',actionReady:true,locked:false,cancellationKind:'full_refund',cancellationTermsVersion:'2026-11-v21',cancellationFullRefundDays:7,direct:false,items:[{index:0,title:'Sony FX3 camera',qty:1,heroImage:'/synthetic-camera.jpg',imageSources:['/synthetic-camera.jpg']}],paymentsEnabled:true};
  `;
  const plugin = { name: "account-role-synthetic-fixture", setup(build) {
    build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|next\/link|@stripe\/stripe-js|@\/components\/SmartImage|@\/components\/account\/BookingReview|@\/lib\/pricing|@\/lib\/rentalPresentation|@\/lib\/chatImageCopy|@\/lib\/dates|\.\/account\/AccountProvider|\.\/(RentalAdditionApproval|RentalPricePanel|RentalCreditOffer|RentalExtensionPanel|RentalVerificationSummary|RentalDeliveryQuoteApproval|AttachmentAdminControls|RentalSwapApproval|HumanHandoffOffer|GafferExtensionOfferCard|ChatIdentity|VerificationProgress|useVerificationRefresh|RentalRequestHistory))$/ }, args => ({ path: args.path, namespace: "role-fixture" }));
    build.onLoad({ filter: /.*/, namespace: "role-fixture" }, args => {
      const module = (loader, contents) => ({ loader, contents, resolveDir: root });
      if (args.path === "convex/react") return module("jsx", `${fixtureData}
        export const useQuery=(ref,args)=>{if(args==='skip')return undefined;if(ref==='rentalChat.messages')return {page:[{_id:'message-fixture',sender:'renter',text:'Synthetic renter question',at:Date.UTC(2030,0,1),meta:{}}],isDone:true,continueCursor:'',escalated:false,replyState:{awaitingTeam:false,awaitingReply:false}};if(ref==='rentalChat.getConversation')return bookingView;if(ref==='rentalChat.unreadBreakdown')return {general:0};if(ref==='rentalRequests.context')return requestContext;if(ref==='cancellationRecovery.renterStatus')return null;if(ref==='rentalRequests.history')return [];if(ref==='bookings.verificationProgress')return renterBooking;if(ref==='rentalOperations.details')return adminBooking;if(ref==='securityChargeState.list')return args?.admin?adminCharges:renterCharges;return null;};
        export const usePaginatedQuery=()=>({results:[bookingView],status:'Exhausted',loadMore:()=>{}});
        export const useMutation=ref=>async args=>{window.__mutationCalls.push({ref,args});return {status:'synthetic-only'};};
        export const useAction=ref=>async args=>{window.__actionCalls.push({ref,args});return ref==='chatAttachments.availability'?true:{status:'synthetic-only'};};
        export const useConvex=()=>({query:async()=>({synthetic:true})});
      `);
      if (args.path.endsWith("_generated/api")) return module("js", `export const api=new Proxy({}, {get:(_,group)=>new Proxy({}, {get:(_,method)=>String(group)+'.'+String(method)})});`);
      if (args.path === "next/link") return module("jsx", `import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`);
      if (args.path === "@stripe/stripe-js") return module("js", `export const loadStripe=async()=>null;`);
      if (args.path === "@/components/SmartImage") return module("jsx", `import React from 'react';export const SmartImage=props=><img {...props}/>;`);
      if (args.path === "@/lib/pricing") return module("js", `export const formatGbp=value=>'£'+Number(value||0).toFixed(2);`);
      if (args.path === "@/lib/rentalPresentation") return module("js", `export const rentalTitle=value=>value;export const rentalDate=(start,end)=>'2 Jan 2030 – 4 Jan 2030';export const RENTAL_STAGE_LABELS={pending_verification:'Verification in progress',confirmed:'Confirmed'};`);
      if (args.path === "@/lib/chatImageCopy") return module("js", `export const createCleanChatImage=async()=>null;`);
      if (args.path === "@/components/account/BookingReview") return module("jsx", `import React from 'react';export const BookingReview=()=>null;`);
      if (args.path === "@/lib/dates") return module("js", `export const dayMs=value=>new Date(value).getTime();`);
      if (args.path === "./account/AccountProvider") return module("js", `export const useAccount=()=>({token:'synthetic-renter-session'});`);
      if (args.path === "./ChatIdentity") return module("jsx", `import React from 'react';export const ChatAvatar=()=> <span aria-hidden="true">Avatar</span>;export const GafferIcon=()=> <span aria-hidden="true">Gaffer</span>;`);
      if (args.path === "./VerificationProgress") return module("jsx", `import React from 'react';export const VerificationBar=()=> <div>Verification progress</div>;`);
      if (args.path === "./useVerificationRefresh") return module("js", `export const useVerificationRefresh=()=>null;`);
      if (args.path === "./RentalRequestHistory") return module("jsx", `import React from 'react';export const RentalRequestHistory=()=> <div>Request history</div>;`);
      return module("jsx", `import React from 'react';export const RentalAdditionApproval=()=>null, RentalPricePanel=()=>null, RentalCreditOffer=()=>null, BookingReview=()=>null, RentalExtensionPanel=()=>null, RentalVerificationSummary=()=> <a href="/account/verification/booking-renter">Open verification and uploads ↗</a>, RentalDeliveryQuoteApproval=()=>null, AttachmentAdminControls=()=>null, RentalSwapApproval=()=>null, HumanHandoffOffer=()=>null, GafferExtensionOfferCard=()=>null;`);
    });
  }};
  let browser, client, server;
  try {
    const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: "tsx" }, outfile: path.join(directory, "fixture.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [plugin] });
    server = http.createServer((request, response) => {
      if (request.url === "/fixture.js") { response.setHeader("content-type", "text/javascript"); return response.end(fs.readFileSync(path.join(directory, "fixture.js"))); }
      response.setHeader("content-type", "text/html"); response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main><script>window.__mutationCalls=[];window.__actionCalls=[];window.__starCalls=[];window.__errors=[];window.addEventListener("error",e=>window.__errors.push(String(e.error||e.message)))</script><script src="/fixture.js"></script>');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const profile = path.join(directory, "chrome"); browser = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "Synthetic headless browser starts"); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    const helper = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
    const connect = new Function("require", helper.slice(0, helper.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
    client = await connect(); await client.cmd("Page.enable"); await client.cmd("Runtime.enable");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    await wait(250);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-role="renter"]')`); attempt++) await wait(50);
    const renter = await client.evaluate(`({role:document.querySelector('[data-role]')?.getAttribute('data-role'),body:document.body.innerText,labels:[...document.querySelectorAll('button,a,summary')].map(node=>({text:(node.innerText||'').trim(),label:node.getAttribute('aria-label'),href:node.getAttribute('href')})),errors:window.__errors})`);
    assert.equal(renter.role, "renter", "the real renter chat route mounts its rental conversation");
    assert.deepEqual(renter.errors, [], "renter chat components render without browser errors");
    assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Rental management controls"], [aria-label="Conversation actions"], [aria-label="Star customer"], [data-private-portrait]')`), false, "admin chat menu, management aside, star control and private portrait are absent");
    assert.equal(await client.evaluate(`!!document.querySelector('a[href^="https://business.didit.me"]')`), false, "renter cannot see the admin Didit case link");
    assert.equal(await client.evaluate(`!!document.querySelector('a[href^="/account/verification/"]')`), true, "renter still has their own verification/upload route");
    assert.equal(await client.evaluate(`!!document.querySelector('textarea[aria-label="Message"]')`), true, "renter retains the chat composer");
    assert.equal(await client.evaluate(`!!document.querySelector('button[aria-label^="Attach an image"]:not(:disabled)')`), true, "renter retains image attachment control when the synthetic service is available");
    for (const text of ["Reschedule", "Request kit change", "Cancel · refund options"]) assert(renter.body.includes(text), `real RenterChat shows its renter request action: ${text}`);
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('button')].find(node=>node.textContent.includes('Review and approve £12.00 with your bank'))`), true, "renter retains their bank authentication action");
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('summary')].find(node=>node.textContent.includes('Raise a concern about this assessment'))`), true, "renter retains their dispute path");
    for (const text of ["Prepare an itemised assessment", "Refund this payment to the original card", "Reconcile bank status", "Match an existing Stripe payment", "Download consent & evidence", "Restrict account", "Restore access", "Admin-only customer notes", "Account management", "Account details", "Verification needs review", "Possible identity match", "View private archive"]) {
      assert.equal(renter.body.includes(text), false, `renter DOM excludes admin-only control: ${text}`);
    }
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?identity=1` }); await wait(180);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[data-role="renter"]')`); attempt++) await wait(50);
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="admin-chat-profile-name"], [data-testid="admin-chat-phone"], a[href="tel:+447700900000"], [aria-label="Star customer"], [data-private-portrait]')`), false, "RentalConversation discards an injected admin identity, phone, private portrait and star callback in renter mode");
    assert.equal(await client.evaluate(`document.body.innerText.includes('Synthetic leaked admin identity')`), false, "renter does not see the injected admin profile name");
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?admin=1` }); await wait(200);
    for (let attempt = 0; attempt < 100 && !await client.evaluate(`document.body.innerText.includes('Damage & late-fee collections')`); attempt++) await wait(50);
    const adminText = await client.evaluate("document.body.innerText");
    for (const text of ["Prepare an itemised assessment", "Refund this payment to the original card", "Reconcile bank status", "Match an existing Stripe payment", "Download consent & evidence"]) assert(adminText.includes(text), `admin positive control renders ${text}`);
    console.log("PASS synthetic browser role separation: renter chat, verification route, renter card approval/dispute, and admin-only payment controls.");
  } finally {
    if (client) client.close();
    if (browser && browser.exitCode === null) { const done = new Promise(resolve => browser.once("exit", resolve)); browser.kill(); await done; }
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function backendRoleCheck() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-account-role-convex-"));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CONVEX_AGENT_MODE: "anonymous", XDG_CONFIG_HOME: path.join(workspace, "config") };
  const cli = path.join(root, "node_modules/.bin/convex");
  let child;
  try {
    for (const name of ["convex", "shared", "src/lib"]) fs.cpSync(path.join(root, name), path.join(workspace, name), { recursive: true });
    for (const name of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(root, name), path.join(workspace, name));
    fs.symlinkSync(path.join(root, "node_modules"), path.join(workspace, "node_modules"), "dir");
    fs.writeFileSync(path.join(workspace, "convex/role_security_fixture.ts"), `
      import { mutation, query } from './_generated/server'; import { v } from 'convex/values';
      export const seed = mutation({args:{},handler:async ctx=>{
        const now=Date.now(), email='renter@example.invalid';
        const renter=await ctx.db.insert('accounts',{email,createdAt:now});
        const other=await ctx.db.insert('accounts',{email:'other@example.invalid',createdAt:now});
        const token='synthetic-renter-session'; await ctx.db.insert('sessions',{token,accountId:renter,createdAt:now,expiresAt:now+3600000});
        const fields={status:'confirmed',guestEmail:email,lineItems:[],fulfilment:'pickup',deliveryFee:0,subtotal:0,discount:0,depositAmount:0,total:0,currency:'GBP'};
        const ownedBooking=await ctx.db.insert('bookings',{...fields,accountId:renter,securityPolicyVersion:'2026-11-immediate-claim-v2',savedCardLimit:100,savedCardStatus:'saved',savedCardChargePaidPence:1200,savedCardChargeReservedPence:0});
        const otherBooking=await ctx.db.insert('bookings',{...fields,accountId:other,guestEmail:'other@example.invalid'});
        const archiveId=await ctx.db.insert('verification_archives',{bookingId:ownedBooking,accountId:renter,sessionId:'synthetic-session',email,status:'complete',attempts:0,dueAt:now,createdAt:now});
        const ownCharge=await ctx.db.insert('rental_security_charges',{bookingId:ownedBooking,accountId:renter,requestId:'synthetic-own-charge',kind:'damage',amountPence:1200,reason:'Synthetic own renter fixture',customerId:'cus_synthetic',paymentMethodId:'pm_synthetic',consentSnapshot:'synthetic',state:'paid',createdAt:now,updatedAt:now,paidPence:1200,attemptedAt:now,intentId:'pi_synthetic_own',receiptNoticeAt:now,refundReceipt:{paymentIntentId:'pi_synthetic_own',amountPence:1200,attemptedAt:now,approvalRequestId:'approval-synthetic',approvalUrl:'https://dashboard.stripe.com/test/synthetic-approval',status:'awaiting_approval'}});
        const charge=await ctx.db.insert('rental_security_charges',{bookingId:otherBooking,accountId:other,requestId:'synthetic-charge-request',kind:'damage',amountPence:1200,reason:'Synthetic fixture only',customerId:'cus_synthetic',paymentMethodId:'pm_synthetic',consentSnapshot:'synthetic',state:'paid',createdAt:now,updatedAt:now,paidPence:1200,attemptedAt:now,intentId:'pi_synthetic'});
        return {renter,other,token,ownedBooking,otherBooking,archiveId,ownCharge,charge};
      }});
      export const inspect = query({args:{accountId:v.id('accounts')},handler:async(ctx,{accountId})=>{const a=await ctx.db.get(accountId);return {blocked:!!a?.blockedAt,notes:await ctx.db.query('account_admin_notes').withIndex('by_account',q=>q.eq('accountId',accountId)).collect()};}});
      export const inspectControls = query({args:{accountId:v.id('accounts')},handler:async(ctx,{accountId})=>{const a=await ctx.db.get(accountId);const credits=await ctx.db.query('credits').collect(),issues=await ctx.db.query('credit_issues').collect();return {rentalTier:a?.adminMembershipTier??null,encoreTier:a?.adminEncoreLevel??null,credits:credits.filter(row=>String(row.accountId)===String(accountId)).length,creditIssues:issues.filter(row=>String(row.accountId)===String(accountId)).length};}});
    `);
    child = spawn(cli, ["dev", "--typecheck", "disable", "--codegen", "disable", "--tail-logs", "disable"], { cwd: workspace, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", exited = false; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; }); child.on("exit", () => { exited = true; });
    for (let attempt = 0; attempt < 180 && !output.includes("Convex functions ready!") && !exited; attempt++) await wait(1000);
    assert(output.includes("Convex functions ready!"), `isolated local Convex starts: ${output.slice(-1000)}`);
    const endpoint = output.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0];
    assert(endpoint && output.includes("[Local]"), "test refuses any non-loopback Convex deployment");
    const localConfig = fs.readFileSync(path.join(workspace, ".env.local"), "utf8"); assert(localConfig.includes(endpoint) && /CONVEX_DEPLOYMENT=anonymous:/.test(localConfig), "Convex config is isolated anonymous localhost");
    const adminToken = crypto.randomBytes(32).toString("hex"); execFileSync(cli, ["env", "set", "ADMIN_TOKEN", adminToken], { cwd: workspace, env, stdio: "pipe" });
    const client = new ConvexHttpClient(endpoint); const ref = name => makeFunctionReference(name);
    const fixture = await client.mutation(ref("role_security_fixture:seed"), {});
    assert.equal(await client.query(ref("accountAdmin:directoryAccess"), {token:adminToken}), true, "admin positive control is authorized");
    assert.equal(await client.query(ref("accountAdmin:detail"), {token:adminToken,accountId:fixture.renter}) !== null, true, "admin positive control can read its account panel");
    const renterToken = fixture.token;
    assert.equal(await client.query(ref("accountAdmin:directoryAccess"), {token:renterToken}), false, "renter session cannot enter the customer directory");
    await assert.rejects(client.query(ref("accountAdmin:detail"), {token:renterToken,accountId:fixture.renter}), "renter session cannot read admin account detail/notes");
    await assert.rejects(client.mutation(ref("accountAdmin:addNote"), {token:renterToken,accountId:fixture.renter,text:'forged internal note'}), "renter session cannot create an admin note");
    await assert.rejects(client.mutation(ref("accountAdmin:setBlocked"), {token:renterToken,accountId:fixture.renter,blocked:true,reason:'forged restriction',expected:{blockedAt:null,noticeId:null,reason:'',revision:0}}), "renter session cannot restrict an account");
    await assert.rejects(client.mutation(ref("accountAdmin:setRentalAccess"), {token:renterToken,accountId:fixture.renter,level:'pro',expectedLevel:'automatic',encoreLevel:3,expectedEncoreLevel:'automatic',reason:'forged membership change'}), "renter session cannot change membership or Encore access");
    await assert.rejects(client.mutation(ref("accountCredits:grantAdmin"), {token:renterToken,accountId:fixture.renter,amount:12.5,requestId:'renter-forged-credit-0001',expectedRevision:0,reason:'forged credit grant'}), "renter session cannot grant account credit");
    await assert.rejects(client.query(ref("accountCredits:adminHistory"), {token:renterToken,accountId:fixture.renter}), "renter session cannot read admin credit history");
    await assert.rejects(client.action(ref("checkout:adminBillingPortal"), {token:renterToken,accountId:fixture.renter}), "renter session cannot open the Stripe billing portal");
    await assert.rejects(client.action(ref("checkout:adminRefreshMembership"), {token:renterToken,accountId:fixture.renter}), "renter session cannot refresh Stripe membership");
    await assert.rejects(client.action(ref("rentalDelivery:createQuote"), {token:renterToken,bookingId:fixture.ownedBooking,requestId:'renter-forged-delivery-0001',deliveryLegs:'one_way',deliveryAddress:'10 Downing Street, London SW1A 2AA'}), "renter session cannot create an admin delivery quote");
    assert.deepEqual(await client.query(ref("role_security_fixture:inspect"), {accountId:fixture.renter}), {blocked:false,notes:[]}, "forged restriction and note attempts made no changes");
    assert.deepEqual(await client.query(ref("role_security_fixture:inspectControls"), {accountId:fixture.renter}), {rentalTier:null,encoreTier:null,credits:0,creditIssues:0}, "forged membership, credit and payment-console attempts made no account or balance changes");
    assert.deepEqual(await client.query(ref("accountAdmin:possibleRestrictedIdentityMatches"), {token:renterToken,bookingId:fixture.ownedBooking}), {matches:[],more:false}, "renter token receives no restricted-account match data");
    await assert.rejects(client.query(ref("verificationArchive:accountDocuments"), {token:renterToken,accountId:fixture.renter}), "renter session cannot list archived IDs");
    await assert.rejects(client.mutation(ref("verificationArchive:retry"), {token:renterToken,archiveId:fixture.archiveId}), "renter session cannot invoke archive retry mutation");
    await assert.rejects(client.mutation(ref("securityChargeState:prepare"), {token:renterToken,bookingId:fixture.ownedBooking,requestId:'synthetic-forged-claim-1234',kind:'damage',amount:12,reason:'forged itemised claim from renter'}), "renter session cannot create an admin assessment");
    const ownPaymentView=await client.query(ref("securityChargeState:list"),{token:renterToken,bookingId:fixture.ownedBooking});
    assert.equal(ownPaymentView.rows[0].refundApprovalUrl,undefined,"renter's own payment history omits the private Stripe approval URL");
    assert.equal(ownPaymentView.rows[0].receiptNoticeAt,undefined,"renter's own payment history omits admin email operational metadata");
    const adminPaymentView=await client.query(ref("securityChargeState:list"),{token:adminToken,bookingId:fixture.ownedBooking,admin:true});
    assert.equal(adminPaymentView.rows[0].refundApprovalUrl,'https://dashboard.stripe.com/test/synthetic-approval',"admin payment view retains its Stripe approval link");
    assert.equal(await client.query(ref("securityChargeState:list"), {token:renterToken,bookingId:fixture.otherBooking,admin:true}), null, "renter cannot request admin payment projection");
    await assert.rejects(client.query(ref("securityChargeState:list"), {token:renterToken,bookingId:fixture.otherBooking}), "renter cannot read another account's payment history");
    assert.equal(await client.query(ref("rentalChat:messages"), {token:renterToken,bookingId:fixture.otherBooking,admin:true,paginationOpts:{numItems:10,cursor:null}}), null, "renter token cannot impersonate admin chat access");
    await assert.rejects(client.query(ref("rentalChat:messages"), {token:renterToken,bookingId:fixture.otherBooking,paginationOpts:{numItems:10,cursor:null}}), "renter cannot read another account's conversation");
    for (const [name,args] of [
      ["securityCharges:collect",{token:renterToken,id:fixture.charge}],
      ["securityCharges:refundPayment",{token:renterToken,id:fixture.charge,reason:'forged refund'}],
      ["securityCharges:reconcileReference",{token:renterToken,id:fixture.charge,paymentIntentId:'pi_synthetic'}],
    ]) await assert.rejects(client.action(ref(name),args), `renter session cannot call ${name}`);
    const final = await client.query(ref("role_security_fixture:inspect"), {accountId:fixture.renter}); assert.deepEqual(final,{blocked:false,notes:[]},"all denied admin attempts left synthetic account unchanged");
    console.log("PASS isolated Convex renter-token denials and field filtering: account detail/notes/restriction, membership and Encore changes, credit grants/history, Stripe portal/refresh, delivery quotes, identity matches, archived documents, cross-account rental/chat/payment reads, Stripe approval metadata, assessment, collection, refund and reconciliation. Synthetic localhost only.");
  } finally {
    if (child?.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      for (let attempt=0;attempt<50&&child.exitCode===null&&child.signalCode===null;attempt++) await wait(100);
      try { process.kill(-child.pid,"SIGKILL"); } catch (error) { if(error.code!=="ESRCH") throw error; }
    }
    fs.rmSync(workspace,{recursive:true,force:true});
  }
}

(async()=>{await browserRoleCheck();await backendRoleCheck();})().catch(error=>{console.error(error);process.exitCode=1;});
