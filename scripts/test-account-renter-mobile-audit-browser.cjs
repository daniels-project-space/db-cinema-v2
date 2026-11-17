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
const photo = label => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#6a6258"/><stop offset="1" stop-color="#171b1d"/></linearGradient></defs><rect width="320" height="220" fill="url(#g)"/><rect x="53" y="67" width="214" height="96" rx="17" fill="#101214" stroke="#d4aa7a" stroke-width="4"/><circle cx="160" cy="115" r="40" fill="#20282c" stroke="#c3a582" stroke-width="7"/><circle cx="160" cy="115" r="18" fill="#091014" stroke="#52636b" stroke-width="4"/><text x="160" y="198" text-anchor="middle" fill="#f3dfc8" font-family="Arial" font-size="14">${label}</text></svg>`)}`;

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
  favorites: [],
};

const stubs = `
import React from 'react';
const key = (ns, name) => String(ns)+'.'+String(name);
export const api = new Proxy({}, {get:(_,ns)=>new Proxy({}, {get:(_,name)=>key(ns,name)})});
export function useQuery(ref,args){if(args==='skip')return undefined;return String(ref).includes('unreadTotals')?2:[]}
export function useAction(){return async()=>({ok:true})}
export function useMutation(){return async()=>({ok:true})}
export function usePaginatedQuery(){return {status:'Exhausted',results:window.__syntheticBookings,loadMore:()=>{}}}
export function useAccount(){return {loading:false,me:window.__syntheticAccount,token:'synthetic-account-token',signOut:async()=>{},updateProfile:async()=>{},toggleFavorite:async()=>{}}}
export function useSearchParams(){return new URLSearchParams('')}
export function Link({href='#',children,...props}){return React.createElement('a',{href,...props},children)}
export default Link;
export function SmartImage({src,fallbackSources,alt='',className='',...props}){return React.createElement('img',{src:src||fallbackSources?.[0]||'',alt,className,...props})}
export function groupOf(b){switch(b.status){case 'pending_payment':return 'pending';case 'active':return 'active';case 'confirmed':case 'pending_verification':return 'upcoming';default:return 'past'}}
export const GROUP_ORDER=['pending','active','upcoming','past'];
export const GROUP_META={pending:{label:'Needs payment',blurb:'Finish checkout'},active:{label:'Out now',blurb:'Currently with you'},upcoming:{label:'Upcoming',blurb:'Reserved rentals'},past:{label:'History',blurb:'Completed rentals'}};
export function groupRentalKit(items){return (items||[]).map(item=>({...item,qty:item.qty??1}))}
export function uniqueKitPhotos(items){const seen=new Set();return items.filter(item=>{const k=item.heroImage||item.listingId;if(seen.has(k))return false;seen.add(k);return true})}
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
export const AccountCreditReceipts=()=>null,ReferralPanel=()=>null,EncoreCrest=()=>null,GoogleSignIn=()=>null,GearCard=()=>null,ChatAvatar=({photo,name})=>React.createElement('span',{className:'synthetic-avatar',role:'img','aria-label':name||'Profile'},React.createElement('img',{src:photo,alt:''})),RenterChat=()=>null,MembershipPlanCard=()=>null,AccentPicker=()=>null,CollectiveProfile=()=>null,RenterNotificationBell=()=>null,ShootLists=()=>null,InvoiceLibrary=()=>null,PrivatePortraitPreference=()=>null,SiteHeader=()=>React.createElement('header',null,'DB Cinema');
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
    res.setHeader("Content-Type","text/html");
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${globalCss.css}\n${moduleCss}\nhtml,body,#root{min-height:100%;margin:0;background:#090909;color:#f5f1eb;font-family:Arial,sans-serif}button,input,textarea{font:inherit}img{max-width:100%}</style></head><body><script>window.__syntheticAccount=${JSON.stringify(accountFixture)};window.__syntheticBookings=${JSON.stringify(fixtureBookings)}</script><div id="root"></div><script src="/bundle.js"></script></body></html>`);
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
    const out="/tmp/dbc-account-renter-mobile-audit";fs.mkdirSync(out,{recursive:true});
    for(const width of [320,390,430,768]){
      await browser.cmd("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:width<768});await wait(120);
      const baseline=await browser.evaluate(`(()=>{const shell=document.querySelector('[data-management-role="renter"]'),header=document.querySelector('[aria-label="Breadcrumb"]')?.parentElement,content=document.querySelector('[data-management-role="renter"] main'),overview=document.querySelector('[data-testid="renter-overview"]'),table=overview.querySelector('table'),archive=table?.closest('section')?.parentElement,calendar=document.querySelector('[aria-label="Your rental calendar and messages"]'),visible=e=>!!e&&e.getBoundingClientRect().width>0,rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}},children=[...header.children].filter(visible).map(e=>({label:e.getAttribute('aria-label')||e.innerText?.trim().slice(0,30),...rect(e)}));return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,shell:rect(shell),header:rect(header),headerChildren:children,content:rect(content),overview:rect(overview),archive:rect(archive),calendar:rect(calendar),tables:[...overview.querySelectorAll('table')].map(table=>({box:rect(table),cells:[...table.querySelectorAll('tbody td')].map(rect)})),photos:[...overview.querySelectorAll('img')].map(img=>({alt:img.alt,width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height,loaded:img.complete&&img.naturalWidth>0})),menuButton:rect(document.querySelector('[aria-label="Toggle account menu"]'))}})()`);
      assert(baseline.scrollWidth<=width,`Renter rentals page fits ${width}px with no horizontal page overflow: ${JSON.stringify(baseline)}`);
      for(const [name,box] of [["header",baseline.header],["content",baseline.content],["rentals",baseline.overview],["history",baseline.archive],["calendar",baseline.calendar]])assert(box&&box.left>=-1&&box.right<=width+1,`${name} stays within ${width}px: ${JSON.stringify(box)}`);
      assert(baseline.headerChildren.every((node,index,list)=>list.slice(index+1).every(other=>node.right<=other.left+1||other.right<=node.left+1||node.width===0||other.width===0)),`Account header controls do not overlap at ${width}px: ${JSON.stringify(baseline.headerChildren)}`);
      assert(baseline.tables.every(table=>table.box.left>=-1&&table.box.right<=width+1&&table.cells.every(cell=>cell.left>=-1&&cell.right<=width+1)),`Rental history table cells stay inside the viewport at ${width}px: ${JSON.stringify(baseline.tables)}`);
      assert(baseline.photos.filter(image=>image.width>0).length>=3&&baseline.photos.filter(image=>image.width>0).every(image=>image.height>0&&image.loaded),`Synthetic rental images load at ${width}px: ${JSON.stringify(baseline.photos)}`);
      const rentalShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`account-rentals-${width}.png`),Buffer.from(rentalShot.data,"base64"));
      await browser.evaluate(`document.querySelector('[data-testid="renter-overview"] table')?.closest('section')?.parentElement?.scrollIntoView({block:'start',behavior:'instant'})`);await wait(100);
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
      }
      await browser.evaluate(`(()=>[...document.querySelectorAll('[aria-label="Account navigation"] button')].find(button=>button.innerText.trim()==='Profile'))()?.click()`);
      await until(`!!(document.querySelector('[data-management-role="renter"][data-management-screen="profile"]')&&document.querySelector('.account-profile-pill')&&document.querySelector('input[aria-label="Name"]'))`,"profile tab renders");
      await browser.evaluate(`window.scrollTo(0,0)`);await wait(80);
      const profileGeometry=await browser.evaluate(`(()=>{const header=document.querySelector('[aria-label="Breadcrumb"]')?.parentElement,content=document.querySelector('[data-management-role="renter"] main'),pill=document.querySelector('.account-profile-pill'),form=document.querySelector('.tab-in'),inputs=[...form.querySelectorAll('input,textarea,button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return{label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,24),left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}),visible=e=>!!e&&e.getBoundingClientRect().width>0,rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}},children=[...header.children].filter(visible).map(e=>({label:e.getAttribute('aria-label')||e.innerText?.trim().slice(0,30),...rect(e)}));return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,header:rect(header),headerChildren:children,content:rect(content),pill:rect(pill),form:rect(form),sections:[...form.querySelectorAll(':scope > section')].map(rect),inputs}})()`);
      assert(profileGeometry.scrollWidth<=width,`Profile page fits ${width}px with no horizontal overflow: ${JSON.stringify(profileGeometry)}`);
      for(const [name,box]of [["profile header",profileGeometry.header],["profile content",profileGeometry.content],["profile identity",profileGeometry.pill],["profile form",profileGeometry.form],...profileGeometry.sections.map((box,index)=>[`profile section ${index+1}`,box])])assert(box&&box.left>=-1&&box.right<=width+1,`${name} stays inside ${width}px: ${JSON.stringify(box)}`);
      assert(profileGeometry.headerChildren.every((node,index,list)=>list.slice(index+1).every(other=>node.right<=other.left+1||other.right<=node.left+1||node.width===0||other.width===0)),`Profile header controls do not overlap at ${width}px: ${JSON.stringify(profileGeometry.headerChildren)}`);
      assert(profileGeometry.inputs.every(input=>input.left>=-1&&input.right<=width+1&&input.width>0&&input.height>0),`Profile inputs and buttons remain fully visible at ${width}px: ${JSON.stringify(profileGeometry.inputs)}`);
      const profileShot=await browser.cmd("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(out,`account-profile-${width}.png`),Buffer.from(profileShot.data,"base64"));
      console.log(`PASS synthetic renter account ${width}px: rentals/history/profile fit, no overlap or horizontal overflow`);
      if(width<640){
        await browser.evaluate(`document.querySelector('[aria-label="Toggle account menu"]')?.click()`);
        await until(`document.querySelector('[aria-label="Toggle account menu"]')?.getAttribute('aria-expanded')==='true'`,`account menu reopens at ${width}px`);
      }
      await browser.evaluate(`(()=>[...document.querySelectorAll('[aria-label="Account navigation"] button')].find(button=>button.innerText.trim()==='My rentals'))()?.click()`);
      await until(`!!document.querySelector('[data-testid="renter-overview"]')`,`rental view restored at ${width}px`);
      await browser.evaluate(`window.scrollTo(0,0)`);
    }
    console.log(`Screenshots: ${out}`);
  }finally{
    if(browser){browser.close();await fetch(`${process.env.DBC_CDP_URL}/json/close/${browser.tabId}`).catch(()=>{})}
    if(chrome.exitCode===null){const done=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill();await done}
    await new Promise(resolve=>server.close(resolve));await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
})().catch(error=>{console.error(error.stack??error);process.exitCode=1});
