const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");

const root = path.resolve(__dirname, "..");
const connectSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", connectSource.slice(0, connectSource.indexOf("const { ConvexHttpClient }")) + "\nreturn connect;")(require);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const accounts = [
  { id: "account-jordan", email: "jordan@example.invalid", name: "Jordan Blake", tier: "pro", override: "automatic", encoreOverride: "3", blocked: false, blockedReason: "", hasSubscription: true, subscriptionTier: "pro", verified: true, verifiedUntil: Date.UTC(2030, 1, 1), avatarUrl: "/synthetic-avatar.png", visualTier: "subscriber" },
  { id: "account-riley", email: "riley@example.invalid", name: "Riley Chen", tier: "standard", override: "automatic", encoreOverride: "automatic", blocked: false, blockedReason: "", hasSubscription: false, subscriptionTier: null, verified: false, avatarUrl: null, visualTier: "guest" },
  { id: "account-casey", email: "casey@example.invalid", name: "Casey Morgan", tier: "standard", override: "automatic", encoreOverride: "1", blocked: false, blockedReason: "", hasSubscription: false, subscriptionTier: null, verified: true, verifiedUntil: Date.UTC(2030, 1, 1), avatarUrl: null, visualTier: "encore" },
  { id: "account-taylor", email: "taylor@example.invalid", name: "Taylor Reed", tier: "standard", override: "automatic", encoreOverride: "automatic", blocked: false, blockedReason: "", hasSubscription: false, subscriptionTier: null, verified: false, avatarUrl: null, visualTier: "guest" },
  { id: "account-alex", email: "alex@example.invalid", name: "Alex Park", tier: "standard", override: "automatic", encoreOverride: "automatic", blocked: false, blockedReason: "", hasSubscription: false, subscriptionTier: null, verified: true, verifiedUntil: Date.UTC(2030, 1, 1), avatarUrl: null, visualTier: "guest" },
];
const rentals = [
  { id: "booking-camera", status: "confirmed", total: 180, title: "Sony FX3 camera", start: Date.UTC(2030, 0, 2), end: Date.UTC(2030, 0, 4), imageSources: [], quantity: 3, items: [{title:"Sony FX3 camera",qty:1,imageSources:[]},{title:"Sony 24–70mm lens",qty:2,imageSources:[]}] },
  { id: "booking-lens", status: "returned", total: 80, title: "Sony 24–70mm lens", start: Date.UTC(2029, 11, 20), end: Date.UTC(2029, 11, 22), imageSources: [], quantity: 1 },
  { id: "booking-review", status: "pending_verification", idVerifyStatus: "manual_review", verificationProvider: "didit", total: 45, title: "Verification case", start: Date.UTC(2030, 0, 5), end: Date.UTC(2030, 0, 6), imageSources: [], quantity: 1 },
];
const conversations = [
  { id: "thread-support", bookingId: null, lastMessage: "Can you help with my next shoot?", updatedAt: Date.UTC(2029, 11, 28), unread: 2 },
  { id: "thread-camera", bookingId: "booking-camera", lastMessage: "I need to extend by one day.", updatedAt: Date.UTC(2029, 11, 27), unread: 1 },
  { id: "thread-lens", bookingId: "booking-lens", lastMessage: "Thanks, everything arrived safely.", updatedAt: Date.UTC(2029, 11, 22), unread: 0 },
  { id: "thread-review", bookingId: "booking-review", lastMessage: "Please check my verification.", updatedAt: Date.UTC(2029, 11, 29), unread: 0 },
];

function detail(accountId) {
  const account = accounts.find(row => row.id === accountId) ?? accounts[0];
  return {
    id: account.id, phone: "+44 7700 900123", address: null, createdAt: Date.UTC(2029, 1, 1),
    membershipStatus: account.hasSubscription ? "active" : null, membershipActive: account.hasSubscription,
    paidThrough: account.hasSubscription ? Date.UTC(2030, 1, 1) : null, cancelAtPeriodEnd: false,
    verificationExpiresAt: account.verified ? Date.UTC(2030, 1, 1) : null,
    credit: 12, refundCredit: 5, rentals: account.id === accounts[0].id ? rentals : [], rentalsMore: false,
    conversations: account.id === accounts[0].id ? conversations : [], notes: [],
  };
}

