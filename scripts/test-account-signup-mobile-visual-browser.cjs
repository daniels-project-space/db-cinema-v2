const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const esbuild = require("esbuild");
const { spawn } = require("node:child_process");

const membershipSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", membershipSource.slice(0, membershipSource.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, "..");
const common = `
export const api=new Proxy({}, {get:(_,namespace)=>new Proxy({}, {get:(_,name)=>String(namespace)+'.'+String(name)})});
export const AccountCreditReceipts=()=>null,ReferralPanel=()=>null,EncoreCrest=()=>null,GearCard=()=>null,AccountFrame=({children})=><span>{children}</span>,AccountProfilePill=({children})=><span>{children}</span>,ChatAvatar=()=>null,RenterChat=()=>null,MembershipPlanCard=()=>null,AccentPicker=()=>null,CollectiveProfile=()=>null,RenterNotificationBell=()=>null,RenterOverview=()=>null,RentalCalendar=()=>null,ShootLists=()=>null,AvatarUpload=()=>null,ManagementShell=({children})=><div>{children}</div>,InvoiceLibrary=()=>null,PrivatePortraitPreference=()=>null,SiteHeader=()=> <header className="border-b border-white/10 bg-black px-4 py-3 text-sm">DB CINEMA <span className="ml-2 text-white/45">/ Account</span></header>;
export const REVIEW_PRIZE_GBP=100,tierByKey=()=>null,TIERS=[];
export function accountAuthErrorMessage(error,fallback){return fallback}
export function legalVersionForPolicy(){return 'current-terms-v1'}
export const CURRENT_PRIVACY_NOTICE_VERSION='current-privacy-v1';
export function useQuery(ref,args){return args==='skip'?undefined:{}}
export function useAction(ref){return async args=>{window.__requestSignIn=(window.__requestSignIn||0)+1;return {ok:true}}}
export function useMutation(){return async()=>{}}
export function usePaginatedQuery(){return{status:'LoadingFirstPage',results:[]}}
export function useAccount(){return{loading:false,me:null,token:null,signUp:async()=>{window.__signupCalled=(window.__signupCalled||0)+1;if(window.__signupShouldFail)throw new Error('synthetic signup failure')},signIn:async()=>{window.__signinCalled=(window.__signinCalled||0)+1},signInWithGoogle:async credential=>{window.__googleCredential=credential},signOut:async()=>{},acceptSession(){},updateProfile:async()=>{},toggleFavorite:async()=>{}}}
export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}
`;
const googleSvg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#3c6073"/><circle cx="40" cy="30" r="16" fill="#d9ad8b"/><path d="M10 80c4-24 16-34 30-34s26 10 30 34" fill="#171a20"/></svg>');

function pluginForAccountPage() {
  return { name: "account-page-fixtures", setup(build) {
    const realGoogleSignIn = path.join(root, "src/components/account/GoogleSignIn.tsx");
    build.onResolve({ filter: /^@\/components\/account\/GoogleSignIn$/ }, () => ({ path: realGoogleSignIn }));
    build.onResolve({ filter: /^\.\/AccountProvider$/ }, () => ({ path: "account-provider", namespace: "fixture" }));
    build.onResolve({ filter: /^convex\/react$|^convex-helpers\/react$|^@cvx\/_generated\/api$/ }, () => ({ path: "shared-stub", namespace: "fixture" }));
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "shared-stub", namespace: "fixture" }));
    build.onResolve({ filter: /^@\/.*|^\.\.\/\.\.\/\.\.\/shared\/.*|^\.\.\/\.\.\/shared\/.*$/ }, args => args.path === "@/components/account/GoogleSignIn" ? undefined : ({ path: "shared-stub", namespace: "fixture" }));
    build.onLoad({ filter: /^shared-stub$/, namespace: "fixture" }, () => ({ loader: "jsx", resolveDir: root, contents: common }));
    build.onLoad({ filter: /^account-provider$/, namespace: "fixture" }, () => ({ loader: "js", contents: `export function useAccount(){return{loading:false,me:null,token:null,signUp:async()=>{window.__signupCalled=(window.__signupCalled||0)+1;if(window.__signupShouldFail)throw new Error('synthetic signup failure')},signIn:async()=>{window.__signinCalled=(window.__signinCalled||0)+1},signInWithGoogle:async credential=>{window.__googleCredential=credential},signOut:async()=>{},acceptSession(){},updateProfile:async()=>{},toggleFavorite:async()=>{}}}` }));
  } };
}

