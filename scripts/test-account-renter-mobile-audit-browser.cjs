const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const membershipSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", membershipSource.slice(0, membershipSource.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);

// All account identity, booking records and listing images in this browser
// fixture are generated locally. No Convex client or production data is used.
const day = 86_400_000;
const now = Date.now();
const londonDay = Math.floor(now / day) * day;
const photo = label => label === "CAMERA" ? "/arri-deconstruct-poster.jpg" : `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#6a6258"/><stop offset="1" stop-color="#171b1d"/></linearGradient></defs><rect width="320" height="220" fill="url(#g)"/><rect x="53" y="67" width="214" height="96" rx="17" fill="#101214" stroke="#d4aa7a" stroke-width="4"/><circle cx="160" cy="115" r="40" fill="#20282c" stroke="#c3a582" stroke-width="7"/><circle cx="160" cy="115" r="18" fill="#091014" stroke="#52636b" stroke-width="4"/><text x="160" y="198" text-anchor="middle" fill="#f3dfc8" font-family="Arial" font-size="14">${label}</text></svg>`)}`;

const listings = [
  ["ARRI Alexa Mini LF cinema camera with production accessories", "CAMERA"],
  ["Sony 24–70mm f/2.8 G Master lens", "LENS"],
  ["Aputure LS 600x Pro daylight LED kit", "LIGHT"],
  ["Sennheiser MKH 416 shotgun microphone kit", "AUDIO"],
];
function booking(id, status, offset, titleSet = listings.slice(0, 2)) {
  const start = londonDay + offset * day;
  const end = start + day;
  const lineItems = titleSet.map(([title, label], index) => ({
    listingId: `synthetic-listing-${index}-${label.toLowerCase()}`,
    title,
    start,
    end,
    qty: index === 0 ? 1 : 2,
    lineTotal: 80 + index * 25,
    slug: null,
    heroImage: photo(label),
    imageSources: [],
    category: label.toLowerCase(),
  }));
  return {
    _id: `synthetic-rental-${id}-20261112`, status, lineItems,
    total: lineItems.reduce((sum, item) => sum + item.lineTotal, 0),
    subtotal: lineItems.reduce((sum, item) => sum + item.lineTotal, 0),
    discount: 0, creditApplied: 0, deliveryFee: 0, depositAmount: 0,
    depositHoldAmount: 0, securityPolicyVersion: "", currency: "GBP",
    fulfilment: "pickup", address: null, pickupTime: "10:00", returnTime: "16:00",
    idVerifyStatus: "approved", reviewed: status === "returned", firstSlug: null,
    start, end, at: start, accountId: "synthetic-account-20261112",
    hasReturnStatement: false,
  };
}
const fixtureBookings = [
  booking("active", "active", -1, listings),
  booking("upcoming", "confirmed", 4, listings.slice(0, 2)),
  booking("pending", "pending_payment", 10, listings.slice(0, 1)),
  booking("past", "returned", -80, listings.slice(1, 3)),
];
const accountFixture = {
  _id: "synthetic-account-20261112",
  name: "Alex Morgan",
  email: "alex.morgan@example.invalid",
  phone: "+44 7700 900123",
  address: "The Grand Building, Trafalgar Square, London WC2N 5EJ",
  avatarUrl: photo("A M"),
  marketingEmails: false,
  membershipActive: true,
  membershipTier: "pro",
  idVerified: true,
  storeCredit: 12.5,
  loyaltyEligible: false,
  loyaltyCompleted: 2,
  loyaltyLevel: 1,
  loyaltyPercent: 4,
  favorites: ["synthetic-favorite-20261112"],
};
const favoriteListing = { _id: "synthetic-favorite-20261112", slug: "sony-24-70-g-master", title: "Sony 24-70mm f/2.8 G Master lens" };

const stubs = `
import React from 'react';
const key = (ns, name) => String(ns)+'.'+String(name);
export const api = new Proxy({}, {get:(_,ns)=>new Proxy({}, {get:(_,name)=>key(ns,name)})});
export const getRenterNotificationStatus=()=>"unavailable";
export function dismissChatNotificationOffer(){}
export function clearChatNotificationOfferDismissal(){}
export function useQuery(ref,args){if(args==='skip')return undefined;const name=String(ref);if(name.includes('unreadTotals'))return 2;if(name.includes('referrals.mine'))return{code:'ALEXFILM10',reward:null,rewardUsed:false,rewardGranted:false,waiting:false};if(name.includes('listingsByIds'))return window.__syntheticListings;return[]}
export function useAction(){return async()=>({ok:true})}
export function useMutation(){return async()=>({ok:true})}
export function usePaginatedQuery(){return {status:'Exhausted',results:window.__syntheticBookings,loadMore:()=>{}}}
export function useAccount(){return {loading:false,me:window.__syntheticAccount,token:'synthetic-account-token',signOut:async()=>{},updateProfile:async()=>{},toggleFavorite:async()=>{}}}
export function useCreditBalance(){return window.__syntheticCreditBalance}
export function useSearchParams(){return new URLSearchParams('')}
export function Link({href='#',children,...props}){return React.createElement('a',{href,...props},children)}
export default Link;
export function SmartImage({src,fallbackSources,alt='',className='',...props}){return React.createElement('img',{src:src||fallbackSources?.[0]||'',alt,className,...props})}
export function groupOf(b){switch(b.status){case 'pending_payment':return 'pending';case 'active':return 'active';case 'confirmed':case 'pending_verification':return 'upcoming';default:return 'past'}}
export const GROUP_ORDER=['pending','active','upcoming','past'];
export const GROUP_META={pending:{label:'Needs payment',blurb:'Finish checkout'},active:{label:'Out now',blurb:'Currently with you'},upcoming:{label:'Upcoming',blurb:'Reserved rentals'},past:{label:'History',blurb:'Completed rentals'}};
export function groupRentalKit(items){const groups=new Map();for(const item of items||[]){const key=JSON.stringify([item.listingId??item.title,item.start,item.end,item.pickupTime??null,item.returnTime??null]),prior=groups.get(key);if(prior){prior.qty=(prior.qty??1)+(item.qty??1);if(item.lineTotal!=null)prior.lineTotal=(prior.lineTotal??0)+item.lineTotal;prior.imageSources=[...new Set([...(prior.imageSources??[]),...(item.imageSources??[])])]}else groups.set(key,{...item,qty:item.qty??1})}return[...groups.values()]}
export function uniqueKitPhotos(items){const seen=new Set();return items.filter(item=>{const key=JSON.stringify([item.listingId??item.title,item.start,item.end,item.pickupTime??null,item.returnTime??null]);if(seen.has(key))return false;seen.add(key);return true})}
export function groupRentalKitPhotos(items){const photos=new Map();for(const item of groupRentalKit(items)){const key=item.listingId??item.title,prior=photos.get(key);if(!prior){photos.set(key,{...item});continue}prior.qty=Math.max(prior.qty??1,item.qty??1);if(item.lineTotal!=null)prior.lineTotal=(prior.lineTotal??0)+item.lineTotal;prior.heroImage??=item.heroImage;prior.imageSources=[...new Set([...(prior.imageSources??[]),...(item.imageSources??[])])]}return[...photos.values()]}
export function londonStartOfDay(value){const d=new Date(value);const local=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);return Date.parse(local+'T00:00:00Z')}
export function fmtDate(value){return new Date(value).toLocaleDateString('en-GB',{timeZone:'Europe/London',weekday:'short',day:'numeric',month:'short'})}
export function fmtRange(a,b){return fmtDate(a)+' → '+fmtDate(b)}
export function rentalTitle(value){return value||'Rental kit'}
export function formatGbp(value){return '£'+Number(value||0).toFixed(2)}
export function rentalDays(a,b){return Math.max(1,Math.round((b-a)/86400000)+1)}
export function countdown(){return '1 day'}
export function statusMeta(status){return {label:status==='active'?'Out now':status==='pending_payment'?'Payment pending':status==='confirmed'?'Payment received':'Completed',pill:'bg-white/10 text-white',dot:'bg-white/50'}}
export function rentalStageLabel(booking){return booking.idVerifyStatus==='approved'?'Verification approved':statusMeta(booking.status).label}
export function bookingSteps(){return {cancelled:false,steps:[{label:'Booked',state:'done'},{label:'Verified',state:'done'},{label:'Pickup',state:'current'},{label:'Return',state:'todo'}]}}
export function calendarMonth(bookings,year,month){const map=new Map();for(const rental of bookings||[]){for(const line of rental.lineItems||[]){const first=new Date(line.start),last=new Date(line.end);for(let t=Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),first.getUTCDate());t<=Date.UTC(last.getUTCFullYear(),last.getUTCMonth(),last.getUTCDate());t+=86400000){const d=new Date(t);if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month)continue;const bucket=map.get(t)||[];if(!bucket.some(row=>row.rental._id===rental._id))bucket.push({rental,lines:rental.lineItems,pickup:rental.fulfilment==='pickup',returns:rental.lineItems});map.set(t,bucket)}}}return map}
export function rentalClockLabel(value){return value||'not set'}
export function isCardHoldSecurityPolicy(){return false}
export function isSetupIntentSecurityPolicy(){return false}
export function legalVersionForPolicy(){return 'synthetic-terms-v1'}
export const CURRENT_PRIVACY_NOTICE_VERSION='synthetic-privacy-v1';
export const ACCOUNT_AUTH_MESSAGES={SIGNUP_TERMS_UPDATED:'Synthetic policy changed'};
export function accountAuthErrorMessage(_error,fallback){return fallback}
export const REVIEW_PRIZE_GBP=100, TIERS=[], tierByKey=()=>({name:'Pro'});
export const AccountCreditReceipts=()=>null,ReferralPanel=()=>React.createElement('section',{ 'data-testid':'renter-referral-tile', 'aria-label':'Referral reward' },'Referral reward'),EncoreCrest=()=>null,GoogleSignIn=()=>null,GearCard=({listing})=>React.createElement('a',{href:'/gear/'+listing.slug,'data-testid':'synthetic-favorite-card'},listing.title),ChatAvatar=({photo,name})=>React.createElement('span',{className:'synthetic-avatar',role:'img','aria-label':name||'Profile'},React.createElement('img',{src:photo,alt:''})),RenterChat=()=>null,MembershipPlanCard=()=>null,AccentPicker=()=>null,CollectiveProfile=()=>null,RenterNotificationBell=()=>React.createElement('button',{type:'button','data-testid':'renter-notification-toggle','aria-label':'Rental notifications'},'Alerts'),GuestChatHandoff=()=>null,ShootLists=()=>null,InvoiceLibrary=()=>null,PrivatePortraitPreference=()=>null,SiteHeader=()=>React.createElement('header',null,'DB Cinema');
export const RentalAdditionApproval=()=>null,VerificationLink=()=>null,BookingReview=()=>null,StatusPill=({status})=>React.createElement('span',{className:'synthetic-status','data-testid':'synthetic-booking-status'},status.replaceAll('_',' ')),CancelButton=()=>null,BookingProgress=()=>null,PickupHold=()=>null,HoldRenewal=()=>null,LateFeeApproval=()=>null,AuthenticatedBookingDownload=({label})=>React.createElement('button',{type:'button'},label);
`;

const actual = {
  shell: path.join(root, "src/components/management/ManagementShell.tsx"),
  frame: path.join(root, "src/components/account/AccountFrame.tsx"),
  overview: path.join(root, "src/components/account/RenterOverview.tsx"),
  calendar: path.join(root, "src/components/account/RentalCalendar.tsx"),
  tile: path.join(root, "src/components/account/BookingTile.tsx"),
  status: path.join(root, "src/components/account/StatusPill.tsx"),
  avatarUpload: path.join(root, "src/components/account/AvatarUpload.tsx"),
  referral: path.join(root, "src/components/account/ReferralPanel.tsx"),
  notificationBell: path.join(root, "src/components/account/RenterNotificationBell.tsx"),
  rentalKit: path.join(root, "src/components/rentals/RentalKit.tsx"),
};
const actualAliases = new Map([
  ["@/components/management/ManagementShell", actual.shell],
  ["@/components/account/AccountFrame", actual.frame],
  ["@/components/account/RenterOverview", actual.overview],
  ["@/components/account/RentalCalendar", actual.calendar],
  ["@/components/account/BookingTile", actual.tile],
  ["@/components/account/StatusPill", actual.status],
  ["@/components/account/AvatarUpload", actual.avatarUpload],
  ["@/components/account/ReferralPanel", actual.referral],
  ["@/components/account/RenterNotificationBell", actual.notificationBell],
  ["@/components/rentals/RentalKit", actual.rentalKit],
]);
const plugin = {
  name: "synthetic-signed-in-account-mobile-audit",
  setup(build) {
    build.onResolve({filter:/^@\/components\//}, args => {
      const real=actualAliases.get(args.path);
      return real ? {path:real} : {path:"stubs",namespace:"synthetic"};
    });
    build.onResolve({filter:/^@\/lib\//},()=>({path:"stubs",namespace:"synthetic"}));
    build.onResolve({filter:/^@cvx\/_generated\/|^convex\/react$|^convex-helpers\/react$|^next\/link$|^next\/navigation$|^\.\.\/\.\.\/shared\/|^\.\.\/\.\.\/\.\.\/shared\//},()=>({path:"stubs",namespace:"synthetic"}));
    build.onLoad({filter:/^stubs$/,namespace:"synthetic"},()=>({loader:"jsx",resolveDir:root,contents:stubs}));
  },
};

(async()=>{
  const bundle=await esbuild.build({
    stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import AccountPage from './src/app/account/page';createRoot(document.getElementById('root')).render(<AccountPage/>);`,resolveDir:root,loader:"tsx"},
    bundle:true,write:false,outdir:"/fixture",platform:"browser",format:"iife",jsx:"automatic",tsconfig:path.join(root,"tsconfig.json"),plugins:[plugin],
    define:{"process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID":'"synthetic-client-id"',"process.env.NEXT_PUBLIC_CONVEX_URL":'"https://synthetic.invalid"'},
  });
  const js=bundle.outputFiles.find(file=>file.path.endsWith(".js"))?.text;
  const moduleCss=bundle.outputFiles.filter(file=>file.path.endsWith(".css")).map(file=>file.text).join("\n");
  assert(js,"The local account fixture bundles");
  const globalCss=await require("postcss")([require("@tailwindcss/postcss")({base:root})]).process(fs.readFileSync(path.join(root,"src/app/globals.css"),"utf8"),{from:path.join(root,"src/app/globals.css")});
  const server=http.createServer((req,res)=>{
    if(req.url==="/bundle.js"){res.setHeader("Content-Type","application/javascript");return res.end(js)}
    const pathname=new URL(req.url,"http://fixture.local").pathname;
    const asset=path.resolve(root,"public",`.${decodeURIComponent(pathname)}`);
    if(asset.startsWith(`${path.resolve(root,"public")}${path.sep}`)&&fs.existsSync(asset)&&fs.statSync(asset).isFile()){
      const contentType={".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".webp":"image/webp",".svg":"image/svg+xml",".mp4":"video/mp4"}[path.extname(asset).toLowerCase()]??"application/octet-stream";
      res.setHeader("Content-Type",contentType);return res.end(fs.readFileSync(asset));
    }
    res.setHeader("Content-Type","text/html");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${globalCss.css}\n${moduleCss}\nhtml,body,#root{min-height:100%;margin:0;background:#090909;color:#f5f1eb;font-family:Arial,sans-serif}button,input,textarea{font:inherit}img{max-width:100%}</style></head><body><script>window.__syntheticAccount=${JSON.stringify(accountFixture)};window.__syntheticCreditBalance={accountId:${JSON.stringify(accountFixture._id)},available:7.25,nextExpiry:null};window.__syntheticBookings=${JSON.stringify(fixtureBookings)};window.__syntheticListings=${JSON.stringify([favoriteListing])}</script><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),"dbc-account-renter-mobile-"));
  const chrome=spawn("/opt/google/chrome/chrome",["--headless=new","--no-sandbox","--disable-gpu","--remote-debugging-port=0",`--user-data-dir=${profile}`],{stdio:"ignore"});
  let browser;
  try{
    let port;
    for(let i=0;i<100;i++){try{port=fs.readFileSync(path.join(profile,"DevToolsActivePort"),"utf8").split("\n")[0];break}catch{await wait(100)}}
    assert(port,"Synthetic Chrome starts");
    process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;
    browser=await connect();
    await browser.cmd("Page.enable");await browser.cmd("Runtime.enable");
    await browser.cmd("Page.navigate",{url:`http://127.0.0.1:${server.address().port}`});
    const until=async(expression,label)=>{for(let i=0;i<100;i++){if(await browser.evaluate(expression))return;await wait(50)}throw Error(`Timed out: ${label}`)};
    await until(`!!document.querySelector('[data-management-role="renter"] [data-testid="renter-overview"]')`,"signed-in synthetic renter dashboard renders");
    await until(`(()=>{const image=document.querySelector('[data-testid="account-header-avatar"]');return !!image&&image.complete&&image.naturalWidth>0})()`,"account-owned renter avatar loads in the header");
    const out="/tmp/dbc-account-renter-mobile-audit";fs.mkdirSync(out,{recursive:true});
    for(const width of [320,390,430,768,1440]){
      await browser.cmd("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:width<768});await browser.evaluate(`window.scrollTo({top:0,behavior:'instant'})`);await wait(120);
      const baseline=await browser.evaluate(`(()=>{const shell=document.querySelector('[data-management-role="renter"]'),header=document.querySelector('[aria-label="Breadcrumb"]')?.parentElement,content=document.querySelector('[data-management-role="renter"] main'),overview=document.querySelector('[data-testid="renter-overview"]'),table=overview.querySelector('table'),archive=document.querySelector('[data-testid="renter-rental-history"]'),benefits=document.querySelector('[data-testid="renter-benefit-tiles"]'),credit=document.querySelector('[data-testid="account-credit-tile"]'),referral=document.querySelector('[data-testid="renter-referral-tile"]'),favourites=document.querySelector('[data-testid="renter-favourites"]'),toolbar=document.querySelector('[data-testid="renter-rental-shortcuts"]'),calendar=document.querySelector('[aria-label="Your rental calendar and messages"]'),visible=e=>!!e&&e.getBoundingClientRect().width>0,rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}},children=[...header.children].filter(visible).map(e=>({label:e.getAttribute('aria-label')||e.innerText?.trim().slice(0,30),...rect(e)})),nav=[...document.querySelectorAll('[aria-label="Account navigation"] button')].map(e=>e.textContent.trim());return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,shell:rect(shell),sidePanelCount:shell.querySelectorAll(':scope > aside').length,header:rect(header),headerChildren:children,content:rect(content),overview:rect(overview),archive:rect(archive),benefits:rect(benefits),credit:rect(credit),referral:rect(referral),favourites:rect(favourites),toolbar:rect(toolbar),calendar:calendar?rect(calendar):null,nav,tables:[...overview.querySelectorAll('table')].map(table=>({box:rect(table),cells:[...table.querySelectorAll('tbody td')].map(rect)})),photos:[...overview.querySelectorAll('img')].map(img=>({alt:img.alt,src:img.getAttribute('src'),width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height,naturalWidth:img.naturalWidth,loaded:img.complete&&img.naturalWidth>0})),menuButton:rect(document.querySelector('[aria-label="Toggle account menu"]'))}})()`);
      assert(baseline.scrollWidth<=width,`Renter rentals page fits ${width}px with no horizontal page overflow: ${JSON.stringify(baseline)}`);
      const breadcrumb=await browser.evaluate(`(()=>{const nav=document.querySelector('[aria-label="Breadcrumb"]'),current=nav?.querySelector('[aria-current="page"]');return{visible:!!nav&&nav.getBoundingClientRect().width>0,current:current?.textContent?.trim(),currentFits:!!current&&current.scrollWidth<=current.clientWidth,navWidth:nav?.clientWidth,currentWidth:current?.clientWidth,currentScrollWidth:current?.scrollWidth}})()`);
      assert(breadcrumb.visible&&breadcrumb.currentFits,`The sticky account breadcrumb stays readable at ${width}px: ${JSON.stringify(breadcrumb)}`);
      assert(baseline.headerChildren.every((item,index)=>index===0||baseline.headerChildren[index-1].right<=item.left+1),`Header logo, breadcrumb and actions do not overlap at ${width}px: ${JSON.stringify(baseline.headerChildren)}`);
      for(const [name,box] of [["header",baseline.header],["content",baseline.content],["benefit tiles",baseline.benefits],["account credit",baseline.credit],["referral",baseline.referral],["rentals",baseline.overview],["history",baseline.archive],["favourites",baseline.favourites]])assert(box&&box.left>=-1&&box.right<=width+1,`${name} stays within ${width}px: ${JSON.stringify(box)}`);
      assert(!baseline.calendar,"The duplicate right-side rental calendar is removed from My rentals");
      assert.equal(baseline.sidePanelCount,1,"My rentals keeps its left navigation and has no unwanted right-side panel");
      assert(baseline.benefits.top<baseline.overview.top&&baseline.credit.top===baseline.benefits.top,"Credit, Encore and referral tiles appear above rentals");
      const benefitTiles=await browser.evaluate(`(()=>{const root=document.querySelector('[data-testid="renter-benefit-tiles"]'),cards=[...root.children].map(e=>({height:e.getBoundingClientRect().height,testId:e.getAttribute('data-testid')||e.querySelector('[data-testid]')?.getAttribute('data-testid')})),referral=root.querySelector('[data-testid="renter-referral-tile"]'),copy=referral?.querySelector('[data-testid="copy-referral-code"]'),encore=root.querySelector('[data-testid="account-encore-tile"]'),typeSize=selector=>Number.parseFloat(getComputedStyle(root.querySelector(selector)).fontSize);return{cards,referralHeight:referral?.getBoundingClientRect().height,referralCode:referral?.textContent?.includes('ALEXFILM10')&&!!copy&&!copy.disabled,referralSummary:referral?.querySelector('[data-testid="referral-benefit-summary"]')?.textContent?.trim(),creditTitle:root.querySelector('[data-testid="account-credit-tile"]')?.querySelector('p')?.textContent?.trim(),creditSummary:root.querySelector('[data-testid="account-credit-summary"]')?.textContent?.trim(),encoreProgress:encore?.querySelector('[data-testid="account-encore-progress"]')?.textContent?.trim(),encoreSummary:encore?.querySelector('[data-testid="account-encore-summary"]')?.textContent?.trim(),encoreAccessibleLabel:encore?.getAttribute('aria-label'),summarySizes:[typeSize('[data-testid="account-credit-summary"]'),typeSize('[data-testid="account-encore-summary"]'),typeSize('[data-testid="referral-benefit-summary"]')],loading:referral?.textContent?.includes('Creating code')}})()`);
      assert.equal(await browser.evaluate(`document.querySelector('[data-testid="account-credit-balance"]')?.textContent`),"£7.25",`The wallet tile shows the live, expiry-aware balance rather than the cached profile snapshot at ${width}px`);
      assert(benefitTiles.cards.length===3&&benefitTiles.cards.every(card=>card.height<=180)&&benefitTiles.referralHeight<=180,`Credit, Encore and referral remain compact tiles at ${width}px: ${JSON.stringify(benefitTiles)}`);
      assert(benefitTiles.creditTitle==="Account credit"&&benefitTiles.creditSummary.includes("Earned credit competes")&&benefitTiles.creditSummary.includes("Refund credit can pay")&&benefitTiles.creditSummary.includes("Check each credit’s expiry")&&benefitTiles.encoreProgress==="2 / 3 reviewed rentals"&&benefitTiles.encoreAccessibleLabel.includes("Encore II")&&benefitTiles.encoreSummary.includes("10%")&&benefitTiles.referralSummary.includes("first rental")&&benefitTiles.referralSummary.includes("40% off your next")&&benefitTiles.referralSummary.includes("paid, verified"),`Reward tiles show concise, accurate credit, Encore and referral rules at ${width}px: ${JSON.stringify(benefitTiles)}`);
      assert(benefitTiles.summarySizes.every(size=>size>=11),`Reward guidance remains readable at ${width}px: ${JSON.stringify(benefitTiles.summarySizes)}`);
      assert(benefitTiles.referralCode&&!benefitTiles.loading,`The referral tile shows its loaded invite-code state at ${width}px: ${JSON.stringify(benefitTiles)}`);
      assert(baseline.favourites.top>baseline.overview.top,"Favourites remain at the bottom of My rentals");
      const favourite=await browser.evaluate(`(()=>{const section=document.querySelector('[data-testid="renter-favourites"]'),card=section?.querySelector('[data-testid="synthetic-favorite-card"]');return{sectionTitle:section?.querySelector('h2')?.textContent?.trim(),title:card?.textContent?.trim(),href:card?.getAttribute('href')}})()`);
      assert.deepEqual(favourite,{sectionTitle:"Favourites",title:"Sony 24-70mm f/2.8 G Master lens",href:"/gear/sony-24-70-g-master"},`Saved favorites render under My rentals at ${width}px: ${JSON.stringify(favourite)}`);
      assert(baseline.toolbar.top>=baseline.benefits.bottom-1,"Rental shortcuts sit below the rewards row without overlapping it");
      assert(baseline.nav.includes("Profile")&&!baseline.nav.some(label=>/membership|security|shoot lists/i.test(label)),"Membership, security and shot lists are removed from the side menu");
      assert.equal(await browser.evaluate(`document.querySelector('[data-management-role="renter"]')?.getAttribute('data-management-role')`),"renter",`The customer workspace keeps renter-only presentation at ${width}px`);
      assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid^="admin-account-"],[data-testid^="admin-profile-"],[data-testid^="admin-verification-"]').length`),0,`Admin-only account controls stay out of the renter page at ${width}px`);
      assert(await browser.evaluate(`!!document.querySelector('[data-testid="renter-notification-toggle"]')`),"Notification control remains available in the account top bar");
      assert(await browser.evaluate(`(()=>{const image=document.querySelector('[data-testid="account-top-actions"] [aria-label="Open profile"] img');return !!image&&image.complete&&image.naturalWidth>0})()`),`The authenticated account photo appears in the profile shortcut at ${width}px`);
      assert(await browser.evaluate(`!!document.querySelector('[aria-label="Breadcrumb"]')&&getComputedStyle(document.querySelector('[aria-label="Breadcrumb"]')?.closest('header')?.parentElement).position==='sticky'`),"The account breadcrumb remains in the sticky top bar");
      const shortcuts=await browser.evaluate(`(()=>{const root=document.querySelector('[data-testid="account-top-actions"]'),r=e=>{const b=e.getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}},items=[...root.children].map(e=>({label:e.getAttribute('aria-label'),...r(e)})),credit=root.querySelector('[data-testid="account-credit-shortcut"]');return{items,gear:!!root.querySelector('[aria-label="Browse gear"]'),profile:!!root.querySelector('[aria-label="Open profile"]'),notifications:!!root.querySelector('[data-testid="renter-notification-toggle"]'),credit:credit?.textContent.trim(),creditLabel:credit?.getAttribute('aria-label')}})()`);
      assert(shortcuts.gear&&shortcuts.profile&&shortcuts.notifications&&shortcuts.credit===`£${(7.25).toFixed(2)}`&&shortcuts.creditLabel.includes("£7.25"),`Top bar exposes gear, profile, notifications, and the live credit balance at ${width}px: ${JSON.stringify(shortcuts)}`);
      assert(shortcuts.items.every((item,index,list)=>item.left>=-1&&item.right<=width+1&&list.slice(index+1).every(other=>item.right<=other.left+1||other.right<=item.left+1)),`Top bar shortcuts fit without overlap at ${width}px: ${JSON.stringify(shortcuts.items)}`);
      await browser.evaluate(`document.querySelector('[data-testid="renter-notification-toggle"]')?.click()`);
      await until(`document.querySelector('[data-testid="renter-notification-toggle"]')?.getAttribute('aria-expanded')==='true'&&!!document.querySelector('#renter-notification-settings')`,`notification toggle opens its account settings at ${width}px`);
      await browser.evaluate(`document.querySelector('[data-testid="renter-notification-toggle"]')?.click()`);
      assert(baseline.headerChildren.every((node,index,list)=>list.slice(index+1).every(other=>node.right<=other.left+1||other.right<=node.left+1||node.width===0||other.width===0)),`Account header controls do not overlap at ${width}px: ${JSON.stringify(baseline.headerChildren)}`);
      assert(baseline.tables.every(table=>table.box.left>=-1&&table.box.right<=width+1&&table.cells.every(cell=>cell.left>=-1&&cell.right<=width+1)),`Rental history table cells stay inside the viewport at ${width}px: ${JSON.stringify(baseline.tables)}`);
      assert(baseline.photos.filter(image=>image.width>0).length>=3&&baseline.photos.filter(image=>image.width>0).every(image=>image.height>0&&image.loaded),`Synthetic rental images load at ${width}px: ${JSON.stringify(baseline.photos)}`);
      assert(baseline.photos.some(image=>image.alt.includes("ARRI Alexa Mini LF")&&image.src==="/arri-deconstruct-poster.jpg"&&image.loaded&&image.naturalWidth>0),`The camera listing uses its real local product photograph rather than a category illustration at ${width}px: ${JSON.stringify(baseline.photos)}`);
      if(width>=1100){const beforeHover=await browser.evaluate(`(()=>{const root=document.querySelector('[data-testid="renter-overview"]'),image=root?.querySelector('img'),card=image?.closest('article'),r=card?.getBoundingClientRect(),photo=image?.getBoundingClientRect();return{point:photo?{x:photo.x+photo.width/2,y:photo.y+photo.height/2}:null,card:r?{width:r.width,height:r.height}:null,src:image?.getAttribute('src'),className:image?.className,loaded:!!image&&image.complete&&image.naturalWidth>0}})()`);assert(beforeHover.point&&beforeHover.loaded,`Featured rental has a loaded real listing photo before hover: ${JSON.stringify({beforeHover,photos:baseline.photos})}`);await browser.cmd("Input.dispatchMouseEvent",{type:"mouseMoved",...beforeHover.point});await wait(180);const afterHover=await browser.evaluate(`(()=>{const image=document.querySelector('[data-testid="renter-overview"] img'),card=image?.closest('article'),r=card?.getBoundingClientRect(),photo=image?.getBoundingClientRect(),style=image&&getComputedStyle(image);return{card:r?{width:r.width,height:r.height}:null,photo:photo?{width:photo.width,height:photo.height}:null,loaded:!!image&&image.complete&&image.naturalWidth>0,opacity:style?.opacity,visibility:style?.visibility}})()`);assert(afterHover.loaded&&afterHover.photo.width>0&&afterHover.photo.height>0&&afterHover.opacity!=="0"&&afterHover.visibility==="visible"&&afterHover.card.width===beforeHover.card.width&&afterHover.card.height===beforeHover.card.height,`Hover keeps the real rental photo visible without jumping the tile layout: ${JSON.stringify({beforeHover,afterHover})}`);await browser.cmd("Input.dispatchMouseEvent",{type:"mouseMoved",x:1,y:1});}
      if(width>=1100){await until(`(()=>{const image=document.querySelector('img[src="/arri-deconstruct-poster.jpg"]');return !!image&&image.complete&&image.naturalWidth>0})()`,"real account sidebar brand image loads");assert(await browser.evaluate(`(()=>{const image=document.querySelector('img[src="/arri-deconstruct-poster.jpg"]');return !!image&&image.naturalWidth===1920&&image.naturalHeight===1080})()`),"The real management brand image loads from its existing public asset");}
      const rentalShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`account-rentals-${width}.png`),Buffer.from(rentalShot.data,"base64"));
      await browser.evaluate(`document.querySelector('[data-testid="renter-overview"] table')?.closest('section')?.parentElement?.scrollIntoView({block:'start',behavior:'instant'})`);await wait(100);
      const pinnedBar=await browser.evaluate(`(()=>{const bar=document.querySelector('[aria-label="Breadcrumb"]')?.parentElement,rect=bar?.getBoundingClientRect();return{scrollY,top:rect?.top,bottom:rect?.bottom,height:rect?.height}})()`);
      assert(pinnedBar.scrollY>0&&Math.abs(pinnedBar.top)<1&&pinnedBar.bottom>0,`Account top bar stays pinned and usable while scrolling at ${width}px: ${JSON.stringify(pinnedBar)}`);
      const historyGeometry=await browser.evaluate(`(()=>{const section=document.querySelector('[data-testid="renter-overview"] table')?.closest('section')?.parentElement,r=section.getBoundingClientRect(),rows=[...section.querySelectorAll('tbody tr')].map(row=>{const rowRect=row.getBoundingClientRect(),cells=[...row.querySelectorAll('td')].map(cell=>{const c=cell.getBoundingClientRect(),range=document.createRange(),title=cell.querySelector('button span');range.selectNodeContents(cell);const text=[...range.getClientRects()].map(x=>({left:x.left,right:x.right,top:x.top,bottom:x.bottom})),titleRect=title?.getBoundingClientRect(),titleClip=title?{left:titleRect.left,right:titleRect.right,top:titleRect.top,bottom:titleRect.bottom,height:titleRect.height,overflow:getComputedStyle(title).overflow,textOverflow:getComputedStyle(title).textOverflow,lineClamp:getComputedStyle(title).webkitLineClamp,scrollHeight:title.scrollHeight,clientHeight:title.clientHeight}:null;return{left:c.left,right:c.right,top:c.top,bottom:c.bottom,text,titleClip}});return{display:getComputedStyle(row).display,left:rowRect.left,right:rowRect.right,top:rowRect.top,bottom:rowRect.bottom,height:rowRect.height,cells}});return{top:r.top,bottom:r.bottom,width:r.width,rows,scrollWidth:document.documentElement.scrollWidth}})()`);
      assert(historyGeometry.scrollWidth<=width,`History view remains within ${width}px after scrolling`);
      const historyShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`account-history-${width}.png`),Buffer.from(historyShot.data,"base64"));
      const historyRowsFit=historyGeometry.rows.every(row=>{
        if(row.left< -1||row.right>width+1)return false;
        return row.cells.every(cell=>{
          if(cell.left<row.left-1||cell.right>row.right+1)return false;
          return cell.text.every(line=>{
            const inside=line.left>=cell.left-1&&line.right<=cell.right+1;
            const clippedTitle=cell.titleClip&&cell.titleClip.left>=cell.left-1&&cell.titleClip.right<=cell.right+1&&cell.titleClip.overflow==='hidden'&&cell.titleClip.textOverflow==='ellipsis';
            return inside||clippedTitle;
          });
        });
      });
      assert(historyRowsFit,`History rows and labels stay in their card/table bounds at ${width}px: ${JSON.stringify(historyGeometry)}`);
      if(width<900){
        assert(historyGeometry.rows.every(row=>row.display==='grid'&&row.height<=150),`Narrow history uses compact rental cards rather than cramped tables at ${width}px: ${JSON.stringify(historyGeometry.rows.map(row=>({display:row.display,height:row.height})))}`);
        assert(historyGeometry.rows.every(row=>{const title=row.cells[0]?.titleClip;return title&&title.height<=38&&title.lineClamp==='2'}),`Narrow rental titles use a readable two-line clamp at ${width}px: ${JSON.stringify(historyGeometry.rows.map(row=>row.cells[0]?.titleClip))}`);
      }else assert(historyGeometry.rows.every(row=>row.display==='table-row'),`Tablet and desktop-width history preserves its table layout at ${width}px`);
      if(width<640){
        await browser.evaluate(`document.querySelector('[aria-label="Toggle account menu"]')?.click()`);
        await until(`document.querySelector('[aria-label="Toggle account menu"]')?.getAttribute('aria-expanded')==='true'`,`mobile account menu opens at ${width}px`);
        assert(await browser.evaluate(`(()=>{const action=document.querySelector('[data-testid="account-menu-signout"]');return !!action&&action.getBoundingClientRect().height>=44&&getComputedStyle(document.querySelector('[data-testid="account-top-signout"]')).display==='none'})()`),"Mobile sign-out stays reachable in the drawer while the sticky bar prioritizes gear, profile, credit, and notifications");
      }
      const scrollBeforeProfile=await browser.evaluate(`window.scrollY`);
      assert(scrollBeforeProfile>0,`Profile navigation starts from a scrolled rental view at ${width}px`);
      await browser.evaluate(`(()=>[...document.querySelectorAll('[aria-label="Account navigation"] button')].find(button=>button.innerText.trim()==='Profile'))()?.click()`);
      await until(`!!(document.querySelector('[data-management-role="renter"][data-management-screen="profile"]')&&document.querySelector('.account-profile-pill')&&document.querySelector('input[aria-label="Name"]'))`,"profile tab renders");
      await until(`window.scrollY===0`,`profile tab resets to the top of the account at ${width}px`);
      assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-management-role="renter"] main h1,[data-management-role="renter"] main h2')].filter(node=>node.textContent.trim()==='Profile').length`),1,"Profile screen has one clear page title, not a duplicate details heading");
      assert(await browser.evaluate(`!!document.querySelector('[data-testid="profile-membership-settings"]')&&!!document.querySelector('[data-testid="profile-security-settings"]')`),"Membership and security controls are consolidated into Profile");
      const profileSettingsOrder=await browser.evaluate(`(()=>{const root=document.querySelector('[data-management-role="renter"] .tab-in'),settings=root?.querySelector('[data-testid="profile-membership-security"]'),membership=settings?.querySelector('[data-testid="profile-membership-settings"]'),security=settings?.querySelector('[data-testid="profile-security-settings"]'),details=root?.querySelector('[aria-label="Profile details"]'),before=(first,last)=>!!first&&!!last&&Boolean(first.compareDocumentPosition(last)&Node.DOCUMENT_POSITION_FOLLOWING);return{settingsFirst:root?.firstElementChild===settings,membershipBeforeDetails:before(membership,details),securityBeforeDetails:before(security,details),membershipBeforeSecurity:before(membership,security)}})()`);
      assert(profileSettingsOrder.settingsFirst&&profileSettingsOrder.membershipBeforeDetails&&profileSettingsOrder.securityBeforeDetails&&profileSettingsOrder.membershipBeforeSecurity,`Membership and security are the first Profile controls, ahead of the longer profile form: ${JSON.stringify(profileSettingsOrder)}`);
      await until(`(()=>{const image=document.querySelector('[aria-label="Change profile photo"] img');return !!image&&image.complete&&image.naturalWidth>0})()`,`account-owned profile photo loads at ${width}px`);
      const avatarBeforeHover=await browser.evaluate(`(()=>{const button=document.querySelector('[aria-label="Change profile photo"]'),image=button?.querySelector('img'),buttonRect=button?.getBoundingClientRect(),imageRect=image?.getBoundingClientRect();return{point:buttonRect?{x:buttonRect.x+buttonRect.width/2,y:buttonRect.y+buttonRect.height/2}:null,button:buttonRect?{width:buttonRect.width,height:buttonRect.height}:null,image:imageRect?{width:imageRect.width,height:imageRect.height}:null,loaded:!!image&&image.complete&&image.naturalWidth>0,src:image?.getAttribute('src')}})()`);
      assert(avatarBeforeHover.point&&avatarBeforeHover.loaded&&avatarBeforeHover.image.width>0&&avatarBeforeHover.image.height>0,`Account-owned profile photo has a real rendered image at ${width}px: ${JSON.stringify(avatarBeforeHover)}`);
      await browser.cmd("Input.dispatchMouseEvent",{type:"mouseMoved",...avatarBeforeHover.point});await wait(180);
      const avatarAfterHover=await browser.evaluate(`(()=>{const button=document.querySelector('[aria-label="Change profile photo"]'),image=button?.querySelector('img'),cue=button?.querySelector('[data-testid="profile-photo-hover-cue"]'),buttonRect=button?.getBoundingClientRect(),cueRect=cue?.getBoundingClientRect(),style=image&&getComputedStyle(image);return{loaded:!!image&&image.complete&&image.naturalWidth>0,visibility:style?.visibility,opacity:style?.opacity,button:buttonRect?{width:buttonRect.width,height:buttonRect.height}:null,cueAreaRatio:cueRect&&buttonRect?cueRect.width*cueRect.height/(buttonRect.width*buttonRect.height):1,cueDisplay:cue&&getComputedStyle(cue).display}})()`);
      assert(avatarAfterHover.loaded&&avatarAfterHover.visibility==="visible"&&avatarAfterHover.opacity!=="0"&&avatarAfterHover.cueDisplay!=="none"&&avatarAfterHover.cueAreaRatio<=.18&&avatarAfterHover.button.width===avatarBeforeHover.button.width&&avatarAfterHover.button.height===avatarBeforeHover.button.height,`Hover preserves the full photo and stable avatar geometry at ${width}px: ${JSON.stringify({avatarBeforeHover,avatarAfterHover})}`);
      if(width>=1100){const avatarShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`account-profile-avatar-hover-${width}.png`),Buffer.from(avatarShot.data,"base64"));await browser.evaluate(`(()=>{const image=document.querySelector('[aria-label="Change profile photo"] img');if(image)image.src='/missing-profile-avatar.png'})()`);await until(`(()=>{const button=document.querySelector('[aria-label="Change profile photo"]');return !!button&&!button.querySelector('img')&&button.textContent.includes('AM')})()`,"broken profile photo falls back to account initials");assert(await browser.evaluate(`(()=>{const button=document.querySelector('[aria-label="Change profile photo"]'),cue=button?.querySelector('[data-testid="profile-photo-hover-cue"]');return !!button&&!!cue&&getComputedStyle(cue).display!=='none'&&getComputedStyle(cue).visibility==='visible'})()`),"Broken image fallback leaves the photo-change affordance usable");}
      await browser.cmd("Input.dispatchMouseEvent",{type:"mouseMoved",x:1,y:1});
      assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid="profile-membership-settings"]').length`),1,"Membership has one Profile control, with no duplicate membership screen");
      assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid="profile-security-settings"]').length`),1,"Security has one Profile control, with no duplicate security screen");
      assert.equal(await browser.evaluate(`document.querySelector('[data-management-role="renter"]')?.querySelectorAll(':scope > aside').length`),1,"Profile retains only its left navigation rail, with no extra right-side panel");
      assert.equal(await browser.evaluate(`/shot\s*lists/i.test(document.querySelector('[data-management-role="renter"]')?.innerText||'')`),false,"Shot Lists are removed from the renter account workspace");
      assert(await browser.evaluate(`![...document.querySelector('.account-profile-pill')?.querySelectorAll('span')??[]].some(node=>/£\\d+(?:\\.\\d+)? credit/i.test(node.textContent||''))`),"Available credit is shown once in My rentals, not repeated as a stale profile badge");
      await wait(80);
      const profileGeometry=await browser.evaluate(`(()=>{const header=document.querySelector('[aria-label="Breadcrumb"]')?.parentElement,content=document.querySelector('[data-management-role="renter"] main'),pill=document.querySelector('.account-profile-pill'),form=document.querySelector('.tab-in'),inputs=[...form.querySelectorAll('input,textarea,button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return{label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,24),left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}),visible=e=>!!e&&e.getBoundingClientRect().width>0,rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}},children=[...header.children].filter(visible).map(e=>({label:e.getAttribute('aria-label')||e.innerText?.trim().slice(0,30),...rect(e)}));return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,header:rect(header),headerChildren:children,content:rect(content),pill:rect(pill),form:rect(form),sections:[...form.querySelectorAll(':scope > section')].map(rect),inputs}})()`);
      assert(profileGeometry.scrollWidth<=width,`Profile page fits ${width}px with no horizontal overflow: ${JSON.stringify(profileGeometry)}`);
      assert(profileGeometry.pill.top>=profileGeometry.header.bottom-1,`Profile identity starts below the sticky account header after tab navigation at ${width}px: ${JSON.stringify(profileGeometry)}`);
      for(const [name,box]of [["profile header",profileGeometry.header],["profile content",profileGeometry.content],["profile identity",profileGeometry.pill],["profile form",profileGeometry.form],...profileGeometry.sections.map((box,index)=>[`profile section ${index+1}`,box])])assert(box&&box.left>=-1&&box.right<=width+1,`${name} stays inside ${width}px: ${JSON.stringify(box)}`);
      assert(profileGeometry.headerChildren.every((node,index,list)=>list.slice(index+1).every(other=>node.right<=other.left+1||other.right<=node.left+1||node.width===0||other.width===0)),`Profile header controls do not overlap at ${width}px: ${JSON.stringify(profileGeometry.headerChildren)}`);
      assert(profileGeometry.inputs.every(input=>input.left>=-1&&input.right<=width+1&&input.width>0&&input.height>0),`Profile inputs and buttons remain fully visible at ${width}px: ${JSON.stringify(profileGeometry.inputs)}`);
      const profileShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`account-profile-${width}.png`),Buffer.from(profileShot.data,"base64"));
      await browser.evaluate(`document.querySelector('[data-testid="profile-membership-settings"] summary')?.click()`);
      assert(await browser.evaluate(`document.querySelector('[data-testid="profile-membership-settings"]')?.open===true`),"Membership settings expand from Profile");
      await browser.evaluate(`document.querySelector('[data-testid="profile-security-settings"] summary')?.click()`);
      assert(await browser.evaluate(`document.querySelector('[data-testid="profile-security-settings"]')?.open===true`),"Security settings expand from Profile");
      await browser.evaluate(`document.querySelector('[data-testid="profile-security-settings"]')?.removeAttribute('open');history.replaceState(null,'',location.pathname);location.hash='security'`);
      await until(`document.querySelector('[data-testid="profile-security-settings"]')?.open===true`,"Legacy security links open the consolidated Profile settings");
      await browser.evaluate(`document.querySelector('[data-testid="account-credit-shortcut"]')?.click()`);
      await until(`document.querySelector('[data-management-role="renter"][data-management-screen="rentals"]')&&!!document.querySelector('#credits')`,"Top-bar credit shortcut opens My rentals");
      assert.equal(await browser.evaluate(`location.hash`),"#credits",`The credit shortcut keeps its deep link in sync at ${width}px`);
      await until(`(()=>{const tile=document.querySelector('#credits')?.getBoundingClientRect();return !!tile&&tile.top<innerHeight&&tile.bottom>0})()`,"Credit tile is brought into view from the top bar");
      assert.equal(await browser.evaluate(`document.querySelector('[data-testid="account-credit-tile"] [data-testid="account-credit-balance"]')?.textContent`),"£7.25","The top-bar credit shortcut lands on the authoritative account balance tile");
      await browser.evaluate(`(()=>[...document.querySelectorAll('[aria-label="Account navigation"] button')].find(button=>button.innerText.trim()==='Profile'))()?.click()`);
      await until(`!!document.querySelector('[data-management-role="renter"][data-management-screen="profile"]')`,"Profile navigation restores the profile section");
      assert.equal(await browser.evaluate(`location.hash`),"#profile",`The selected profile section is refreshable at ${width}px`);
      await browser.evaluate(`document.querySelector('[aria-label="Breadcrumb"] button')?.click()`);
      await until(`!!document.querySelector('[data-management-role="renter"][data-management-screen="rentals"]')`,"Account breadcrumb returns to My rentals");
      assert.equal(await browser.evaluate(`location.hash`),"#rentals",`The clickable Account breadcrumb clears stale profile links at ${width}px`);
      await browser.evaluate(`history.back()`);
      await until(`location.hash==='#profile'&&!!document.querySelector('[data-management-role="renter"][data-management-screen="profile"]')`,"Browser back restores the previous account section");
      await browser.evaluate(`history.forward()`);
      await until(`location.hash==='#rentals'&&!!document.querySelector('[data-management-role="renter"][data-management-screen="rentals"]')`,"Browser forward restores My rentals");
      if(width===1440){
        await browser.evaluate(`document.querySelector('[data-testid="account-header-avatar"]').src='/missing-account-avatar.png'`);
        await until(`!document.querySelector('[data-testid="account-header-avatar"]')`,"Broken account avatar falls back to initials");
        assert.equal(await browser.evaluate(`document.querySelector('[data-testid="account-header-avatar-wrap"]')?.textContent?.trim()`),"A","A failed profile image keeps a readable account identity");
      }
      console.log(`PASS synthetic renter account ${width}px: rentals/history/profile fit, no overlap or horizontal overflow`);
      if(width<640){
        await browser.evaluate(`document.querySelector('[aria-label="Toggle account menu"]')?.click()`);
        await until(`document.querySelector('[aria-label="Toggle account menu"]')?.getAttribute('aria-expanded')==='true'`,`account menu reopens at ${width}px`);
      }
      await browser.evaluate(`(()=>[...document.querySelectorAll('[aria-label="Account navigation"] button')].find(button=>button.innerText.trim()==='My rentals'))()?.click()`);
      await until(`!!document.querySelector('[data-testid="renter-overview"]')`,`rental view restored at ${width}px`);
      await browser.evaluate(`window.scrollTo({top:0,behavior:'instant'})`);
      await wait(80);
    }
    console.log(`Screenshots: ${out}`);
  }finally{
    if(browser){browser.close();await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(()=>{})}
    if(chrome.exitCode===null){const done=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill();await done}
    await new Promise(resolve=>server.close(resolve));await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
})().catch(error=>{console.error(error.stack??error);process.exitCode=1});