const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AccountAdmin} from './src/components/admin/AccountAdmin';
import {AccountDocuments as RealDocuments} from './src/components/admin/AccountDocuments';
import {AccountCreditPanel as RealCreditPanel} from './src/components/admin/AccountCreditPanel';
import {ManagementShell} from './src/components/management/ManagementShell';
import {RentalConversation} from './src/components/rentals/RentalConversation';
import {RenterChat} from './src/components/RenterChat';
window.__mutationCalls=[]; window.__lastDirectoryArgs=null; window.__lastSearchArgs=null; window.addEventListener('dbc:request-renter-notification-status',()=>window.dispatchEvent(new CustomEvent('dbc:renter-notification-status',{detail:location.search.includes('notifications-active=1')?'active':'inactive'})));
window.__archives=location.search.includes('retention-review=1')?[{_id:'archive-fixture',bookingId:'booking-fixture',status:'complete',source:'didit',retention:{viewable:false,needsReview:true,expiresAt:null,activeRentals:0,openCases:0,status:'unknown-closure',reviewDetails:{kind:'case-chronology',bookingId:'linked-booking-fixture',caseId:'case-fixture',openedAt:1700000000000,closedAt:null}},documents:[{id:'document-fixture',kind:'id_front',contentType:'image/jpeg',size:2048,savedAt:Date.now(),available:false}],copiesReady:false,readProofExpiresAt:null}]:[{_id:'archive-fixture',bookingId:'booking-fixture',status:'complete',source:'didit',retentionHoldReason:'Open insurance claim',retentionHoldRevision:7,retention:{viewable:true,expiresAt:null,activeRentals:0,openCases:0,status:'manual-hold'},documents:[],copiesReady:false,readProofExpiresAt:null}];
const renter = location.search.includes('renter=');
createRoot(document.getElementById('root')).render(location.search.includes('credit=1') ? <RealCreditPanel token="synthetic-admin" accountId="account-jordan"/> : location.search.includes('documents=1') ? <RealDocuments token="synthetic-admin" accountId="account-jordan" onRental={id=>window.__investigateRental=id}/> : renter ? <ManagementShell role="renter" title="Messages" name="Jordan Blake" active="chat" nav={[{key:'rentals',label:'My rentals'},{key:'chat',label:'Messages'}]} onNavigate={key=>window.__navigation=key}>{location.search.includes('renter=2') ? <RentalConversation token="synthetic-renter" title="Account support" stage="Support" renterWorkspace workspaceIdentity={{name:'Private customer',privatePortrait:<span data-private-portrait/>}} onStar={()=>{}} /> : <div id="renter-chat" className="tab-in mt-6"><RenterChat focusBookingId="general"/></div>}</ManagementShell> : <ManagementShell role="admin" title="Customers & members" name="DB Cinema team" active="accounts" nav={[{key:'overview',label:'Dashboard',icon:'dashboard'},{key:'bookings',label:'Rentals',icon:'rentals'},{key:'accounts',label:'Customers & members',icon:'people'},{key:'inbox',label:'Messages',icon:'messages'}]} onNavigate={key=>window.__navigation=key} actions={<><button aria-label="Notifications">◌</button><button>Lock</button></>}><AccountAdmin token="synthetic-admin" onConversation={(accountId,bookingId)=>window.__openedFullInbox={accountId,bookingId}}/></ManagementShell>);
`;
const mocks = {
  name: "customer-workspace-synthetic-data",
  setup(build) {
    build.onResolve({ filter: /^(next\/(link|image)|convex\/react|@cvx\/_generated\/api|\.\/account\/AccountProvider|\.\/AccountDocuments|\.\.\/account\/AccountCreditReceipts|@\/components\/admin\/AccountCreditPanel|@\/components\/admin\/CustomerInvite|@\/components\/management\/AdminInvoiceLibrary|@\/components\/account\/BookingReview|\.\/(RentalAdditionApproval|RentalPricePanel|RentalExtensionPanel|SavedCardCharges|RentalVerificationSummary|RentalDeliveryQuoteApproval))$/ }, args => ({ path: args.path, namespace: "customer-fixture" }));
    build.onLoad({ filter: /.*/, namespace: "customer-fixture" }, args => {
      if (args.path === "next/link") return { loader: "jsx", resolveDir: root, contents: `import React from 'react'; export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}` };
      if (args.path === "next/image") return { loader: "jsx", resolveDir: root, contents: `import React from 'react';export default function Image(props){return <img {...props}/>} ` };
      if (args.path === "./account/AccountProvider") return { loader: "js", contents: `export const useAccount=()=>({token:'synthetic-renter'});` };
      if (args.path === "convex/react") return { loader: "jsx", contents: `
        export const useQuery=(ref,args)=>{
          if(args==='skip')return undefined;
          if(ref==='chatAttachments.availability')return true;
          if(ref==='privateVerificationPortrait.availability')return true;
          if(ref==='verificationArchive.accountDocuments')return window.__archives;
          if(ref==='accountAdmin.directoryAccess')return true;
          if(ref==='rentalOperations.details')return {_id:args.bookingId,status:args.bookingId==='booking-review'?'pending_verification':'confirmed',lineItems:[{title:'Sony FX3 camera',listingId:'listing-camera',qty:1,start:Date.UTC(2030,0,2),end:Date.UTC(2030,0,4),lineTotal:180}],rentalRefunds:[],fulfilment:'pickup',guestName:'Jordan Blake',guestEmail:'jordan@example.invalid',idVerifyStatus:args.bookingId==='booking-review'?'manual_review':'verified',verificationProvider:'didit',verificationNote:args.bookingId==='booking-review'?'A required check did not pass.':undefined,diditSessionId:'synthetic-session',total:180,depositAmount:0,cancellationKind:'full_refund',stripePaymentIntentId:'pi_synthetic',controlsSnapshot:'synthetic-snapshot'};
          if(ref==='accountAdmin.searchMessages'){window.__lastSearchArgs=args;return {items:[],truncated:false};}
          if(ref==='accountAdmin.detail')return window.__details[args.accountId]??null;
          if(ref==='membershipInvoiceReviews.adminList')return args.accountId==='account-jordan'?[{invoiceId:'in_synthetic',reason:'price_snapshot',createdAt:Date.UTC(2030,0,1),retryAt:null}]:[];
          if(ref==='membershipRefundJobs.adminList')return args.accountId==='account-jordan'?[{invoiceId:'in_synthetic',refundId:'re_synthetic',updatedAt:Date.UTC(2030,0,1)}]:[];
          if(ref==='accountAdmin.verificationReviews')return {items:(window.__details[args.accountId]?.rentals??[]).filter(rental=>rental.verificationProvider==='didit'&&rental.idVerifyStatus==='manual_review'&&['pending_verification','confirmed','active'].includes(rental.status)),more:false};
          if(ref==='accountAdmin.possibleRestrictedIdentityMatches')return {matches:args.bookingId==='booking-camera'?[{id:'restricted-fixture',name:'Restricted fixture',email:'restricted@example.invalid',blockedReason:'Prior issue'}]:[],more:false};
          if(ref==='accountAdmin.history')return [];
          if(ref==='accountCredits.grantStatus')return {revision:0,pending:null};
          if(ref==='accountAdmin.directoryMetrics')return args.accountIds.map(id=>({id,activeRentals:id==='account-jordan'?1:0,activeRentalsMore:false,credit:12,unreadMessages:id==='account-jordan'?3:id==='account-riley'?1:0,lastMessage:({'account-jordan':'Can you confirm the camera kit?','account-riley':"Thanks! I will extend the rental through Friday.",'account-casey':'Do you have a matte box in stock?','account-taylor':'Great — confirmed for pickup at 9 AM.','account-alex':'What are the rental options for the new camera body?'})[id]??null,visualTier:id==='account-jordan'?'subscriber':id==='account-riley'?'encore2':'guest',encoreLevel:id==='account-riley'?2:id==='account-taylor'?null:0}));
          if(ref==='rentalChat.messages'){
            window.__rentalTargets.push({accountId:args.accountId??null,bookingId:args.bookingId??null});
            return {notificationScope:args.admin?null:"fixture-renter-account",page:[...(location.search.includes('catalogue=1')?[{_id:'gaffer-catalogue',sender:'bot',text:'Here is an FX3 option.',meta:{catalogueItems:[{title:'Sony FX3 camera',slug:'sony-fx3',category:'Cameras',daily:48,days:2,perDay:44,total:88,availability:'available',dates:'2030-01-02 → 2030-01-04'}]},at:Date.UTC(2029,11,28)+1000}]:[]),...(location.search.includes('handoff=1')?[{_id:'gaffer-offer',sender:'bot',text:'I can ask the team to help.',meta:{offerHuman:true},at:Date.UTC(2029,11,28)+2000}]:[]),...(location.search.includes('stale=1')?[{_id:'new-renter-message',sender:'renter',text:'Another question',at:Date.UTC(2029,11,28)+3000}]:[]),...(location.search.includes('reply=1')?[{_id:location.search.includes('other=1')?'other-reply':'gaffer-first-answer',sender:'bot',text:'Yes, I can help with that.',at:Date.UTC(2029,11,28)+1000}]:[]),{_id:'message-'+(args.bookingId??'support'),accountId:args.accountId,bookingId:args.bookingId??null,sender:'renter',text:'Can you confirm the kit for my next shoot?',at:Date.UTC(2029,11,28)}],isDone:true,continueCursor:'',escalated:location.search.includes('team=1'),replyState:{awaitingTeam:true,awaitingReply:false,renterAt:Date.UTC(2029,11,28)},quickReplies:[],renter:{name:'Jordan',phone:'+44 7700 900123',photo:null}};
          }
          if(ref==='privateVerificationPortrait.selected')return args.accountId==='account-casey'?{documentId:'synthetic-private-selfie'}:null;
          return undefined;
        };
        export const usePaginatedQuery=(ref,args)=>{if(ref==='rentalChat.minePage'&&args!=='skip')return {results:[{_id:'renter-camera',status:'confirmed',start:Date.UTC(2030,0,2),end:Date.UTC(2030,0,4),items:[{title:'Sony FX3 camera',imageSources:[]}],unreadRenter:2},{_id:'renter-lens',status:'returned',start:Date.UTC(2029,11,20),end:Date.UTC(2029,11,22),items:[{title:'Sony 24–70mm lens',imageSources:[]}],unreadRenter:0}],status:'Exhausted',loadMore:()=>{}};if(args==='skip'||ref==='rentalRequests.list'||ref==='catalog.adminListListings')return {results:[],status:'Exhausted',loadMore:()=>{}};window.__lastDirectoryArgs=args;const search=(args?.search??'').toLocaleLowerCase('en-GB');const page=window.__accounts.filter(account=>!search||\`${'${account.name} ${account.email}'}\`.toLocaleLowerCase('en-GB').includes(search));return {results:page,status:'Exhausted',loadMore:()=>{}};};
        const mutate=ref=>async args=>{window.__mutationCalls.push({ref,args});if(ref==='accountAdmin.setStarred'&&window.__deferStar)return new Promise((resolve,reject)=>{window.__rejectStar=reject});if(ref==='accountAdmin.setStarred'&&window.__failStar)throw Error('Simulated failure');if(ref==='didit.refreshProgress'&&window.__rejectDiditRefresh||ref==='accountCredits.grantAdmin'&&window.__creditFail)throw Error('Simulated uncertain response');return ref==='checkout.adminBillingPortal'?{url:'https://billing.stripe.com/p/session/fixture'}:ref==='checkout.adminRetryMembershipInvoice'?{state:'review'}:ref==='checkout.adminInspectMembershipInvoice'?{invoice:{id:'in_synthetic',status:'paid',amountPaidPence:4900,currency:'gbp',createdAt:Date.UTC(2030,0,1)},receipt:{creditPence:4900,bonusPence:0,revokedPence:500,paidMembershipPence:4900,createdAt:Date.UTC(2030,0,1)}}:ref==='checkout.refundRental'?{amount:15,status:'succeeded'}:ref==='didit.refreshProgress'?{status:'unchanged'}:ref==='accountCredits.grantAdmin'?{amount:args.amount,expiresAt:Date.UTC(2030,1,1)}:{ok:true};};
        export const useMutation=mutate,useAction=mutate,useConvex=()=>({query:async()=>null});
      ` };
      if (args.path === "@cvx/_generated/api") return { loader: "js", contents: `export const api=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,name)=>String(group)+'.'+String(name)})});` };
      const mockComponents = `
        import React from 'react';
        export function AccountDocuments({onBack}){return <section><button onClick={onBack}>Back from documents</button></section>}
        export function AccountDocumentSummary({verified}){return <p>{verified?'Verification passed':'Verification pending'}</p>}
        export function SmartImage({className='',alt=''}){return <span className={className} role="img" aria-label={alt||'Renter image'} />}
        export function AccountCreditPanel(){return <section>Existing credit controls</section>}
        export function AccountCreditReceipts(){return null}
        export function CustomerInvite(){return <button type="button">Add customer</button>}
        export function AdminInvoiceLibrary(){return <section>Existing invoices</section>}
        export function RentalAdditionApproval(){return null}
        export function RentalPricePanel(){return null}
        export function RentalExtensionPanel(){return null}
        export function SavedCardCharges(){return null}
        export function BookingReview(){return null}
        export function RentalVerificationSummary(){return null}
        export function RentalDeliveryQuoteApproval(){return null}
        export function ChatAvatar({sender,name,photo}){return <span data-avatar-sender={sender} data-avatar-name={name??''} data-avatar-photo={photo??''} className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-300/15 text-xs font-semibold text-violet-200" aria-hidden="true">{sender==='owner'?'DB':name?.trim()[0]?.toUpperCase() ?? 'R'}</span>}
        export function GafferIcon(){return <span aria-hidden="true" />}
      `;
      return { loader: "jsx", resolveDir: root, contents: mockComponents };
    });
  },
};

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-customer-workspace-"));
  const bundle = await esbuild.build({ stdin: { contents: source, resolveDir: root, loader: "tsx" }, bundle: true, write: false, outdir: path.join(directory, "out"), platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_CONVEX_URL": '"https://fixture.convex.cloud"', "process.env.NEXT_PUBLIC_CONVEX_SITE_URL": '"."', "process.env": "{}" }, plugins: [mocks] });
  const globalCss = await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  const css = `${globalCss.css}\n${bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}`;
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  assert(script, "The real AccountAdmin component bundles");
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:#111;color:#eee"><main id="root"></main><script>window.__errors=[];window.addEventListener('error',event=>window.__errors.push(event.error?.stack||event.message));window.__accounts=${JSON.stringify(accounts)};window.__details=${JSON.stringify(Object.fromEntries(accounts.map(account=>[account.id,detail(account.id)])))};window.__rentalTargets=[];</script><script src="/bundle.js"></script></body></html>`;
  const server = http.createServer((request, response) => {
    if (request.url === "/admin-private-portrait" && request.method === "POST") { response.writeHead(request.headers.authorization === "Bearer synthetic-admin" ? 200 : 403, { "Content-Type": "image/png" }); response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")); return; }
    const files = { "/": ["text/html", html], "/style.css": ["text/css", css], "/bundle.js": ["text/javascript", script], "/synthetic-avatar.png": ["image/png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")], "/db-cinema-aperture-blue.png": ["image/png", fs.readFileSync(path.join(root, "public/db-cinema-aperture-blue.png"))], "/arri-deconstruct-poster.jpg": ["image/jpeg", fs.readFileSync(path.join(root, "public/arri-deconstruct-poster.jpg"))] };
    const item = files[new URL(request.url, "http://localhost").pathname]; response.writeHead(item ? 200 : 404, { "Content-Type": item?.[0] ?? "text/plain" }); response.end(item?.[1] ?? "Not found");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = path.join(directory, "chrome-profile");
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let client;
  try {
    let port; for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "Headless Chrome starts for the isolated UI fixture"); process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    client = await connect(); await client.cmd("Page.enable"); await client.cmd("Runtime.enable");
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=admin-account-action-rail]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=admin-account-action-rail]")'), true, "The real account action rail renders");
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=admin-customer-conversation-pane] [data-testid=rental-gaffer-gear-help]")'), false, "The renter-facing gear assistant shortcut stays out of the admin workspace");
    for (const width of [1500, 1100, 768, 320]) {
      await client.cmd('Emulation.setDeviceMetricsOverride', {width, height:900, deviceScaleFactor:1, mobile:width < 768}); await wait(60);
      const summaryLayout = await client.evaluate(`(()=>{const rail=document.querySelector('[data-testid="admin-account-action-rail"]');return [...rail.querySelectorAll('button')].filter(button=>button.querySelector(':scope > strong')&&button.querySelector(':scope > span > svg')).map(button=>{const label=button.querySelector(':scope > span').getBoundingClientRect(),value=button.querySelector(':scope > strong').getBoundingClientRect(),row=button.getBoundingClientRect();return {name:button.textContent,labelRight:label.right,valueLeft:value.left,valueRight:value.right,rowRight:row.right,labelHeight:label.height}})})()`);
      assert.equal(summaryLayout.length,4,`All summary controls render at ${width}px`);
      for (const row of summaryLayout) { assert(row.labelRight + 3 <= row.valueLeft && row.valueRight <= row.rowRight, `Summary label and value do not overlap at ${width}px: ${row.name}`); assert(row.labelHeight <= 20, `Summary label stays on one line at ${width}px: ${row.name}`); }
      const filterMetrics = await client.evaluate(`(()=>{const row=document.querySelector('[data-testid="admin-account-filter-actions"]');const clear=row?.querySelector('button')?.getBoundingClientRect();const verification=row?.querySelector('summary')?.getBoundingClientRect();return clear&&verification?{clearRight:clear.right,verificationLeft:verification.left,clearCenter:(clear.top+clear.bottom)/2,verificationCenter:(verification.top+verification.bottom)/2}:null})()`);
      assert(filterMetrics && filterMetrics.clearRight <= filterMetrics.verificationLeft && Math.abs(filterMetrics.clearCenter-filterMetrics.verificationCenter)<3, `Filter actions stay separated and aligned at ${width}px`);
      if(width===320){const mobileWorkspace=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-customer-workspace-local-mobile.png",Buffer.from(mobileWorkspace.data,"base64"));}
    }
    await client.cmd('Emulation.setDeviceMetricsOverride', {width:1500,height:900,deviceScaleFactor:1,mobile:false}); await wait(60);
    for (let attempt = 0; attempt < 50 && !await client.evaluate(`document.querySelector('img[src="/arri-deconstruct-poster.jpg"]')?.naturalWidth > 0`); attempt++) await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('img[src="/arri-deconstruct-poster.jpg"]')?.naturalWidth > 0`), true, "The real sidebar image loads in the visual fixture");
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-row]").length'), 5, "The populated directory renders five synthetic customers");
    for (let attempt = 0; attempt < 50 && !await client.evaluate(`document.querySelector('[data-testid="admin-account-row"] img[src="/synthetic-avatar.png"]')?.naturalWidth > 0`); attempt++) await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-account-row"] img[src="/synthetic-avatar.png"]')?.naturalWidth > 0`), true, 'A customer profile photo loads in the directory');
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope] header img[src="/synthetic-avatar.png"]')?.naturalWidth > 0`), true, 'The same profile photo loads in the selected chat header');
    const filterActionsLayout = await client.evaluate(`(()=>{const row=document.querySelector('[data-testid="admin-account-filter-actions"]');const clear=row?.querySelector('button')?.getBoundingClientRect();const verification=row?.querySelector('summary')?.getBoundingClientRect();return clear&&verification?{clearTop:clear.top,clearBottom:clear.bottom,verificationTop:verification.top,verificationBottom:verification.bottom}:null})()`);
    const workspaceScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-workspace-local-desktop.png", Buffer.from(workspaceScreenshot.data, "base64"));
    const filterActionCenterDelta = filterActionsLayout ? Math.abs((filterActionsLayout.clearTop + filterActionsLayout.clearBottom) / 2 - (filterActionsLayout.verificationTop + filterActionsLayout.verificationBottom) / 2) : Infinity;
    assert(filterActionsLayout && filterActionCenterDelta < 3, `Clear filters and verification stay aligned on one readable row; center delta ${filterActionCenterDelta}px`);
    for (let attempt = 0; attempt < 50 && !await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[2]?.querySelector('img[alt="Private verification portrait"]')?.naturalWidth > 0`); attempt++) await wait(100);
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[2]?.querySelector('img[alt="Private verification portrait"]')?.naturalWidth > 0`), true, 'A consented private portrait appears in an unselected admin directory row');
    const directoryPortraitScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-private-directory-portraits.png", Buffer.from(directoryPortraitScreenshot.data, "base64"));
    await client.evaluate(`window.__deferStar=true;document.querySelector('[aria-label="Star customer"]').click()`); await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Star customer"]').disabled`),true,'A pending favourite update cannot be submitted twice');
    await client.evaluate(`document.querySelector('[aria-label="Star customer"]').click();document.querySelectorAll('[data-testid="admin-account-row"]')[1].click()`); await wait(50);
    await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[0].click()`); await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Star customer"]').disabled`),true,'Returning to the original customer cannot duplicate a pending update');
    await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[1].click();window.__rejectStar(Error('Delayed failure'))`); await wait(100);
    assert.equal(await client.evaluate(`window.__mutationCalls.filter(call=>call.ref==='accountAdmin.setStarred').length`),1,'Rapid clicks issue one update');
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-customer-conversation-pane"]').textContent.includes('Could not confirm the favourite update')`),false,'A delayed failure cannot appear on another customer');
    await client.evaluate(`window.__deferStar=false;window.__failStar=true;document.querySelector('[aria-label="Star customer"]').click()`); await wait(100);
    assert.match(await client.evaluate(`document.querySelector('[data-testid="admin-customer-conversation-pane"] [role="alert"]').textContent`),/Could not confirm the favourite update/,'An update failure is visible in the conversation even when controls are closed');
    const favouriteErrorScreenshot=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-customer-favourite-error.png',Buffer.from(favouriteErrorScreenshot.data,'base64'));
    await client.evaluate(`window.__failStar=false;document.querySelectorAll('[data-testid="admin-account-row"]')[0].click()`); await wait(100);
    assert.match(await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[1].textContent`),/Encore II/,'A verified earned Encore level is shown on the directory row');
    assert.match(await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[3].textContent`),/Encore needs review/,'An incomplete bounded history is explicitly unknown');
    await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[1].click()`); await wait(50);
    assert.match(await client.evaluate(`document.querySelector('[data-testid="admin-account-action-rail"]').textContent`),/Encore tierEarned II/,'The selected account summary distinguishes earned from assigned Encore');
    await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[2].click()`);
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"][aria-current="true"]').length`), 1, 'Exactly one customer is visibly selected');
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('[data-testid="admin-account-row"][aria-current="true"]')).outlineStyle`), 'solid', 'The selected row remains distinguishable from membership glows');
    for (let attempt = 0; attempt < 50 && !await client.evaluate(`document.querySelector('[data-conversation-scope] header img[alt="Private verification portrait"]')?.naturalWidth > 0`); attempt++) await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope] header img[alt="Private verification portrait"]')?.naturalWidth > 0`), true, 'A consented private portrait appears in the admin chat header when no profile photo exists');
    const privatePortraitScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-private-portrait-chat.png", Buffer.from(privatePortraitScreenshot.data, "base64"));
    await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-row"]')[0].click()`); await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-row] [aria-label=" + JSON.stringify("Verification current") + "]").length'), 3, "Only current verification gets a badge");
    assert.equal(await client.evaluate('document.querySelector("a[aria-label=\\"DB Cinema Rentals home\\"]")?.getAttribute("href")'), "/", "The management logo links back to the website");
    assert.equal(await client.evaluate('document.querySelector("header")?.textContent.includes("FORM")'), false, "FORM 7 is absent from the management header");
    await client.evaluate(`document.querySelector('nav[aria-label="Breadcrumb"] button').click()`);
    assert.equal(await client.evaluate('window.__navigation'), 'overview', 'The management breadcrumb opens the dashboard');
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1672, height: 941, deviceScaleFactor: 1, mobile: false }); await wait(100);
    const initialScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-shell-desktop.png", Buffer.from(initialScreenshot.data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false }); await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=admin-customer-conversation-pane]")'), true, "The selected renter has a dedicated conversation pane");
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-row] small svg").length'), 5, 'Each populated customer conversation shows its own preview');
    assert(await client.evaluate(`(()=>[...document.querySelectorAll('[data-testid="admin-account-row"]')].every(row=>{const bounds=row.getBoundingClientRect();return [...row.querySelectorAll('strong,small,small span')].every(child=>{const box=child.getBoundingClientRect();return box.left>=bounds.left-1&&box.right<=bounds.right+1})}))()`), 'Customer names and previews remain within their rows');
    assert.equal(await client.evaluate('document.querySelectorAll("input[type=search]").length'), 1, "Only one customer/chat search is present");
    assert.match(await client.evaluate('document.querySelector("[data-testid=admin-customer-directory]").textContent'), /Can you confirm the camera kit\?/, "Directory rows show a bounded latest-chat preview");
    const desktop = await client.evaluate(`(()=>{const box=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}};return{directory:box(document.querySelector('[data-testid="admin-customer-directory"]')),conversation:box(document.querySelector('[data-testid="admin-customer-conversation-pane"]')),rail:box(document.querySelector('[data-testid="admin-account-action-rail"]')),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert(desktop.directory.right <= desktop.conversation.left + 1 && desktop.conversation.right <= desktop.rail.left + 1, "Desktop columns stay ordered directory → chat → actions");
    assert(desktop.directory.width >= 220 && desktop.conversation.width >= 340 && desktop.rail.width >= 220 && !desktop.overflow, "All three desktop panes remain usable without horizontal overflow");
    assert.equal(await client.evaluate('document.querySelector("[data-conversation-scope]")?.getAttribute("data-conversation-scope")'), "support:account-jordan", "The default thread is account-wide support");
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Rentals (')).click()`); await wait(100);
    assert.equal(await client.evaluate(`document.querySelectorAll('[aria-label="Booked equipment"]')[0].children.length`), 2, 'Both booked items appear in the rental history');
    assert.match(await client.evaluate(`document.querySelectorAll('[aria-label="Booked equipment"]')[0].textContent`), /×2/, 'Repeated units are grouped with their actual quantity');
    const multiItemScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-admin-multi-item-rental.png", Buffer.from(multiItemScreenshot.data, "base64"));
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Verification needs review'))`),true,'Review is visible even while account support is selected');
    await client.evaluate(`(()=>{const input=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Jordan');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(350); assert.equal(await client.evaluate('window.__lastDirectoryArgs?.search'), "Jordan", "Customer name search reaches the bounded directory query");
    await client.evaluate(`(()=>{const select=document.querySelector('[aria-label="Encore Tier"]');select.value='2';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(100); assert.equal(await client.evaluate('window.__lastDirectoryArgs?.encore'), "2", "Encore assignment filter reaches the server query");
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Verification case')).click()`); await wait(100);
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Verification needs review'))`), true, 'A Didit manual-review case receives a visible admin action');
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Verification needs review')).click()`); await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Rental verification progress"]')?.textContent.includes('synthetic-session')`), true, 'The paid pending-verification case shows its Didit session');
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Rental verification progress"]')?.textContent.includes('A required check did not pass.')`), true, 'The review panel shows the recorded verification reason');
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Rental verification progress"]')?.textContent.includes('Not recorded')`), true, 'Absent individual provider checks are not presented as passed or missing uploads');
    await client.evaluate(`(()=>{window.__mutationCalls=[];[...document.querySelectorAll('[aria-label="Rental verification progress"] button')].find(button=>button.textContent.includes('Refresh Didit decision')).click()})()`);await wait(100);
    assert.equal(await client.evaluate(`window.__mutationCalls.some(call=>call.ref==='didit.refreshProgress'&&call.args.bookingId==='booking-review'&&call.args.admin===true&&call.args.accountToken==='synthetic-admin')`),true,'The manual refresh checks the selected rental using the admin-scoped provider action');
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Rental verification progress"]')?.textContent.includes('No update recorded')`),true,'An unchanged or in-flight refresh does not claim a new provider decision');
    await client.evaluate(`window.__rejectDiditRefresh=true;[...document.querySelectorAll('[aria-label="Rental verification progress"] button')].find(button=>button.textContent.includes('Refresh Didit decision')).click()`);await wait(100);
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Rental verification progress"]')?.textContent.includes('refresh could not be confirmed')`),true,'An uncertain provider response does not claim the decision was unchanged');
    await client.evaluate(`window.__rejectDiditRefresh=false`);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Sony FX3 camera')).click()`); await wait(200);
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Verification needs review'))`), true, 'A review remains visible when a different rental is selected');
    assert.equal(await client.evaluate('document.querySelector("[data-conversation-scope]")?.getAttribute("data-conversation-scope")'), "rental:booking-camera", "Selecting a rental thread keeps its own booking conversation");
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-account-action-rail"]')?.textContent.includes('Possible match — compare manually')`), true, 'A possible identity match is visible without opening a hidden control');
    await client.evaluate(`window.__details['account-jordan'].membershipStatus='trialing';window.__details['account-jordan'].trialEnd=Date.UTC(2030,0,8);[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Membership')).click()`); await wait(100);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-level]").length'), 1, "Membership controls appear once inside the right rail");
    const expandedAccessScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-access-expanded.png", Buffer.from(expandedAccessScreenshot.data, "base64"));
    assert.match(await client.evaluate(`document.querySelector('[aria-label="Subscription refund reviews"]').textContent`),/in_synthetic.*re_synthetic/s);
    assert.equal(await client.evaluate(`document.querySelectorAll('[aria-label="Subscription refund reviews"] button').length`),0,'An unresolved refund cannot be cleared from this panel');
    await client.evaluate(`document.querySelector('[aria-label="Subscription refund reviews"]').scrollIntoView({block:'center',behavior:'instant'})`);await wait(50);
    const refundReviewScreenshot = await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-membership-refund-review.png',Buffer.from(refundReviewScreenshot.data,'base64'));
    assert.match(await client.evaluate('document.querySelector("[data-testid=admin-account-action-rail]").textContent'), /Free trial/, "A trial is never presented as a paid subscription");
    assert.match(await client.evaluate('document.querySelector("[aria-label="+JSON.stringify("Subscription credit reviews")+"]").textContent'), /in_synthetic/);
    await client.evaluate(`window.confirm=()=>false;document.querySelector('[aria-label="Subscription credit reviews"] button').click()`);await wait(50);
    assert.equal(await client.evaluate(`window.__mutationCalls.filter(call=>call.ref==='checkout.adminRetryMembershipInvoice').length`),0,'Cancel cannot retry a credit');
    await client.evaluate(`window.confirm=()=>true;document.querySelector('[aria-label="Subscription credit reviews"] button').click()`);await wait(100);
    assert.equal(await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='checkout.adminRetryMembershipInvoice')?.args.accountId`),'account-jordan');
    assert.equal(await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='checkout.adminRetryMembershipInvoice')?.args.invoiceId`),'in_synthetic');
    await client.evaluate(`window.open=()=>({opener:null,location:{replace:url=>window.__billingUrl=url},close:()=>{}});[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Manage subscription in Stripe')).click()`); await wait(100);
    assert.equal(await client.evaluate('window.__billingUrl'), 'https://billing.stripe.com/p/session/fixture', 'The selected customer opens the actual billing action');
    assert.equal(await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='checkout.adminBillingPortal')?.args.accountId`), 'account-jordan', 'The billing action targets the selected account');
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Refresh Stripe status').click()`);await wait(100);
    assert.equal(await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='checkout.adminRefreshMembership')?.args.accountId`),'account-jordan','Stripe refresh targets only the selected account');
    assert.match(await client.evaluate(`document.querySelector('[data-testid="admin-account-action-rail"]').textContent`),/Stripe subscription status refreshed/);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Check latest invoice & credit').click()`);await wait(100);
    assert.equal(await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='checkout.adminInspectMembershipInvoice')?.args.accountId`),'account-jordan');
    assert.match(await client.evaluate(`document.querySelector('[aria-label="Latest subscription invoice"]').textContent`),/in_synthetic.*credit recorded.*reversed/s);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Check latest paid invoice').click()`);await wait(100);
    assert.equal(await client.evaluate(`window.__mutationCalls.filter(call=>call.ref==='checkout.adminInspectMembershipInvoice').at(-1)?.args.selection`),'paid');assert.match(await client.evaluate(`document.querySelector('[aria-label="Latest subscription invoice"]').textContent`),/Most recently created paid invoice/);
    await client.evaluate(`document.querySelector('[aria-label="Latest subscription invoice"]').scrollIntoView({block:'center',behavior:'instant'})`);await wait(50);const billingReceiptImage=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-membership-invoice-check.png',Buffer.from(billingReceiptImage.data,'base64'));
    await client.evaluate(`window.__details['account-jordan'].membershipStatus='canceled';[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Membership')).click()`); await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-level]").length'), 0, "The selected action row collapses its controls");
    assert.match(await client.evaluate('document.querySelector("[data-testid=admin-account-action-rail]").textContent'), /MembershipPro · Canceled/, "Canceled subscriptions retain their real billing status");
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Membership')).click()`); await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-level]").length'), 1, "The same action row expands again without duplicating controls");
    assert.equal(await client.evaluate(`!![...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.trim()==='Membership access')`), false, 'There is no duplicate membership action');
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Encore tier')).click()`); await wait(50);
    assert.equal(await client.evaluate(`document.activeElement?.getAttribute('data-testid')`), 'admin-account-encore-level', 'Encore summary opens and focuses its level control');
    assert.equal(await client.evaluate(`document.querySelectorAll('[data-testid="admin-account-level"]').length`), 1, 'Switching summary rows does not duplicate access controls');
    await wait(500);
    assert.equal(await client.evaluate(`(()=>{const rail=document.querySelector('[data-testid="admin-account-action-rail"]').getBoundingClientRect(),close=document.querySelector('[aria-label="Close membership and Encore controls"]').getBoundingClientRect();return close.top>=rail.top&&close.bottom<=rail.bottom})()`), true, 'Close remains visible while the controls scroll');
    await client.evaluate(`document.querySelector('[aria-label="Close membership and Encore controls"]').click()`); await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-level]").length'), 0, 'The expanded controls can be closed without scrolling back to the summary');
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Encore tier')).click()`); await wait(50);
    await client.evaluate(`(()=>{const input=document.querySelector('[data-testid="admin-account-reason"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Fixture check');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(50);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=admin-account-save-level]").length'), 1, "Existing permission-checked membership mutation remains a single control");
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim().startsWith('Rental actions')).click()`); await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=owner-rental-tools]")'), true, `Selected rental actions open in the account rail: ${JSON.stringify(await client.evaluate('window.__errors'))}`);
    await client.evaluate(`[...document.querySelectorAll('[data-testid="owner-rental-tools"] button')].find(button=>button.textContent.includes('Partial / full rental refund')).click()`); await wait(50);
    await client.evaluate(`(()=>{const form=document.querySelector('[data-testid="owner-rental-tools"] form');for(const [selector,value] of [['input[type=number]','15'],['textarea','Fixture refund reason']]){const input=form.querySelector(selector);Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()`); await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="owner-rental-tools"] form').requestSubmit()`); await wait(100);
    assert.deepEqual(await client.evaluate(`(()=>{const call=window.__mutationCalls.find(item=>item.ref==='checkout.refundRental');return call?{bookingId:call.args.bookingId,amountPence:call.args.amountPence,reason:call.args.reason}:null})()`), {bookingId:'booking-camera',amountPence:1500,reason:'Fixture refund reason'}, 'Refund controls target the selected rental with the confirmed amount and reason');
    await client.evaluate(`window.__accounts[0].blocked=true;window.__accounts[0].blockedAt=123;window.__accounts[0].restrictionNoticeId='notice-fixture';window.__details['account-jordan'].restrictionNotice={state:'attention',sentAt:null};[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Restrict account')).click()`); await wait(100);
    assert.match(await client.evaluate('document.querySelector("[data-testid=admin-account-action-rail]").textContent'), /Restriction email needs attention/, 'A failed or uncertain restriction notice is visible to the administrator');
    await client.evaluate(`window.__accounts[0].blocked=false;window.__accounts[0].blockedAt=null;window.__accounts[0].restrictionNoticeId=null;[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Unblock account')).click()`); await wait(50);
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Restrict account')).click()`); await wait(50);
    assert.equal(await client.evaluate(`document.querySelector('[data-testid="admin-account-reason"]').value`),'','A reason from a different control is not reused for a restriction');
    await client.evaluate(`(()=>{const input=document.querySelector('[data-testid="admin-account-reason"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Fixture restriction');input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="admin-account-block"]').click()`); await wait(50);
    assert.match(await client.evaluate(`document.querySelector('[aria-label="Confirm account change"]').textContent`),/Jordan Blake \(jordan@example\.invalid\).*Reason: Fixture restriction/,'Review shows the selected customer and exact reason');
    await client.evaluate(`(()=>{const input=document.querySelector('[data-testid="admin-account-reason"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Revised fixture reason');input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await wait(50);
    assert.equal(await client.evaluate(`!!document.querySelector('[data-testid="admin-account-confirm-block"]')`),false,'Changing the reason invalidates the earlier confirmation');
    await client.evaluate(`window.__mutationCalls=[];document.querySelector('[data-testid="admin-account-block"]').click()`); await wait(50);
    await client.evaluate(`document.querySelector('[data-testid="admin-account-confirm-block"]').click()`); await wait(50);
    assert.deepEqual(await client.evaluate(`(()=>{const call=window.__mutationCalls.find(item=>item.ref==='accountAdmin.setBlocked');return call?{accountId:call.args.accountId,blocked:call.args.blocked,reason:call.args.reason}:null})()`),{accountId:'account-jordan',blocked:true,reason:'Revised fixture reason'},'Only the reviewed account and revised reason are submitted');
    await client.evaluate(`window.__accounts[0].blocked=true;window.__accounts[0].blockedAt=456;window.__accounts[0].restrictionNoticeId='notice-new';[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Restrict account')).click()`); await wait(50);
    await client.evaluate(`[...document.querySelectorAll('[data-testid="admin-account-action-rail"] button')].find(button=>button.textContent.includes('Unblock account')).click()`); await wait(50);
    await client.evaluate(`(()=>{const input=document.querySelector('[data-testid="admin-account-reason"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Fixture unblock');input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await wait(50);
    await client.evaluate(`window.__mutationCalls=[];document.querySelector('[data-testid="admin-account-block"]').click()`); await wait(50);
    assert.equal(await client.evaluate(`window.__mutationCalls.some(item=>item.ref==='accountAdmin.setBlocked')`),false,'Reviewing an unblock does not immediately change the account');
    assert.match(await client.evaluate(`document.querySelector('[aria-label="Confirm account change"]').textContent`),/Unblock Jordan Blake.*Reason: Fixture unblock/,'Unblocking has an explicit review with the customer and reason');
    await client.evaluate(`document.querySelector('[data-testid="admin-account-confirm-block"]').click()`); await wait(50);
    assert.equal(await client.evaluate(`window.__mutationCalls.find(item=>item.ref==='accountAdmin.setBlocked')?.args.blocked`),false,'Confirming the review requests an unblock');
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Open in full inbox')).click()`);
    assert.deepEqual(await client.evaluate('window.__openedFullInbox'), { accountId: "account-jordan", bookingId: "booking-camera" }, "The existing full-inbox navigation retains selected account and rental IDs");
    for (const width of [320, 390, 1280, 1500]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }); await wait(100);
      const state = await client.evaluate(`(()=>({overflow:document.documentElement.scrollWidth>innerWidth,panes:[...document.querySelectorAll('[data-testid="admin-customer-conversation-pane"],[data-testid="admin-account-action-rail"]')].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})}))()`);
      assert(!state.overflow, `No horizontal overflow at ${width}px`);
      if (width === 320) {
        assert.equal(await client.evaluate(`(()=>{const header=document.querySelector('header');return [...header.querySelectorAll('a,button')].every(item=>{const rect=item.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth})})()`), true, 'Header controls stay within the narrow viewport');
        await client.evaluate(`document.querySelector('button[aria-label="Toggle account menu"]').click()`);
        assert.equal(await client.evaluate(`document.querySelector('button[aria-label="Toggle account menu"]').getAttribute('aria-expanded')`), 'true', 'The mobile account menu opens');
        await client.evaluate(`document.querySelector('button[aria-label="Close account menu"]').click()`);
      }
      if (width >= 1500) assert(state.panes[0].right <= state.panes[1].left + 1, "Wide layout keeps the conversation before the action rail");
      assert.equal(await client.evaluate(`(()=>{const rail=document.querySelector('[data-testid="admin-account-action-rail"]');const heading=[...rail.querySelectorAll('h2')].find(item=>item.textContent==='Account Management');const close=rail.querySelector('[aria-label="Close customer profile"]');const a=heading.getBoundingClientRect(),b=close.getBoundingClientRect();return a.right<=b.left||a.bottom<=b.top||a.top>=b.bottom})()`),true,`The action-rail heading and close control do not overlap at ${width}px`);
      assert.equal(await client.evaluate(`(()=>{const button=document.querySelector('[data-testid="admin-account-action-rail"] button[aria-controls]');return !!document.getElementById(button?.getAttribute('aria-controls'))})()`),true,'Expandable actions reference their content');
      if (width === 390) {
        const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-workspace-mobile.png", Buffer.from(screenshot.data, "base64"));
        await client.cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        await client.evaluate(`window.scrollTo(0,0);window.__scrollOptions=null;const original=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(options){if(this.matches('[data-testid="admin-customer-conversation-pane"]'))window.__scrollOptions=options;return original.call(this,options)};document.querySelector('[data-testid="admin-account-row"]').click()`);
        await wait(250);
        assert.equal(await client.evaluate(`window.__scrollOptions?.behavior`), "auto", "Opening a mobile customer respects reduced motion");
        const visible = await client.evaluate(`(()=>{const pane=document.querySelector('[data-testid="admin-customer-conversation-pane"]').getBoundingClientRect(),header=document.querySelector('header').getBoundingClientRect();return {paneTop:pane.top,headerBottom:header.bottom}})()`);
        assert(visible.paneTop >= visible.headerBottom - 1 && visible.paneTop < visible.headerBottom + 35, "Mobile customer navigation leaves the chat header visible below the site header");
        assert(await client.evaluate(`document.querySelector('[data-testid="admin-customer-conversation-pane"]').getBoundingClientRect().bottom >= innerHeight - 30`), "An opened mobile admin conversation uses the available screen height");
        assert(await client.evaluate(`(()=>{const box=document.querySelector('[data-testid="admin-customer-conversation-pane"] textarea').getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight})()`), "The mobile admin composer remains visible when the conversation opens");
        const openedChatScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-opened-chat-mobile.png", Buffer.from(openedChatScreenshot.data, "base64"));
        await client.cmd("Emulation.setEmulatedMedia", { features: [] });
        await client.evaluate("window.scrollTo(0,0)");
      }
    }
    const screenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-customer-workspace-desktop.png", Buffer.from(screenshot.data, "base64"));
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-conversation-scope]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('document.querySelector("[data-conversation-scope]")?.getAttribute("data-role")'), 'renter', 'The customer conversation retains its renter role');
    assert.equal(await client.evaluate('!!document.querySelector("aside button")'), true, 'The real renter conversation directory renders');
    assert.equal(await client.evaluate(`document.querySelector('aside button[aria-current="true"]')?.textContent.includes('Account support')`), true, 'The default support conversation is visibly selected');
    assert.equal(await client.evaluate(`document.body.textContent.includes('Sony FX3 camera') && document.body.textContent.includes('Sony 24–70mm lens')`), true, 'The customer directory renders multiple synthetic rental conversations');
    assert.equal(await client.evaluate(`(()=>{const fallback=[...document.querySelectorAll('aside [role="img"]')].find(item=>item.getAttribute('aria-label')==='Photo unavailable');return !!fallback && getComputedStyle(fallback.querySelector('span')).display==='none' && fallback.querySelector('svg').getBoundingClientRect().width>0})()`), true, 'Missing rental photos show an unclipped icon without cramped fallback text');
    assert.equal(await client.evaluate(`document.querySelector('[aria-label="Your conversations"] [aria-label="2 unread messages"]')?.textContent`), '2', 'Unread rental counts are labelled for assistive technology');
    for (const width of [320, 390, 768, 1023, 1100, 1500]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }); await wait(100);
      assert.equal(await client.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `The renter workspace does not overflow at ${width}px`);
      assert.equal(await client.evaluate(`!![...document.querySelectorAll('button')].find(item=>item.textContent.includes('Request a human'))`), false, `No permanent human-request button appears at ${width}px`);
      if (width >= 768 && width <= 1023) {
        const cardWidth = await client.evaluate(`document.querySelector('[aria-label="Your conversations"] button').getBoundingClientRect().width`);
        assert(cardWidth >= 210 && cardWidth <= 230, `Tablet conversation cards remain compact at ${width}px: ${cardWidth}`);
        assert(await client.evaluate(`document.querySelector('[data-conversation-scope]').getBoundingClientRect().bottom >= innerHeight - 35`), `The customer chat uses the available tablet height at ${width}px`);
        assert(await client.evaluate(`document.querySelector('[data-conversation-scope] textarea').getBoundingClientRect().bottom <= innerHeight`), `The tablet composer stays visible at ${width}px`);
        if (width === 768) { const image = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-conversation-tablet.png", Buffer.from(image.data, "base64")); }
      }
      if (width === 390) { assert(await client.evaluate(`document.querySelector('[data-conversation-scope]').getBoundingClientRect().bottom >= innerHeight - 30`), 'The customer chat uses the available mobile height'); const image = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-conversation-mobile.png", Buffer.from(image.data, "base64")); }
      if (width === 1500) { const bounds = await client.evaluate(`(()=>{const chat=document.querySelector('[data-conversation-scope]'),parent=chat.parentElement;return {top:chat.getBoundingClientRect().top,bottom:chat.getBoundingClientRect().bottom,parentBottom:parent.getBoundingClientRect().bottom,viewport:innerHeight,border:getComputedStyle(chat).borderTopWidth}})()`); assert(bounds.bottom >= bounds.viewport - 30, `The renter chat uses the available height: ${JSON.stringify(bounds)}`); assert.equal(bounds.border,'1px','The customer chat has a framed workspace like the admin conversation'); }
    }
    await client.evaluate(`document.querySelector('[data-conversation-scope]') && [...document.querySelectorAll('aside button')].find(button=>button.textContent.includes('Sony FX3 camera')).click()`);
    await wait(150);
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope]')?.getAttribute('data-conversation-scope')`), 'rental:renter-camera', 'Selecting a rental opens that rental conversation');
    assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Rental management controls"], [aria-label="Conversation actions"], [aria-label="Star customer"]')`), false, 'The selected rental does not expose admin controls');
    assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Your rental details"]')`), true, 'The selected rental retains its customer booking details');
    assert(await client.evaluate(`document.querySelector('[data-conversation-scope]').getBoundingClientRect().bottom >= innerHeight - 30`), 'The selected rental chat also fills the available desktop height');
    const renterScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-conversation-desktop.png", Buffer.from(renterScreenshot.data, "base64"));
    for (const width of [320, 390, 1100, 1500]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }); await wait(100);
      assert.equal(await client.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `The selected rental has no horizontal overflow at ${width}px`);
      assert.equal(await client.evaluate(`(()=>{const input=document.querySelector('[data-conversation-scope] textarea');const rect=input.getBoundingClientRect();return rect.width>150&&rect.left>=0&&rect.right<=innerWidth})()`), true, `The selected rental composer remains usable at ${width}px`);
      if (width === 390) { const mobileRentalScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-renter-rental-mobile.png", Buffer.from(mobileRentalScreenshot.data, "base64")); }
    }
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope] header img[alt="DB Cinema team"]')?.getAttribute('src')`), '/db-cinema-aperture-blue.png', 'The customer-facing team avatar uses the team image, not the renter identity');
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true }); await wait(100);
    await client.evaluate(`window.__attachmentRequests=[];window.fetch=async(url)=>{window.__attachmentRequests.push(new URL(url).searchParams.get('key'));return {ok:false,status:503}}`);
    assert.equal(await client.evaluate(`document.querySelector('[data-conversation-scope] input[type=file]').accept`), 'image/jpeg,image/png,image/webp', 'The picker exposes only supported images');
    await client.evaluate(`(()=>{const input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File(['%PDF-'],'fixture.pdf',{type:'application/pdf'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await wait(100);
    assert.match(await client.evaluate(`document.querySelector('[role=alert]').textContent`), /JPG, PNG or WebP image up to 10 MB/);
    assert.equal(await client.evaluate('window.__attachmentRequests.length'), 0, 'A PDF is rejected before any upload');
    const chooseAttachment = async content => { await client.evaluate(`(()=>{const input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([${JSON.stringify(content)}],'same.png',{type:'image/png',lastModified:123}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`); for(let attempt=0;attempt<50 && await client.evaluate(`document.querySelector('[aria-label="Attach an image, JPG, PNG or WebP up to 10 MB"]')?.disabled`);attempt++)await wait(50); await wait(100); };
    await chooseAttachment('first'); await chooseAttachment('other'); await chooseAttachment('first');
    const keys = await client.evaluate('window.__attachmentRequests');
    assert.equal(keys.length,3,'Each synthetic upload reaches the simulated transport');
    assert.notEqual(keys[0],keys[1],'Different file bytes do not reuse a pending retry key even with identical metadata');
    assert.equal(keys[0],keys[2],'Retrying identical bytes retains the original request key');
    await client.evaluate(`window.__cleanedUpload=null;window.__cleanCalls=0;window.fetch=async(url,options)=>{window.__cleanCalls++;if(window.__cleanCalls===1)return {ok:false,status:403};window.__cleanedUpload=options.body;return {ok:true,status:200}}`);
    await client.evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const context=canvas.getContext('2d');context.fillStyle='#cd3456';context.fillRect(0,0,2,2);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([blob,'metadata-to-remove'],'photo.png',{type:'image/png'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    for(let attempt=0;attempt<50&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy')`);attempt++)await wait(50);
    assert.match(await client.evaluate('document.querySelector("[data-conversation-scope]").textContent'),/original stays on your device/i,'The opt-in explains that the original is not replaced');
    assert.equal(await client.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent==='Send cleaned PNG copy'),rect=button.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight})()`),true,'The cleaned-copy choice is visible on the mobile viewport');
    assert.equal(await client.evaluate(`(()=>{const input=document.querySelector('[data-conversation-scope] textarea'),rect=input.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight})()`),true,'The mobile composer remains visible with the cleaned-copy option');
    const cleanOptionScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-chat-clean-copy-mobile.png", Buffer.from(cleanOptionScreenshot.data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false }); await wait(100);
    assert.equal(await client.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent==='Send cleaned PNG copy'),input=document.querySelector('[data-conversation-scope] textarea');return [button,input].every(node=>{const rect=node.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight})})()`),true,'The cleaned-copy choice and composer fit on desktop');
    const cleanDesktopScreenshot = await client.cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/dbc-chat-clean-copy-desktop.png", Buffer.from(cleanDesktopScreenshot.data, "base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true }); await wait(100);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy').click()`);
    for(let attempt=0;attempt<50&&!await client.evaluate('!!window.__cleanedUpload');attempt++)await wait(50);
    const cleaned = await client.evaluate(`(async()=>{const file=window.__cleanedUpload;if(!file)return null;const bytes=new Uint8Array(await file.arrayBuffer()),bitmap=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);const pixel=[...context.getImageData(0,0,1,1).data];bitmap.close();return {name:file.name,type:file.type,width:canvas.width,height:canvas.height,pixel,hasMetadata:new TextDecoder().decode(bytes).includes('metadata-to-remove')}})()`);
    assert.deepEqual(cleaned,{name:'photo-cleaned.png',type:'image/png',width:2,height:2,pixel:[205,52,86,255],hasMetadata:false},'The explicitly requested copy retains the rendered pixels and removes trailing metadata');
    const cleanedBytes = await client.evaluate(`(async()=>btoa(String.fromCharCode(...new Uint8Array(await window.__cleanedUpload.arrayBuffer()))))()`);
    await require('../services/chat-scanner/scanner.cjs').validateStructure(Buffer.from(cleanedBytes, 'base64'), '/dev/shm');
    await client.evaluate(`window.__originalBitmap=window.createImageBitmap;window.createImageBitmap=undefined;window.__cleanedUpload=null;window.__cleanCalls=0`);
    await client.evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;canvas.getContext('2d').fillRect(0,0,1,1);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([blob],'fallback.png',{type:'image/png'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    for(let attempt=0;attempt<50&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy')`);attempt++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy').click()`);
    for(let attempt=0;attempt<50&&!await client.evaluate('!!window.__cleanedUpload');attempt++)await wait(50);
    assert.equal(await client.evaluate('window.__cleanedUpload?.name'),'fallback-cleaned.png','The image-element fallback works without createImageBitmap');
    await client.evaluate('window.createImageBitmap=window.__originalBitmap');
    const rotated = await require('sharp')({create:{width:2,height:3,channels:3,background:'#ad4b75'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    await client.evaluate(`window.__cleanedUpload=null;window.__cleanCalls=0;(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(rotated.toString('base64'))}),char=>char.charCodeAt(0)),input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([bytes],'rotated.jpg',{type:'image/jpeg'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    for(let attempt=0;attempt<50&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy')`);attempt++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy').click()`);
    for(let attempt=0;attempt<50&&!await client.evaluate('!!window.__cleanedUpload');attempt++)await wait(50);
    assert.deepEqual(await client.evaluate(`(async()=>{const bitmap=await createImageBitmap(window.__cleanedUpload);const size=[bitmap.width,bitmap.height];bitmap.close();return size})()`),[3,2],'Cleaned copies apply EXIF orientation before removing metadata');
    await client.evaluate(`window.__cleanedUpload=null;window.__cleanCalls=0;window.createImageBitmap=undefined;(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(rotated.toString('base64'))}),char=>char.charCodeAt(0)),input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([bytes],'rotated-fallback.jpg',{type:'image/jpeg'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    for(let attempt=0;attempt<50&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy')`);attempt++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy').click()`);
    for(let attempt=0;attempt<50&&!await client.evaluate('!!window.__cleanedUpload');attempt++)await wait(50);
    await client.evaluate('window.createImageBitmap=window.__originalBitmap');
    assert.deepEqual(await client.evaluate(`(async()=>{const bitmap=await createImageBitmap(window.__cleanedUpload);const size=[bitmap.width,bitmap.height];bitmap.close();return size})()`),[3,2],'The image-element fallback also applies EXIF orientation');
    await client.evaluate(`window.__cleanCalls=0;window.__releaseBitmap=null;window.createImageBitmap=(...args)=>new Promise(resolve=>{window.__releaseBitmap=()=>window.__originalBitmap(...args).then(resolve)});(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(rotated.toString('base64'))}),char=>char.charCodeAt(0)),input=document.querySelector('[data-conversation-scope] input[type=file]'),files=new DataTransfer();files.items.add(new File([bytes],'scope.jpg',{type:'image/jpeg'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    for(let attempt=0;attempt<50&&!await client.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy')`);attempt++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Send cleaned PNG copy').click()`);
    for(let attempt=0;attempt<50&&!await client.evaluate('!!window.__releaseBitmap');attempt++)await wait(50);
    await client.evaluate(`[...document.querySelectorAll('aside button')].find(button=>button.textContent.includes('Account support')).click();window.__releaseBitmap();window.createImageBitmap=window.__originalBitmap`); await wait(300);
    assert.equal(await client.evaluate('window.__cleanCalls'),1,'Changing conversations before conversion finishes cannot send the old image into the new conversation');
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=2` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-conversation-scope]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Star customer"], [aria-label="Conversation actions"], [aria-label="Rental management controls"]')`), false, 'Even an incorrectly supplied admin identity cannot expose admin controls to a renter');
    assert.equal(await client.evaluate('document.body.textContent.includes("Private customer")'), false, 'The renter view does not render a supplied admin identity');
    assert.equal(await client.evaluate('!!document.querySelector("[data-private-portrait]")'), false, 'The renter view cannot render a supplied private portrait');
    assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Add an emoji"]')`), true, 'The renter receives the shared chat presentation');
    assert.equal(await client.evaluate('document.querySelector("[data-conversation-scope]").textContent.includes("Request a human")'), false, 'A human-request button is not shown without an offer');
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=2&catalogue=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=gaffer-catalogue-card]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=gaffer-catalogue-card]").length'), 1, 'A safe catalogue result renders as a chat card');
    assert.match(await client.evaluate('document.querySelector("[data-testid=gaffer-catalogue-card]").textContent'), /Sony FX3 camera.*Open for dates.*£88.00/s, 'The renter card shows the verified date-window quote and availability');
    assert.equal(await client.evaluate('document.querySelector("[data-testid=gaffer-catalogue-card-link]").getAttribute("href")'), '/gear/sony-fx3', 'The card links to the actual catalogue item');
    const catalogueLayout = await client.evaluate(`(()=>{const card=document.querySelector('[data-testid="gaffer-catalogue-card"]').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,left:card.left,right:card.right,width:card.width}})()`);
    assert.equal(catalogueLayout.overflow, false, 'The catalogue card does not widen the chat page');
    const catalogueImage=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-gaffer-catalogue-card.png",Buffer.from(catalogueImage.data,"base64"));
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=2&handoff=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-testid=human-handoff-offer]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=human-handoff-offer]").length'), 1, 'A structured Gaffer offer produces one chat-native action');
    assert.equal(await client.evaluate('window.__mutationCalls.filter(call=>call.ref==="chat.requestHuman").length'), 0, 'Merely offering help never requests a human');
    await client.evaluate('document.querySelector("[data-testid=human-handoff-offer]").scrollIntoView({block:"center",behavior:"instant"})');await wait(80);const handoffImage=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync("/tmp/dbc-chat-human-offer.png",Buffer.from(handoffImage.data,"base64"));
    await client.evaluate('document.querySelector("[data-testid=human-handoff-offer] button").click()'); await wait(100);
    assert.equal(await client.evaluate('window.__mutationCalls.filter(call=>call.ref==="chat.requestHuman").length'), 1, 'The offer sends only after the renter clicks');
    assert.equal(await client.evaluate('window.__mutationCalls.find(call=>call.ref==="chat.requestHuman").args.token'), "synthetic-renter", 'The handoff uses the renter session');
    assert.equal(await client.evaluate('document.querySelectorAll("[data-testid=human-handoff-offer] button").length'), 0, 'An accepted offer cannot be clicked twice');
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=2&handoff=1&stale=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-conversation-scope]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=human-handoff-offer]")'), false, 'A newer customer message retires an old offer');
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?renter=2&handoff=1&team=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[data-conversation-scope]")'); attempt++) await wait(100);
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=human-handoff-offer]")'), false, 'A team-handled conversation cannot offer a duplicate handoff');
    assert.equal(await client.evaluate('document.querySelector("[data-conversation-scope]").textContent.includes("Get back to Gaffer")'), true, 'Customers may resume Gaffer after team handoff');
    await client.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/?documents=1` });
    for (let attempt = 0; attempt < 100 && !await client.evaluate('!!document.querySelector("[aria-label=\\"Insurance retention hold\\"]")'); attempt++) await wait(100);
    await client.evaluate(`document.querySelector('[aria-label="Insurance retention hold"]').click()`); await wait(50);
    assert.equal(await client.evaluate(`window.__mutationCalls.some(call=>call.ref==='verificationArchive.retentionHold')`),false,'Opening the hold review does not release documents');
    assert.match(await client.evaluate(`document.querySelector('[data-testid="retained-documents-page"]').textContent`),/Open insurance claim.*eligible for deletion/s,'The confirmation describes the specific hold and deletion consequence');
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Confirm hold removal').scrollIntoView({block:'center',behavior:'instant'})`);await wait(100);
    const holdScreenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync('/tmp/dbc-retention-hold-review.png',Buffer.from(holdScreenshot.data,'base64'));
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Confirm hold removal').click()`); await wait(50);
    assert.deepEqual(await client.evaluate(`(()=>{const call=window.__mutationCalls.find(item=>item.ref==='verificationArchive.retentionHold');return call?{reason:call.args.reason,expectedReason:call.args.expectedReason,expectedRevision:call.args.expectedRevision,confirmed:call.args.confirmed}:null})()`),{reason:'',expectedReason:'Open insurance claim',expectedRevision:7,confirmed:true},'Only explicit confirmation submits the reviewed hold version');
    await client.cmd("Page.navigate", {url:`http://127.0.0.1:${server.address().port}/?documents=1&retention-review=1`});
    for(let attempt=0;attempt<100&&!await client.evaluate(`document.querySelector('[data-testid="retained-documents-page"]')?.textContent.includes('Retention needs review')`);attempt++)await wait(100);
    const reviewText=await client.evaluate(`document.querySelector('[data-testid="retained-documents-page"]').textContent`);assert.match(reviewText,/Retention needs review/);assert.match(reviewText,/Paused for review/);assert.match(reviewText,/Retention review required/);assert.match(reviewText,/Deletion is paused/);assert.match(reviewText,/Case dates need investigation/);assert.match(reviewText,/linked-booking-fixture/);assert.match(reviewText,/case-fixture/);assert.match(reviewText,/Missing or invalid/);assert.doesNotMatch(reviewText,/Retention ended/,'Protected documents must not be mislabeled as expired');
    await client.evaluate(`[...document.querySelectorAll('strong')].find(node=>node.textContent==='Case dates need investigation').scrollIntoView({block:'center',behavior:'instant'})`);await wait(100);
    const retentionReviewScreenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync('/tmp/dbc-retention-chronology-review.png',Buffer.from(retentionReviewScreenshot.data,'base64'));
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Open linked rental →').click()`);assert.equal(await client.evaluate(`window.__investigateRental`),'linked-booking-fixture','Review opens the actual linked case rental, not the archive source rental');
    await client.evaluate(`window.__mutationCalls=[];document.querySelector('[aria-label="Insurance retention hold"]').click()`);await wait(50);
    assert.equal(await client.evaluate(`window.__mutationCalls.length`),0,'Reviewing an additional hold does not change it');
    await client.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Case evidence review in progress');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(50);
    await client.evaluate(`document.querySelector('textarea').scrollIntoView({block:'center',behavior:'instant'})`);await wait(50);const holdDuringReviewScreenshot=await client.cmd("Page.captureScreenshot",{format:"png"});fs.writeFileSync('/tmp/dbc-retention-review-hold.png',Buffer.from(holdDuringReviewScreenshot.data,'base64'));
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Save insurance hold').click()`);await wait(50);
    assert.deepEqual(await client.evaluate(`(()=>{const call=window.__mutationCalls.find(item=>item.ref==='verificationArchive.retentionHold');return call?{reason:call.args.reason,expectedReason:call.args.expectedReason,expectedRevision:call.args.expectedRevision,confirmed:call.args.confirmed}:null})()`),{reason:'Case evidence review in progress',expectedReason:'',expectedRevision:0,confirmed:true},'Only a confirmed, reasoned additional hold is submitted during retention review');
    await client.cmd("Page.navigate", {url:`http://127.0.0.1:${server.address().port}/?credit=1`});
    for(let attempt=0;attempt<100&&!await client.evaluate(`!!document.querySelector('[aria-label="Account credit controls"] input[type="checkbox"]')`);attempt++)await wait(100);
    await client.evaluate(`(()=>{window.__creditFail=true;const input=document.querySelector('[aria-label="Account credit controls"] input:not([type])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Private fixture reason');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label="Account credit controls"] input[type="checkbox"]').click()})()`);await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Issue credit').click()`);await wait(150);
    const firstCredit=await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='accountCredits.grantAdmin')?.args`);assert(firstCredit,'The confirmed first attempt reaches the credit mutation');
    assert.equal(await client.evaluate(`sessionStorage.getItem('dbc-credit-request:account-jordan').includes('Private fixture reason')`),false,'Browser recovery storage never contains the free-text note');
    assert.equal(await client.evaluate(`JSON.parse(sessionStorage.getItem('dbc-credit-request:account-jordan')).revision`),0,'The original revision is retained for delayed retries');
    await client.cmd("Page.reload");for(let attempt=0;attempt<100&&!await client.evaluate(`document.body?.textContent.includes('previous request may already have issued')`);attempt++)await wait(100);
    const creditScreenshot=await client.cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/dbc-credit-recovery-mobile.png',Buffer.from(creditScreenshot.data,'base64'));
    await client.evaluate(`(()=>{document.querySelector('[aria-label="Account credit controls"] input[type="checkbox"]').click();[...document.querySelectorAll('button')].find(button=>button.textContent==='Retry saved credit request').click()})()`);await wait(150);
    assert.equal(await client.evaluate(`window.__mutationCalls.filter(call=>call.ref==='accountCredits.grantAdmin').length`),0,'A changed note cannot submit a second grant');
    await client.evaluate(`(()=>{const input=document.querySelector('[aria-label="Account credit controls"] input:not([type])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Private fixture reason');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label="Account credit controls"] input[type="checkbox"]').click()})()`);await wait(50);
    await client.evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Retry saved credit request').click()`);await wait(150);
    assert.equal(await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='accountCredits.grantAdmin')?.args.requestId`),firstCredit.requestId,'Reload recovery retries the identical request ID');
    assert.equal(await client.evaluate(`window.__mutationCalls.find(call=>call.ref==='accountCredits.grantAdmin')?.args.expectedRevision`),firstCredit.expectedRevision,'Reload recovery preserves the original revision');
    assert.equal(await client.evaluate(`sessionStorage.getItem('dbc-credit-request:account-jordan')`),null,'A confirmed result clears the pending request');
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=2"});
    for(let attempt=0;attempt<100&&!await client.evaluate('!!document.querySelector("[data-conversation-scope]")');attempt++)await wait(50);
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")'),false,'A renter message alone never shows the invitation');
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=2&reply=1&notifications-active=1"});await wait(500);
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")'),false,'An already active device is not asked again');
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=2&reply=1"});
    for(let attempt=0;attempt<100&&!await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")');attempt++)await wait(50);
    assert.equal(await client.evaluate('document.querySelector("[data-message-id=gaffer-first-answer]")?.nextElementSibling?.getAttribute("aria-label")'),'Chat notifications','The card follows the first actual Gaffer answer');
    assert.equal(await client.evaluate('!!document.querySelector("[data-testid=rental-gaffer-gear-help]")'),true,'Renters can open the live gear assistant from their rental chat');
    await client.evaluate('window.__gafferPrompt="";window.addEventListener("dbc:open-gaffer-chat",event=>window.__gafferPrompt=event.detail?.prompt||"");document.querySelector("[data-testid=rental-gaffer-gear-help]").click()'); await wait(50);
    assert.match(await client.evaluate('window.__gafferPrompt'),/live item cards.*quote.*availability check/i,'The rental shortcut routes into the full live recommendation, quote and availability flow');
    assert.match(await client.evaluate('window.__gafferPrompt'),/Don.t change a booking; a basket is not a reservation/i,'The assistant shortcut preserves booking and stock safety');
    assert.equal(await client.evaluate('window.__gafferPrompt.length<=320'),true,'The prefilled prompt fits the global assistant input limit');
    assert.equal(await client.evaluate('(()=>{const box=document.querySelector("[aria-label=\'Chat notifications\']").getBoundingClientRect();return box.left>=0&&box.right<=innerWidth})()'),true,'The card fits on a phone');
    fs.writeFileSync('/tmp/dbc-chat-alert-card-mobile.png',Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false }); await wait(100);
    assert.equal(await client.evaluate('(()=>{const box=document.querySelector("[aria-label=\'Chat notifications\']").getBoundingClientRect();return box.left>=0&&box.right<=innerWidth})()'),true,'The card fits on desktop');
    fs.writeFileSync('/tmp/dbc-chat-alert-card-desktop.png',Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
    await client.evaluate('window.__alertOpened=0;window.addEventListener("dbc:open-renter-notifications",()=>window.__alertOpened++);[...document.querySelectorAll("[aria-label=\'Chat notifications\'] button")].find(button=>button.textContent==="Turn on notifications").click()'); await wait(100);
    assert.equal(await client.evaluate('window.__alertOpened'),1,'The card opens the existing notification flow');
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")'),false);
    await client.cmd("Page.reload",{});await wait(500);
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")'),false,'The invitation does not reappear after a choice');
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=2&reply=1&other=1"});await wait(500);
    assert.equal(await client.evaluate('!!document.querySelector("[aria-label=\'Chat notifications\']")'),false,'The same account is not asked again in another conversation');
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=1"});
    for(let attempt=0;attempt<100&&!await client.evaluate('!!document.querySelector("#renter-chat [data-conversation-scope]")');attempt++)await wait(50);
    await wait(500);
    const renterChatLayout=await client.evaluate(`(()=>{const chat=document.querySelector('#renter-chat'),pane=chat?.querySelector('[data-conversation-scope]'),messages=pane?.querySelector('[aria-label="Rental conversation"]'),composer=pane?.querySelector('footer'),chatBox=chat?.getBoundingClientRect(),paneBox=pane?.getBoundingClientRect(),messagesBox=messages?.getBoundingClientRect(),composerBox=composer?.getBoundingClientRect();return chatBox&&paneBox&&messagesBox&&composerBox?{viewport:innerHeight,chatBottom:chatBox.bottom,paneBottom:innerHeight-paneBox.bottom,messagesHeight:messagesBox.height,composerBottom:innerHeight-composerBox.bottom,withTools:pane.classList.contains('withTools')}:null})()`);
    assert(renterChatLayout && !renterChatLayout.withTools, 'The general renter support thread exercises the no-tools layout');
    assert(Math.abs(renterChatLayout.chatBottom-renterChatLayout.viewport)<2 && renterChatLayout.paneBottom>=10 && renterChatLayout.paneBottom<=14, 'The renter chat fills the viewport with only its intentional inner gutter');
    assert(renterChatLayout.messagesHeight>300 && renterChatLayout.composerBottom>=10 && renterChatLayout.composerBottom<=14, 'The message history expands and the composer stays at the bottom');
    fs.writeFileSync('/tmp/dbc-renter-chat-fill-desktop.png',Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
    await client.cmd("Emulation.setDeviceMetricsOverride", {width:390,height:844,deviceScaleFactor:1,mobile:true});
    await client.cmd("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/?renter=1"});
    for(let attempt=0;attempt<100&&!await client.evaluate('!!document.querySelector("#renter-chat [data-conversation-scope]")');attempt++)await wait(50);
    await wait(500);
    const renterMobileLayout=await client.evaluate(`(()=>{const pane=document.querySelector('#renter-chat [data-conversation-scope]'),composer=pane?.querySelector('footer'),messages=pane?.querySelector('[aria-label="Rental conversation"]'),paneBox=pane?.getBoundingClientRect(),composerBox=composer?.getBoundingClientRect(),messagesBox=messages?.getBoundingClientRect();return paneBox&&composerBox&&messagesBox?{viewport:innerHeight,scrollHeight:document.documentElement.scrollHeight,paneBottom:innerHeight-paneBox.bottom,composerTop:composerBox.top,composerBottom:composerBox.bottom,messagesHeight:messagesBox.height}:null})()`);
    assert(renterMobileLayout && renterMobileLayout.scrollHeight<=renterMobileLayout.viewport && renterMobileLayout.paneBottom>=0 && renterMobileLayout.paneBottom<=2, 'The renter support workspace fills the phone without page overflow');
    assert(renterMobileLayout.composerTop<renterMobileLayout.viewport && renterMobileLayout.composerBottom<=renterMobileLayout.viewport && renterMobileLayout.messagesHeight>300, 'The phone shows an anchored composer and an expanded scrollable message area');
    assert.equal(await client.evaluate(`!!document.querySelector('#renter-chat [data-renter-support="true"] button[aria-label="Notification settings"]')`),true,'The compact mobile alerts control stays accessible by name');
    fs.writeFileSync('/tmp/dbc-renter-chat-fill-mobile.png',Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
    console.log("PASS real AccountAdmin and renter conversation UI: directory/chat/action panes, bounded filters, isolated renter controls and responsive layouts. Synthetic data only.");
  } finally {
    if (client) { client.close(); try { await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`); } catch {} }
    if (chrome.exitCode === null) { const exited = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await exited; }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await wait(300); await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