function pluginForAvatar() {
  const avatarCommon = `export const api=new Proxy({}, {get:(_,namespace)=>new Proxy({}, {get:(_,name)=>String(namespace)+'.'+String(name)})});export const useMutation=()=>async()=>{};export const useAccount=()=>({token:'synthetic-token',me:{name:'Riley Chen',email:'riley@example.invalid',avatarUrl:${JSON.stringify(googleSvg)}}});`;
  return { name: "avatar-fixtures", setup(build) {
    build.onResolve({ filter: /^\.\/AccountProvider$|^@\/components\/account\/AccountProvider$/ }, () => ({ path: "avatar-stub", namespace: "fixture" }));
    build.onResolve({ filter: /^convex\/react$|^@cvx\/_generated\/api$/ }, () => ({ path: "avatar-stub", namespace: "fixture" }));
    build.onLoad({ filter: /^avatar-stub$/, namespace: "fixture" }, () => ({ loader: "js", contents: avatarCommon }));
  } };
}

async function build(entry, plugins, define = {}) {
  const result = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true, write: false, outdir: "/fixture", platform: "browser", format: "iife", jsx: "automatic", define, plugins });
  return result.outputFiles.find(file => file.path.endsWith(".js")).text;
}

(async () => {
  const accountJs = await build(`import React from 'react';import{createRoot}from'react-dom/client';import AccountPage from './src/app/account/page';createRoot(document.getElementById('root')).render(<AccountPage/>);`, [pluginForAccountPage()], { "process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID": '"synthetic-client-id"' });
  const avatarJs = await build(`import React from 'react';import{createRoot}from'react-dom/client';import{AvatarUpload}from'./src/components/account/AvatarUpload';createRoot(document.getElementById('root')).render(<main><AvatarUpload/></main>);`, [pluginForAvatar()], { "process.env.NEXT_PUBLIC_CONVEX_URL": '"https://synthetic.convex.cloud"' });
  const globalCss = await require("postcss")([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
  let active = accountJs;
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${globalCss.css}html,body,#root{min-height:100%;margin:0;background:#090909;color:#f6f4f0;font-family:Arial,sans-serif}button{cursor:pointer}input,button{font:inherit}main{padding:24px}</style><div id="root"></div><script>window.__gsiWidths=[];window.google={accounts:{id:{initialize:config=>{window.__gsiConfig=config;window.__gsiInit=(window.__gsiInit||0)+1},renderButton:(host,opts)=>{window.__gsiWidths.push(opts.width);const frame=document.createElement('iframe');frame.title='Google Sign In';frame.style.width=opts.width+'px';frame.style.height='40px';frame.srcdoc='<style>body{margin:0;font:14px Arial,sans-serif}.btn{height:40px;width:100%;box-sizing:border-box;border-radius:20px;background:#fff;color:#3c4043;display:flex;align-items:center;justify-content:center;gap:9px}.g{font-weight:700;font-size:17px;color:#4285f4}</style><div class=btn><span class=g>G</span>Continue with Google</div>';host.appendChild(frame)}}}}</script><script src="/bundle.js"></script>`;
  const server = http.createServer((req, res) => { if (req.url === "/bundle.js") { res.setHeader("content-type", "text/javascript"); return res.end(active); } if (req.url === "/avatar.js") { res.setHeader("content-type", "text/javascript"); return res.end(avatarJs); } res.setHeader("content-type", "text/html"); res.end(html); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-account-mobile-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) { try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]; break; } catch { await wait(100); } }
    assert(port, "Synthetic browser starts");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect(); await browser.cmd("Page.enable"); await browser.cmd("Runtime.enable");
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
    const until = async (expression, label) => { for (let i = 0; i < 100; i++) { if (await browser.evaluate(expression)) return; await wait(50); } throw new Error(`Timed out: ${label}`); };
    await until(`!!document.querySelector('input[aria-label="Email"]')`, "sign-in form renders");
    const out = "/tmp/dbc-account-mobile-audit"; fs.mkdirSync(out, { recursive: true });
    for (const width of [320, 390, 430, 768]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 768 }); await wait(80);
      const geometry = await browser.evaluate(`(()=>{const nodes=[...document.querySelectorAll('main,form,input,button,iframe,[role="alert"]')].filter(e=>e.getBoundingClientRect().width>0);return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,outside:nodes.filter(e=>{const r=e.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1}).map(e=>({tag:e.tagName,text:e.innerText?.slice(0,30),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})).slice(0,6)}})()`);
      assert(geometry.scrollWidth <= width, `Sign-in fits ${width}px: ${JSON.stringify(geometry)}`); assert.deepEqual(geometry.outside, [], `Sign-in controls stay within ${width}px`);
      await wait(100); if (width === 320 || width === 768) { const shot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); fs.writeFileSync(path.join(out, `account-${width}-signin.png`), Buffer.from(shot.data, "base64")); }
    }
    await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.innerText.trim()==='Create one')?.click()`);
    await until(`!!document.querySelector('input[name="termsAndPrivacyAcknowledged"]')`, "signup form renders");
    const retentionCopy = await browser.evaluate(`document.querySelector('form')?.previousElementSibling?.innerText ?? ''`);
    assert.match(retentionCopy, /90 days/, "Signup explains the 90-day verification reuse period");
    assert.match(retentionCopy, /during rentals/, "Signup explains files remain during rentals");
    assert.match(retentionCopy, /90 days after closure/, "Signup explains the post-closure file retention period");
    assert.match(retentionCopy, /case is open/, "Signup explains the open-case retention hold");
    assert(retentionCopy.length < 180, `Signup retention copy stays concise while preserving the policy: ${retentionCopy}`);
    assert.equal(await browser.evaluate(`document.querySelector('button[type="submit"]').disabled`), true, "Account creation waits for current terms acceptance");
    assert.equal(await browser.evaluate(`document.querySelector('iframe[title="Google Sign In"]')?.parentElement.classList.contains('hidden')`), true, "Google signup remains hidden until current terms acceptance");
    for (const width of [320, 390, 430, 768]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 768 }); await wait(100);
      const geometry = await browser.evaluate(`(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,form:document.querySelector('form').getBoundingClientRect().toJSON(),checkbox:document.querySelector('input[name="termsAndPrivacyAcknowledged"]').getBoundingClientRect().toJSON()}))()`);
      assert(geometry.scrollWidth <= width, `Signup fits ${width}px: ${JSON.stringify(geometry)}`);
      const shot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); fs.writeFileSync(path.join(out, `account-${width}-signup.png`), Buffer.from(shot.data, "base64"));
    }
    await browser.cmd("Emulation.setDeviceMetricsOverride", { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.evaluate(`document.querySelector('input[name="termsAndPrivacyAcknowledged"]').click()`);
    await until(`!!document.querySelector('iframe[title="Google Sign In"]')&&!document.querySelector('iframe[title="Google Sign In"]').parentElement.classList.contains('hidden')`, "Google signup button appears only after consent");
    assert.equal(await browser.evaluate(`document.querySelector('button[type="submit"]').disabled`), false, "Consent enables local signup submit");
    await browser.evaluate(`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const email=document.querySelector('input[name="email"]'),password=document.querySelector('input[name="password"]'),name=document.querySelector('input[name="name"]');set.call(email,'riley@example.invalid');email.dispatchEvent(new Event('input',{bubbles:true}));set.call(password,'synthetic-pass-123');password.dispatchEvent(new Event('input',{bubbles:true}));set.call(name,'Riley Chen');name.dispatchEvent(new Event('input',{bubbles:true}));window.__signupShouldFail=true;document.querySelector('form').requestSubmit()})()`);
    await until(`!!document.querySelector('[role="alert"]')`, "safe signup error is displayed");
    assert.equal(await browser.evaluate(`document.querySelector('[role="alert"]').innerText.includes("We couldn't create your account")`), true, "Unexpected signup failures use concise safe copy");
    assert.equal(await browser.evaluate(`window.__signupCalled`), 1, "Synthetic form error reaches only the mocked signup action");
    await browser.evaluate(`window.__signupShouldFail=false;document.querySelector('form').requestSubmit()`);
    await until(`!!document.querySelector('[role="status"]')`, "email verification status appears after synthetic signup");
    assert.match(await browser.evaluate(`document.querySelector('[role="status"]').innerText`), /Check your email to confirm account creation/);
    assert.equal(await browser.evaluate(`window.__signupCalled`), 2, "Email verification notice is only local synthetic UI; no email service is called");
    await browser.evaluate(`window.scrollTo(0,document.documentElement.scrollHeight)`);
    const signupBottom = await browser.evaluate(`(()=>{const frame=document.querySelector('iframe[title="Google Sign In"]'),r=frame.getBoundingClientRect();return{scrollY,scrollHeight:document.documentElement.scrollHeight,height:innerHeight,frameBottom:r.bottom,frameWidth:r.width}})()`);
    assert(signupBottom.frameBottom <= signupBottom.height + 1, `Google action remains fully visible after signup confirmation: ${JSON.stringify(signupBottom)}`);
    await browser.evaluate(`window.__gsiConfig.callback({credential:'synthetic-google-credential'})`); await wait(60);
    assert.equal(await browser.evaluate(`window.__googleCredential`), "synthetic-google-credential", "Google credential is handed only to the synthetic account session");
    await browser.evaluate(`window.scrollTo(0,0)`);
    const errorShot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); fs.writeFileSync(path.join(out, "account-320-signup-error.png"), Buffer.from(errorShot.data, "base64"));

    active = avatarJs;
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/avatar` });
    await until(`!!document.querySelector('img[alt="Profile"]')`, "synthetic Google profile photo renders");
    for (const width of [320, 390, 430, 768]) {
      await browser.cmd("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 768 }); await wait(80);
      const avatar = await browser.evaluate(`(()=>{const image=document.querySelector('img[alt="Profile"]'),r=image.getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,box:{left:r.left,right:r.right,width:r.width,height:r.height},buttons:[...document.querySelectorAll('button')].map(b=>b.innerText.trim())}})()`);
      assert(avatar.scrollWidth <= width, `Profile avatar stays within ${width}px`); assert(avatar.box.width === 64 && avatar.box.height === 64, "Profile image keeps its 64px crop"); assert(avatar.buttons.includes("Change photo") && avatar.buttons.includes("Remove"), "Google profile image can be changed or removed");
      if (width === 320 || width === 768) { const shot = await browser.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); fs.writeFileSync(path.join(out, `account-${width}-avatar.png`), Buffer.from(shot.data, "base64")); }
    }
    console.log(`PASS synthetic account browser: 320/390/430/768px sign-in and signup, terms/Google consent gate, signup errors, synthetic Google credential handoff, profile-avatar rendering and scrolling. No live auth, email or payment calls. Screenshots: ${out}`);
  } finally {
    if (browser) { browser.close(); await fetch(`${process.env.DBC_CDP_URL || "http://localhost:9224"}/json/close/${browser.tabId}`).catch(() => {}); }
    await new Promise(resolve => server.close(resolve));
    if (chrome.exitCode === null) { const done = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill(); await done; }
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
