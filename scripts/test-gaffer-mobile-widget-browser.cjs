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
  const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {BotBubble} from './src/components/BotBubble';createRoot(document.getElementById('root')).render(<BotBubble/>);`;
  await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    outfile: path.join(directory, "fixture.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{ name: "isolated-gaffer-widget", setup(build) {
      build.onResolve({ filter: /^next\/link$|^next\/navigation$|^convex\/react$|^@cvx\/_generated\/api$|^@\/(components|lib)\// }, args => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
        const common = "import React from 'react';";
        let contents = "";
        switch (args.path) {
          case "next/link": contents = `${common}export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`; break;
          case "next/navigation": contents = `export const usePathname=()=>'/gear'`; break;
          case "convex/react": contents = `export const useQuery=()=>null;export const useMutation=()=>async()=>null`; break;
          case "@cvx/_generated/api": contents = `const refs=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>String(group)+'.'+String(method)})});export const api=refs`; break;
          case "@/components/useLiveRecommendations": contents = `export const useLiveRecommendations=()=>null`; break;
          case "@/components/SmartImage": contents = `${common}export function SmartImage({src,alt=''}){return <img src={src} alt={alt}/>} `; break;
          case "@/lib/liveRecommendations": contents = `export const liveWindow=()=>({}),stockLines=()=>[],liveChatChoices=()=>[]`; break;
          case "@/components/icons": contents = `${common}const Icon=()=>null;const IconSend=props=><svg {...props} viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5'><path d='M4.5 11.5L20 4l-4.5 16-4-7zM11.5 13L20 4'/></svg>;const IconX=()=> <span aria-hidden='true'>×</span>;export const IconSliders=Icon,IconTrash=Icon,IconCheck=Icon,IconArrowRight=Icon;export {IconX,IconSend}`; break;
          case "@/components/account/AccountProvider": contents = `export const useAccount=()=>({token:null,me:null})`; break;
          case "@/components/cart/CartProvider": contents = `export const useCart=()=>({items:[],add(){},remove(){},switchItem(){}})`; break;
          case "@/components/chat/BotAvatar": contents = `${common}export function BotAvatar(){return <span aria-hidden='true'>G</span>}export function BotAvatarBadge(){return <span aria-hidden='true'>G</span>}`; break;
          case "@/components/chat/ChatKit": contents = `${common}export function ChatBubble({role,text}){return <div className={role==='user'?'msg-right flex justify-end':'msg-left flex items-end gap-2'}><div className='min-w-0 max-w-[85%]'><div className={role==='user'?'rounded-2xl bg-amber-700/70 px-4 py-2.5 text-sm leading-relaxed':'whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/[.05] px-4 py-2.5 text-sm leading-relaxed text-white/85'}>{text}</div></div></div>}export function Chips({opts=[],onPick}){return <div className='flex flex-wrap gap-2 pl-9'>{opts.map(option=><button type='button' key={option} onClick={()=>onPick?.(option)} className='min-h-9 rounded-full border border-white/10 bg-white/[.03] px-3 text-xs text-white/75'>{option}</button>)}</div>}export const TypingIndicator=()=>null`; break;
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

  const css = (await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") })).css;
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("content-type", "application/javascript"); return response.end(fs.readFileSync(path.join(directory, "fixture.js"))); }
    if (request.url === "/fixture.css") { response.setHeader("content-type", "text/css"); return response.end(css); }
    response.setHeader("content-type", "text/html"); response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/fixture.css"><body style="background:#111;color:white"><div id="root"></div><script src="/fixture.js"></script>');
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
    for (const device of [{ name: "phone-320", width: 320, height: 640, mobile: true }, { name: "phone-390", width: 390, height: 844, mobile: true }, { name: "desktop-1440", width: 1440, height: 1000, mobile: false }]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { ...device, deviceScaleFactor: 1 });
      await client.cmd("Page.navigate", { url: origin });
      for (let attempt = 0; attempt < 100 && !await client.evaluate(`!!document.querySelector('[aria-label="Contact us — chat with Gaffer"]')`); attempt++) await wait(50);
      await wait(300);
      const launcher = await client.evaluate(`(()=>{const e=document.querySelector('[aria-label="Contact us — chat with Gaffer"]'),r=e?.getBoundingClientRect();return{exists:!!e,display:e&&getComputedStyle(e).display,width:r?.width,height:r?.height,right:innerWidth-r?.right,bottom:innerHeight-r?.bottom}})()`);
      assert(launcher.exists && launcher.display !== "none", `Gaffer launcher is available at ${device.width}px: ${JSON.stringify(launcher)}`);
      if (device.mobile) assert(launcher.width >= 44 && launcher.height >= 44 && launcher.right >= 10, `Mobile launcher remains a clear, reachable touch target at ${device.width}px: ${JSON.stringify(launcher)}`);
      assert(await client.evaluate(`document.querySelector('[aria-label="Contact us — chat with Gaffer"]')?.textContent?.includes('G')`), `Closed Gaffer launcher shows its avatar at ${device.width}px`);
      await client.evaluate(`document.querySelector('[aria-label="Contact us — chat with Gaffer"]').click()`);
      await wait(350);
      assert(await client.evaluate(`document.querySelector('[aria-label="Close the contact chat"]')?.textContent?.includes('×')`), `Open Gaffer launcher shows a visible close control at ${device.width}px`);
      const greeting = await client.evaluate(`document.querySelector('.chat-panel .msg-left .whitespace-pre-wrap')?.textContent?.trim() ?? ''`);
      assert.match(greeting, /^Hi! I'm Gaffer\./, `The initial Gaffer greeting renders the assistant name as text at ${device.width}px`);
      assert(!greeting.includes("**"), `The initial Gaffer greeting contains no unrendered Markdown at ${device.width}px`);
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
        assert(panel.width <= device.width - 20 && panel.height <= Math.min(560, device.height * .68) + 2, `Phone widget is narrower and shorter than desktop while preserving the chat controls at ${device.width}px: ${JSON.stringify(panel)}`);
        assert(panel.bottom <= device.height - 68, `Phone widget clears the launcher at ${device.width}px`);
      }
      fs.writeFileSync(`/tmp/dbc-gaffer-widget-${device.name}.png`, Buffer.from((await client.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));
      await client.evaluate(`(()=>{const input=document.querySelector('[aria-label="Message Gaffer"]'),setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Check camera availability');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      const enabledSend = await client.evaluate(`(()=>{const b=document.querySelector('.chat-panel button[aria-label="Send message"]');return{disabled:b?.disabled,title:b?.title,hint:document.querySelector('#gaffer-send-hint')?.textContent?.trim()}})()`);
      assert.equal(enabledSend.disabled, false, `Typing enables the send action at ${device.width}px`);
      assert.equal(enabledSend.title, "Send message", `The enabled send action has a clear tooltip at ${device.width}px`);
      assert.equal(enabledSend.hint, "Ready to send.", `The enabled send action has an updated screen-reader description at ${device.width}px`);
      await client.evaluate(`document.querySelector('[aria-label="Close the contact chat"]')?.click()`);
    }
    console.log("PASS Gaffer launcher and compact chat panel at 320/390 phone widths and 1440 desktop; isolated UI fixture, no account/network writes.");
  } finally {
    if (client) { client.close(); try { await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`); } catch {} }
    if (browser && browser.exitCode === null) { const exited = new Promise(resolve => browser.once("exit", resolve)); browser.kill(); await exited; }
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
