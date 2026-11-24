const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");
const root = path.resolve(__dirname, "..");
const helper = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", helper.slice(0, helper.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-gaffer-mobile-widget-"));
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {BotBubble} from './src/components/BotBubble';import styles from './src/components/HomeGearSearch.module.css';window.fixtureLiveRecommendations={ready:true,groups:{'0':{ready:true,preferred:{listingId:'sony-fx3',slug:'sony-fx3',title:'Sony FX3 camera',available:true,automaticEligible:true,requestCompatible:true},options:[]}},basket:[]};function SearchFixture(){return <><div className='fixture-spacer' aria-hidden='true'/><section className={styles.root}><div className='flex flex-wrap items-center justify-between gap-4'><div><p className='hud-label text-accent-300'>Your next shoot starts here</p><h2 className='mt-2 font-display text-2xl font-semibold text-white'>Find it. Pick your time. Make it yours.</h2></div><div className={styles.searchField}><form className={styles.inputShell} role='search'><svg className='h-5 w-5 shrink-0 text-accent-300' viewBox='0 0 24 24' aria-hidden='true'><circle cx='10' cy='10' r='6'/><path d='m15 15 5 5'/></svg><input className='min-w-0 flex-1 bg-transparent text-sm text-white' placeholder='Search gear or categories'/><a aria-label='Have AI assemble your kit' className='group/ai inline-flex items-center gap-1.5 rounded-full border border-accent-300/30 bg-accent-500/15 px-2.5 py-2 text-[10px] text-accent-200'><svg className='h-3.5 w-3.5 shrink-0' viewBox='0 0 20 20' aria-hidden='true'><path d='m10 1.8 1.45 5.1 5.1 1.45-5.1 1.45L10 14.9l-1.45-5.1-5.1-1.45 5.1-1.45L10 1.8Z'/></svg><span>AI kit</span></a></form></div></div></section></>}createRoot(document.getElementById('root')).render(<><SearchFixture/><BotBubble/></>);`;
  await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    outfile: path.join(directory, "fixture.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{ name: "isolated-gaffer-widget", setup(build) {
      build.onResolve({ filter: /^@\/components\/chat\/ChatKit$/ }, () => ({ path: path.join(root, "src/components/chat/ChatKit.tsx") }));
      build.onResolve({ filter: /^@\/lib\/chatLinks$/ }, () => ({ path: path.join(root, "src/lib/chatLinks.ts") }));
      build.onResolve({ filter: /^@\/lib\/chatNotificationOffer$/ }, () => ({ path: path.join(root, "src/lib/chatNotificationOffer.ts") }));
      build.onResolve({ filter: /^@\/lib\/liveRecommendations$/ }, () => ({ path: path.join(root, "src/lib/liveRecommendations.ts") }));
      build.onResolve({ filter: /^next\/link$|^next\/navigation$|^convex\/react$|^@cvx\/_generated\/api$|^@\/(components|lib)\// }, args => ({ path: args.path, namespace: "fixture" }));
      build.onResolve({ filter: /HomeGearSearch\.module\.css$/ }, () => ({ path: "home-search-css", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
        const common = "import React from 'react';";
        let contents = "";
        switch (args.path) {
          case "home-search-css": contents = `export default {root:'root',searchField:'searchField',inputShell:'inputShell'}`; break;
          case "next/link": contents = `${common}export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`; break;
          case "next/navigation": contents = `export const usePathname=()=>'/gear'`; break;
          case "convex/react": contents = `export const useQuery=()=>null;export const useMutation=()=>async()=>null`; break;
          case "@cvx/_generated/api": contents = `const refs=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>String(group)+'.'+String(method)})});export const api=refs`; break;
          case "@/components/useLiveRecommendations": contents = `export const useLiveRecommendations=()=>window.fixtureLiveRecommendations??null`; break;
          case "@/components/SmartImage": contents = `${common}export function SmartImage({src,alt=''}){return <img src={src} alt={alt}/>} `; break;
          case "@/lib/clientRequestId": contents = `export const createClientRequestId=()=> 'fixture-request-id'`; break;
          case "@/lib/site": contents = `export const CONTACT_EMAIL='dbcinemarentals@gmail.com'`; break;
          case "@/components/EmailLink": contents = `${common}export function EmailLink({label,className,ariaLabel,subject}){return <a href={'mailto:dbcinemarentals@gmail.com'+(subject?'?subject='+encodeURIComponent(subject):'')} aria-label={ariaLabel} className={className}>{label}</a>}`; break;
          case "@/components/icons": contents = `${common}const Icon=()=>null;const IconSend=props=><svg {...props} viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5'><path d='M4.5 11.5L20 4l-4.5 16-4-7zM11.5 13L20 4'/></svg>;const IconX=()=> <span aria-hidden='true'>×</span>;export const IconSliders=Icon,IconTrash=Icon,IconCheck=Icon,IconArrowRight=Icon;export {IconX,IconSend}`; break;
          case "@/components/account/AccountProvider": contents = `export const useAccount=()=>({token:null,me:null})`; break;
          case "@/components/cart/CartProvider": contents = `export const useCart=()=>({items:[],add(item){window.fixtureAddedItem=item},remove(){},switchItem(){}})`; break;
          case "@/components/chat/BotAvatar": contents = `${common}export function BotAvatar(){return <span aria-hidden='true'>G</span>}export function BotAvatarBadge(){return <span aria-hidden='true'>G</span>}`; break;
          case "@/components/GlowSlider": contents = `${common}export const GlowSlider=()=>null`; break;
          case "@/components/GafferCall": contents = `${common}export const GafferCall=()=>null`; break;
          case "@/components/gaffer/GafferSession": contents = `export const useGafferSession=()=>({state:'idle',speaking:false,secs:0,dockOpen:false,setDockOpen(){}})`; break;
          case "@/components/rentals/HumanHandoffOffer": contents = `${common}export const HumanHandoffOffer=()=>null`; break;
          default: throw Error(`Unexpected fixture import ${args.path}`);
        }
        return { loader: "tsx", resolveDir: root, contents };
      });
    } }],
  });

  const css = (await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") })).css + "\n" + fs.readFileSync(path.join(root, "src/components/HomeGearSearch.module.css"), "utf8");
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("content-type", "application/javascript"); return response.end(fs.readFileSync(path.join(directory, "fixture.js"))); }
    if (request.url === "/fixture.css") { response.setHeader("content-type", "text/css"); return response.end(css); }
    response.setHeader("content-type", "text/html"); response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#111;color:white}.fixture-spacer{height:calc(56px + 72svh)}</style><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let client, browser;
  try {
    if (!process.env.DBC_CDP_URL) {
      const profile = path.join(directory, "chrome");
      browser = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
      const portFile = path.join(profile, "DevToolsActivePort");
      for (let attempt = 0; attempt < 100 && !fs.existsSync(portFile); attempt++) await wait(100);
      if (!fs.existsSync(portFile)) throw Error("Temporary Chrome did not start");
      process.env.DBC_CDP_URL = `http://127.0.0.1:${fs.readFileSync(portFile, "utf8").split("\n")[0]}`;
    }
    client = await connect("about:blank");
    await client.cmd("Page.enable");
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const device of [{ name: "phone-320x640", width: 320, height: 640, mobile: true }, { name: "phone-320x667", width: 320, height: 667, mobile: true }, { name: "phone-320", width: 320, height: 844, mobile: true }, { name: "phone-390x844", width: 390, height: 844, mobile: true }, { name: "phone-430x932", width: 430, height: 932, mobile: true }, { name: "tablet-768x900", width: 768, height: 900, mobile: false }, { name: "desktop-1440x900", width: 1440, height: 900, mobile: false }]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { ...device, deviceScaleFactor: 1 });
      await client.cmd("Page.navigate", { url: origin });
      await client.cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: device.width === 320 ? "reduce" : "no-preference" }] });
      for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[aria-label="Contact us — chat with Gaffer"]')`); attempt++) await wait(50);
      await wait(300);
      const launcher = await client.evaluate(`(()=>{const e=document.querySelector('[aria-label="Contact us — chat with Gaffer"]'),r=e?.getBoundingClientRect();return{exists:!!e,display:e&&getComputedStyle(e).display,width:r?.width,height:r?.height,right:innerWidth-r?.right,bottom:innerHeight-r?.bottom}})()`);
      assert(launcher.exists && launcher.display !== "none", `Gaffer launcher is available at ${device.width}px: ${JSON.stringify(launcher)}`);
      if (device.mobile) assert(launcher.width >= 44 && launcher.height >= 44 && launcher.right >= 10, `Mobile launcher remains a clear, reachable touch target at ${device.width}px: ${JSON.stringify(launcher)}`);
      const collision = await client.evaluate(`(()=>{const field=document.querySelector('.searchField')?.getBoundingClientRect(),chip=document.querySelector('[aria-label="Have AI assemble your kit"]')?.getBoundingClientRect(),input=document.querySelector('.inputShell input')?.getBoundingClientRect(),launcher=document.querySelector('[aria-label="Contact us — chat with Gaffer"]')?.getBoundingClientRect();const overlaps=(a,b)=>!!a&&!!b&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;return{fieldRight:field?.right,chipRight:chip?.right,inputWidth:input?.width,launcherLeft:launcher?.left,fieldOverlap:overlaps(field,launcher),chipOverlap:overlaps(chip,launcher)}})()`);
      assert.equal(collision.fieldOverlap, false, `The home search control clears the floating launcher at ${device.width}px: ${JSON.stringify(collision)}`);
      assert.equal(collision.chipOverlap, false, `“Find your kit” remains fully tappable beside the floating launcher at ${device.width}px: ${JSON.stringify(collision)}`);
      if(device.width<640 && process.env.DBC_GAFFER_WIDGET_ONLY!=='1') assert(collision.inputWidth>=100, `The phone search field keeps enough room for a readable hint at ${device.width}px: ${JSON.stringify(collision)}`);
      fs.writeFileSync(`/tmp/dbc-home-search-launcher-${device.name}.png`, Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64"));
      assert(await client.evaluate(`document.querySelector('[aria-label="Contact us — chat with Gaffer"]')?.textContent?.includes('G')`), `Closed Gaffer launcher shows its avatar at ${device.width}px`);
      await client.evaluate(`document.querySelector('[aria-label="Contact us — chat with Gaffer"]').click()`);
      await wait(750);
      assert.equal(await client.evaluate(`!!document.querySelector('[aria-label="Contact us — chat with Gaffer"]')`), false, `The floating launcher disappears while Gaffer is open at ${device.width}px`);
      assert(await client.evaluate(`!!document.querySelector('.chat-panel [aria-label="Close chat"]')`), `The open panel keeps one visible close control at ${device.width}px`);
      if (device.mobile) assert(await client.evaluate(`!!document.querySelector('button[aria-label="Close Gaffer chat"]')`), `The phone panel dims the page behind it at ${device.width}px`);
       if (device.mobile) {
         const panel = await client.evaluate(`(()=>{const r=document.querySelector('.chat-panel')?.getBoundingClientRect();return{top:r?.top,bottom:r?.bottom,height:r?.height,viewport:innerHeight}})()`);
         assert(panel.height <= panel.viewport * 0.90 + 1 && panel.top >= 0 && panel.bottom <= panel.viewport, `The Gaffer panel stays compact and inside the phone viewport at ${device.width}px: ${JSON.stringify(panel)}`);
         assert(panel.height >= panel.viewport * 0.80, `The Gaffer panel preserves enough room for messages and the composer at ${device.width}px: ${JSON.stringify(panel)}`);
       }
      const greeting = await client.evaluate(`document.querySelector('.chat-panel .msg-left .whitespace-pre-wrap')?.textContent?.trim() ?? ''`);
      assert.match(greeting, /^Hi! I'm Gaffer\./, `The initial Gaffer greeting renders the assistant name as text at ${device.width}px`);
      assert(!greeting.includes("**"), `The initial Gaffer greeting contains no unrendered Markdown at ${device.width}px`);
      const quickReplies = await client.evaluate(`(()=>[...document.querySelectorAll('.chat-panel button')].filter(b=>b.classList.contains('chip-in')).map(b=>{const r=b.getBoundingClientRect();return{text:b.textContent.trim(),width:r.width,height:r.height}}))()`);
      assert(quickReplies.length > 0, `The real Gaffer quick replies render at ${device.width}px`);
      if (device.mobile) console.log(`QUICK REPLIES ${device.width}px ${JSON.stringify(quickReplies)}`);
      if (device.mobile) assert(quickReplies.every(chip => chip.height >= 44), `Gaffer quick replies meet the 44px phone touch target at ${device.width}px: ${JSON.stringify(quickReplies)}`);
      if (device.mobile) {
        const rail = await client.evaluate("(()=>{const e=document.querySelector('.chat-panel [aria-label^=\"Suggested replies\"]'),s=e&&getComputedStyle(e),r=e?.getBoundingClientRect();return{exists:!!e,scrollWidth:e?.scrollWidth,clientWidth:e?.clientWidth,overflowX:s?.overflowX,flexWrap:s?.flexWrap,left:r?.left,right:r?.right}})()");
        assert(rail.exists&&rail.flexWrap==="nowrap"&&rail.overflowX==="auto"&&rail.scrollWidth>rail.clientWidth, "Gaffer suggestions use one compact, horizontally scrollable phone rail at "+device.width+"px: "+JSON.stringify(rail));
        const rows=await client.evaluate("(()=>{const e=document.querySelector('.chat-panel [aria-label^=\"Suggested replies\"]');return new Set([...e.querySelectorAll('button.chip-in')].map(b=>Math.round(b.getBoundingClientRect().top))).size})()");
        assert.equal(rows,1,"All Gaffer suggestions share one row and leave vertical room for the conversation at "+device.width+"px");
        const visualPass=process.env.DBC_VISUAL_PASS||"baseline";
        fs.writeFileSync("/tmp/dbc-gaffer-chips-pass"+visualPass+"-"+device.name+"-start.png",Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
        const lastReply=await client.evaluate("(()=>{const rail=document.querySelector('.chat-panel [aria-label^=\"Suggested replies\"]'),items=[...rail.querySelectorAll('button.chip-in')];rail.scrollLeft=rail.scrollWidth;const r=items.at(-1).getBoundingClientRect(),box=rail.getBoundingClientRect();return{label:items.at(-1).textContent.trim(),left:r.left,right:r.right,railLeft:box.left,railRight:box.right,scrollLeft:rail.scrollLeft}})()");
        assert(lastReply.left>=rail.left-1&&lastReply.right<=rail.right+1&&lastReply.scrollLeft>0,"The final quick reply can be reached by horizontal touch scrolling at "+device.width+"px: "+JSON.stringify(lastReply));
        fs.writeFileSync("/tmp/dbc-gaffer-chips-pass"+visualPass+"-"+device.name+"-end.png",Buffer.from((await client.cmd("Page.captureScreenshot",{format:"png"})).data,"base64"));
      }
      else assert(quickReplies.every(chip => chip.height >= 36), `Gaffer quick replies remain comfortably tappable off-phone at ${device.width}px: ${JSON.stringify(quickReplies)}`);
      const disabledSend = await client.evaluate(`(()=>{const b=document.querySelector('.chat-panel button[aria-label="Send message"]'),s=b&&getComputedStyle(b),icon=b?.querySelector('svg'),path=icon?.querySelector('path');return{exists:!!b,disabled:b?.disabled,title:b?.title,color:s?.color,background:s?.backgroundColor,opacity:s?.opacity,iconStroke:path&&getComputedStyle(path).stroke}})()`);
      assert(disabledSend.exists && disabledSend.disabled, `The send control is correctly disabled before typing at ${device.width}px`);
      assert.equal(disabledSend.title, "Type a message to enable sending", `The disabled send control explains how to enable it at ${device.width}px`);
      assert.equal(disabledSend.opacity, "1", `The disabled send icon is not faded into invisibility at ${device.width}px`);
      assert.equal(disabledSend.iconStroke, disabledSend.color, `The send glyph remains visible in the disabled state at ${device.width}px`);
      assert.equal(disabledSend.background, "rgb(38, 35, 32)", `The disabled state uses a deliberate neutral surface at ${device.width}px`);
      assert.equal(disabledSend.color, "rgb(197, 171, 145)", `The disabled send glyph keeps readable contrast at ${device.width}px`);
      assert.equal(await client.evaluate(`document.querySelector('#gaffer-send-hint')?.textContent?.trim()`), "Type a message to enable sending.", `Screen readers receive the disabled-state explanation at ${device.width}px`);
      const composer = await client.evaluate(`(()=>{const e=document.querySelector('[aria-label="Message Gaffer"]'),s=getComputedStyle(e),c=document.createElement('canvas').getContext('2d');c.font=s.font;return{placeholder:e.placeholder,textWidth:c.measureText(e.placeholder).width,available:e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)}})()`);
      assert(composer.textWidth <= composer.available, `The short composer hint fits without clipping at ${device.width}px: ${JSON.stringify(composer)}`);
      const panel = await client.evaluate(`(()=>{const e=document.querySelector('.chat-panel'),r=e?.getBoundingClientRect();return{exists:!!e,left:r?.left,right:r?.right,top:r?.top,bottom:r?.bottom,width:r?.width,height:r?.height,viewportWidth:innerWidth,viewportHeight:innerHeight}})()`);
      assert(panel.exists && panel.left >= 0 && panel.right <= panel.viewportWidth && panel.top >= 0 && panel.bottom <= panel.viewportHeight, `Gaffer panel stays inside the viewport at ${device.width}px: ${JSON.stringify(panel)}`);
      if (device.mobile) {
         assert(panel.left >= 10 && panel.width >= device.width - 28, `The phone chat uses the available width without touching screen edges at ${device.width}px: ${JSON.stringify(panel)}`);
      }
      const screenshot = Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64");
      fs.writeFileSync(`/tmp/dbc-gaffer-widget-${device.name}.png`, screenshot);
      if (device.mobile) fs.writeFileSync("/tmp/dbc-gaffer-widget-pass"+(process.env.DBC_VISUAL_PASS||"baseline")+"-"+device.name+".png", screenshot);
      await client.evaluate(`(()=>{const input=document.querySelector('[aria-label="Message Gaffer"]'),setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Check camera availability');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      const enabledSend = await client.evaluate(`(()=>{const b=document.querySelector('.chat-panel button[aria-label="Send message"]');return{disabled:b?.disabled,title:b?.title,hint:document.querySelector('#gaffer-send-hint')?.textContent?.trim()}})()`);
      assert.equal(enabledSend.disabled, false, `Typing enables the send action at ${device.width}px`);
      assert.equal(enabledSend.title, "Send message", `The enabled send action has a clear tooltip at ${device.width}px`);
      assert.equal(enabledSend.hint, "Ready to send.", `The enabled send action has an updated screen-reader description at ${device.width}px`);
      await client.evaluate(`document.querySelector('.chat-panel [aria-label="Close chat"]')?.click()`);
      if (device.mobile) {
        await client.evaluate(`document.querySelector('[aria-label="Contact us — chat with Gaffer"]')?.click()`);
        await wait(250);
        await client.evaluate(`(()=>{document.body.dataset.mobileBookingDock='true';const dock=document.createElement('div');dock.id='test-booking-dock';dock.style.cssText='position:fixed;inset:auto 0 0;height:61px;z-index:30;background:#26221e;border-top:1px solid #d8ae7d';document.body.appendChild(dock)})()`);
        await wait(100);
        const dockLayout = await client.evaluate(`(()=>{const panel=document.querySelector('.chat-panel')?.getBoundingClientRect(),dock=document.querySelector('#test-booking-dock')?.getBoundingClientRect();return{panelTop:panel?.top,panelBottom:panel?.bottom,panelHeight:panel?.height,dockTop:dock?.top,gap:dock&&panel?dock.top-panel.bottom:null,viewportHeight:innerHeight}})()`);
        assert(dockLayout.panelTop > 0 && dockLayout.panelBottom <= dockLayout.dockTop && dockLayout.gap <= 24 && dockLayout.gap >= 0, `The real Gaffer popup anchors just above the mobile booking dock at ${device.width}px: ${JSON.stringify(dockLayout)}`);
        assert(dockLayout.panelHeight <= device.height * 0.52 + 1, `The docked Gaffer popup stays compact at ${device.width}px: ${JSON.stringify(dockLayout)}`);
        fs.writeFileSync(`/tmp/dbc-gaffer-product-dock-${device.name}.png`, Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
        await client.evaluate(`document.querySelector('.chat-panel [aria-label="Close chat"]')?.click()`);
      }
    }
    await client.cmd("Emulation.setDeviceMetricsOverride", { width:390, height:844, mobile:true, deviceScaleFactor:1 });
    await client.cmd("Page.navigate", { url: origin });
    await wait(400);
    const listingImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='120'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='0' y2='1'%3E%3Cstop stop-color='%236a5541'/%3E%3Cstop offset='1' stop-color='%23181818'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='160' height='120' fill='url(%23g)'/%3E%3Ccircle cx='122' cy='25' r='12' fill='%23f2c48f'/%3E%3Cpath d='M0 86L43 51l30 28 24-19 63 48H0' fill='%23352b24'/%3E%3C/svg%3E";
    await client.evaluate(`window.fetch=async()=>({ok:true,json:async()=>({reply:'Here is my answer.',cards:[{kind:'add',reason:'A camera for your shoot.',item:{listingId:'sony-fx3',slug:'sony-fx3',title:'Sony FX3 camera',image:null,imageSources:[${JSON.stringify(listingImage)}],start:'2030-01-01',end:'2030-01-01',days:1,perDay:48,total:48,available:true}}]})});document.querySelector('[aria-label="Contact us — chat with Gaffer"]').click()`);
    await wait(250);
    await client.evaluate(`(()=>{const input=document.querySelector('[aria-label="Message Gaffer"]'),setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Can I rent a camera?');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.chat-panel button[aria-label="Send message"]').click()})()`);
    for(let attempt=0;attempt<150&&!await client.evaluate(`!!document.querySelector('[aria-label="Save chat and set up alerts"]')`);attempt++)await wait(50);
    const guestOrder=await client.evaluate(`(()=>{const panel=document.querySelector('.chat-panel');return {text:panel.textContent,card:!!panel.querySelector('[aria-label="Save chat and set up alerts"]')}})()`);
    assert(guestOrder.card && guestOrder.text.indexOf('Here is my answer.') < guestOrder.text.indexOf('Stay in the loop'),'Guest onboarding follows the Gaffer answer');
    assert.equal(await client.evaluate(`document.querySelector('.chat-panel img[alt="Sony FX3 camera"]')?.getAttribute('src')`),listingImage,'A rental card uses its listing image when only imageSources is present');
    await client.evaluate(`([...document.querySelectorAll('.chat-panel button')].find(button=>button.textContent.trim()==='Add to kit'))?.click()`);
    assert.equal(await client.evaluate(`window.fixtureAddedItem?.heroImage`),listingImage,'Adding a gallery-only listing preserves its selected image in the cart');
    fs.writeFileSync('/tmp/dbc-guest-chat-notification-invitation.png',Buffer.from((await client.cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await client.evaluate(`document.querySelector('[aria-label="Save chat and set up alerts"] button').click()`);
    await wait(300);
    const snapshot=await client.evaluate(`JSON.parse(localStorage.getItem('dbc_guest_chat_handoff_v1')||'null')`);
    assert.match(snapshot.transcript,/Can I rent a camera\?/);assert.match(snapshot.transcript,/Here is my answer/);
    console.log("PASS home search spacing, Gaffer launcher, mobile chat, and guest notification invitation ordering and handoff snapshot.");
  } finally {
    if (client) { client.close(); try { await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`); } catch {} }
    if (browser && browser.exitCode === null) { const exited = new Promise(resolve => browser.once("exit", resolve)); browser.kill(); await exited; }
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
