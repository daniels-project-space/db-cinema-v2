const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");
const postcss = require("postcss");
const root = path.resolve(__dirname, "..");
const testHelpers = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", testHelpers.slice(0, testHelpers.indexOf("const { ConvexHttpClient }")) + ";return connect;")(require);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rentalConversation = fs.readFileSync(path.join(root, "src/components/rentals/RentalConversation.tsx"), "utf8");
assert.match(rentalConversation, /resolveRentalChatLink\(rawUrl, suppliedLabel, \{ allowAdminNavigation \}\)/,
  "Renter rental, general support and admin chat use the shared formatted-message renderer");
assert.match(rentalConversation, /allowAdminNavigation=\{admin && m\.sender === "owner"\}/,
  "Only staff-authored messages in the admin role may expose first-party admin navigation");

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-chat-message-presentation-"));
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { ChatBubble } from './src/components/chat/ChatKit';
    import { FormattedChatMessage } from './src/components/chat/FormattedChatMessage';
    import { resolveRentalChatLink } from './src/lib/chatLinks';
    const oversizedLabel = "Open this very detailed payment button " .repeat(4).trim();
    const message = "**Kit total: £1,240.00**\\nDelivery is £18.50.\\n\\nKit:\\n- Sony FX3 body — £950.00\\n- Sony 24–70mm f/2.8 — £290.00\\n\\nMy email is renter@example.net.\\nContact email: dbcinemarentals@gmail.com.\\n\\n[Open contact form](https://dbcinemarentals.com/contact) or [contact the team](https://www.dbcinemarentals.com/contact/?source=chat)\\n[Continue verification](https://verify.didit.me/session/abc)\\n[Email the team](mailto:dbcinemarentals@gmail.com)\\n[" + oversizedLabel + "](https://checkout.stripe.com/c/pay/cs_test_presentation)\\nCustomer-provided path: /admin\\nCustomer-provided endpoint: /api/chat\\n[Admin route](https://dbcinemarentals.com/admin)\\n[API route](/api/chat)\\n[Other site](https://malicious.example/a-long-path-that-must-wrap-without-widening-the-chat)\\nhttps://malicious.example/a-very-long-raw-path-that-must-wrap-without-widening-the-conversation";
    const customerMessage = "Can you check this kit?\\n\\n- Sony FX3 — £54\\n- Lens f/2.8\\n\\nhttps://malicious.example/my-rental";
    const staffMessage = "[Open staff workspace](/admin/customers)\\n[Open API endpoint](/api/chat)";
    function RentalMessage({ sender }) {
      return <article className='sample-card' data-testid={sender + '-message'}><header>{sender === 'admin' ? 'DB Cinema team' : 'Renter'}</header><div className='message-copy'><FormattedChatMessage text={message} resolveLink={(rawUrl, label) => resolveRentalChatLink(rawUrl, label)} tone='rental'/></div></article>;
    }
    function App() {
      return <main className='presentation-fixture'><h1>Chat message presentation</h1><section className='sample-card' data-testid='gaffer-message'><header>Gaffer</header><ChatBubble role='assistant' text={message}/></section><section className='sample-card' data-testid='gaffer-user-message'><header>Customer</header><ChatBubble role='user' text={customerMessage}/></section><RentalMessage sender='renter'/><RentalMessage sender='admin'/><article className='sample-card' data-testid='admin-staff-route' style={{display:'none'}}><header>DB Cinema team · staff-authored</header><div className='message-copy'><FormattedChatMessage text={staffMessage} resolveLink={(rawUrl, label) => resolveRentalChatLink(rawUrl, label, {allowAdminNavigation: true})} tone='rental'/></div></article></main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    outfile: path.join(directory, "fixture.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const css = (await postcss([require("@tailwindcss/postcss")()]).process(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") })).css;
  let contactNavigations = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("content-type", "application/javascript"); return response.end(fs.readFileSync(path.join(directory, "fixture.js"))); }
    if (request.url === "/fixture.css") { response.setHeader("content-type", "text/css"); return response.end(css); }
    if (request.url === "/contact") contactNavigations++;
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/fixture.css"><style>
      body{margin:0;background:#101111;color:#f4efe8;font:14px/1.55 system-ui,sans-serif}
      .presentation-fixture{display:grid;gap:14px;width:min(100%,1000px);margin:0 auto;padding:16px;box-sizing:border-box}
      .presentation-fixture h1{margin:0 0 4px;font:600 18px Georgia,serif;color:#e5c69f}
      .sample-card{min-width:0;padding:14px;border:1px solid #ffffff20;border-radius:16px;background:linear-gradient(145deg,#202221,#141515);box-shadow:0 12px 28px #0004}
      .sample-card>header{margin:0 0 9px;color:#dbbb94;font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase}
      .message-copy{min-width:0;max-width:100%;overflow-wrap:anywhere;border:1px solid #ffffff17;border-radius:15px;background:#242626;padding:12px}
      .msg-left{min-width:0}.msg-left>div:last-child{min-width:0}
      @media(max-width:600px){.presentation-fixture{padding:10px;gap:10px}.sample-card{padding:10px;border-radius:14px}.message-copy{padding:10px}}
    </style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let client;
  let browser;
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
    for (const device of [{ name: "mobile-320", width: 320, height: 844, mobile: true }, { name: "mobile-360", width: 360, height: 844, mobile: true }, { name: "desktop-1440", width: 1440, height: 960, mobile: false }]) {
      await client.cmd("Emulation.setDeviceMetricsOverride", { ...device, deviceScaleFactor: 1 });
      await client.cmd("Page.navigate", { url: origin });
      for (let attempt = 0; attempt < 100 && !await client.evaluate("!!document.querySelector('[data-testid=gaffer-message] .msg-left')"); attempt++) await wait(50);
      await wait(150);
      const layout = await client.evaluate(`(()=>{
        const boxes=[...document.querySelectorAll('[data-testid$="-message"]')];
        const results=boxes.map(box=>{const copy=box.querySelector('.message-copy,.msg-left>div:last-child>div:last-child,.msg-right>div');const rect=copy?.getBoundingClientRect();const links=[...(copy?.querySelectorAll('a')??[])].map(a=>{const raw=a.getAttribute('href');const url=new URL(raw,location.origin);return{href:raw,host:url.hostname,path:url.pathname,text:a.textContent.trim(),ariaLabel:a.getAttribute('aria-label'),target:a.target,rel:a.rel,rect:a.getBoundingClientRect().toJSON(),display:getComputedStyle(a).display}});return{surface:box.dataset.testid,copyWidth:rect?.width,copyRight:rect?.right,copyScroll:copy?.scrollWidth,copyClient:copy?.clientWidth,anchors:links,lists:copy?.querySelectorAll('ul').length,listItems:[...(copy?.querySelectorAll('li')??[])].map(item=>item.innerText.trim()),paragraphs:copy?.querySelectorAll('p')?.length,text:copy?.innerText??''}});
        return{viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,surfaces:results};
      })()`);
      if (process.env.DBC_CHAT_LAYOUT_DEBUG === "1") console.log(JSON.stringify(layout, null, 2));
      const contrast = await client.evaluate(`(()=>{const action=document.querySelector('[data-testid="gaffer-message"] a[href="https://verify.didit.me/session/abc"]');const style=getComputedStyle(action),colors=[...style.backgroundImage.matchAll(/rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)/g)].map(match=>match.slice(1).map(Number));const fg=style.color.match(/\\d+/g).slice(0,3).map(Number);const lum=rgb=>rgb.map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);return {colors,ratios:colors.map(background=>{const a=lum(background),b=lum(fg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})}})()`);
      assert(contrast.ratios.length >= 2 && contrast.ratios.every(ratio => ratio >= 4.5), `The verification action text meets 4.5:1 contrast across both gradient stops at ${device.name}: ${JSON.stringify(contrast)}`);
      assert(layout.documentWidth <= device.width + 1, `The whole page has no horizontal overflow at ${device.name}: ${JSON.stringify(layout)}`);
      for (const surface of layout.surfaces) {
        assert(surface.copyWidth <= device.width && surface.copyRight <= device.width + 1, `${surface.surface} copy stays inside ${device.name}: ${JSON.stringify(surface)}`);
        assert(surface.copyScroll <= surface.copyClient + 1, `${surface.surface} has no horizontal text overflow at ${device.name}: ${JSON.stringify(surface)}`);
        if (surface.surface === "gaffer-user-message") {
          assert.equal(surface.anchors.length, 0, `Customer-supplied links stay plain text in Gaffer's widget at ${device.name}`);
          assert.equal(surface.lists, 1, `Customer messages use semantic lists in Gaffer's widget at ${device.name}`);
          assert.deepEqual(surface.listItems, ["Sony FX3 — £54", "Lens f/2.8"], `Customer list formatting preserves item text at ${device.name}`);
          assert(surface.text.includes("https://malicious.example/my-rental"), `Customer-supplied URLs stay readable but non-clickable at ${device.name}`);
          continue;
        }
        assert.equal(surface.anchors.filter((anchor) => anchor.path === "/contact" && (anchor.href.startsWith("/") || anchor.host.replace(/^www\./, "") === "dbcinemarentals.com")).length, 1, `${surface.surface} collapses URL aliases into one contact action at ${device.name}: ${JSON.stringify(surface.anchors)}`);
        assert(surface.anchors.some((anchor) => anchor.path === "/contact" && anchor.ariaLabel === "Open contact form" && !anchor.target), `${surface.surface} labels the first-party contact CTA accurately and keeps it in the current tab at ${device.name}`);
        assert(surface.anchors.some((anchor) => anchor.href === "https://verify.didit.me/session/abc" && anchor.target === "_blank" && /noopener/.test(anchor.rel)), `${surface.surface} keeps the approved Didit action secure at ${device.name}`);
        assert(surface.anchors.some((anchor) => anchor.href === "mailto:dbcinemarentals@gmail.com"), `${surface.surface} keeps the approved email action usable at ${device.name}`);
        assert.equal(surface.anchors.filter((anchor) => anchor.href === "mailto:dbcinemarentals@gmail.com").length, 1, `${surface.surface} converts the bare business email into one de-duplicated email action at ${device.name}`);
        assert(surface.anchors.some((anchor) => anchor.href === "mailto:dbcinemarentals@gmail.com" && anchor.text === "Email the team" && anchor.ariaLabel === "Email the team"), `${surface.surface} gives the bare business email a readable, accessible action label at ${device.name}`);
        assert(surface.anchors.some((anchor) => anchor.href === "mailto:dbcinemarentals@gmail.com" && anchor.display === "inline"), `${surface.surface} keeps email links compact inside prose instead of inserting a tall inline button at ${device.name}`);
        assert(surface.anchors.every((anchor) => anchor.ariaLabel), `${surface.surface} gives every active CTA an accessible name at ${device.name}`);
        const paymentAction = surface.anchors.find((anchor) => anchor.host === "checkout.stripe.com");
        assert(paymentAction && paymentAction.text.replace(/↗$/, "").trim() === "Open secure payment", `${surface.surface} gives payment links one concise canonical action label at ${device.name}`);
        assert(surface.anchors.filter((anchor) => anchor.display === "inline-flex").every((anchor) => anchor.text.replace(/↗$/, "").trim().length <= 48), `${surface.surface} keeps action-button labels compact at ${device.name}`);
        assert(!surface.anchors.some((anchor) => /malicious\.example/.test(anchor.href)), `${surface.surface} never activates an unapproved external URL at ${device.name}`);
        assert(!surface.anchors.some((anchor) => anchor.path.startsWith("/admin") || anchor.path.startsWith("/api")), `${surface.surface} never turns customer-supplied private routes into active links at ${device.name}`);
        assert(!surface.text.includes("/admin") && !surface.text.includes("/api"), `${surface.surface} does not display blocked private routes as misleading raw paths at ${device.name}`);
        assert(surface.text.includes("Other site · unavailable") && surface.text.includes("Link unavailable"), `${surface.surface} labels blocked external links and hides raw unapproved URL text at ${device.name}`);
        assert(!surface.text.includes("malicious.example"), `${surface.surface} does not expose raw unapproved hosts at ${device.name}`);
        assert(surface.text.includes("renter@example.net"), `${surface.surface} preserves ordinary email addresses as readable text at ${device.name}`);
        assert.equal(surface.lists, 1, `${surface.surface} uses semantic gear lists at ${device.name}`);
        assert.deepEqual(surface.listItems, ["Sony FX3 body — £950.00", "Sony 24–70mm f/2.8 — £290.00"], `${surface.surface} preserves lens aperture text and prices without inserting a false action link at ${device.name}`);
        assert(!surface.anchors.some((anchor) => anchor.path === "/2.8"), `${surface.surface} never treats the lens aperture slash as a link at ${device.name}`);
        assert(surface.text.includes("£1,240.00") && surface.text.includes("£18.50") && surface.text.includes("£950.00") && surface.text.includes("£290.00"), `${surface.surface} preserves exact item and delivery prices at ${device.name}`);
        if (device.mobile) assert(surface.anchors.filter((anchor) => anchor.display === "inline-flex").every((anchor) => anchor.rect.height >= 44), `${surface.surface} link actions retain a 44px touch target at ${device.name}`);
      }
      const staffLinks = await client.evaluate(`(()=>[...document.querySelectorAll('[data-testid=admin-staff-route] a')].map(a=>({href:a.getAttribute('href'),path:new URL(a.href,location.origin).pathname,text:a.textContent.trim(),ariaLabel:a.getAttribute('aria-label')})))()`);
      assert(staffLinks.some((link) => link.path === "/admin/customers" && link.text.startsWith("Open staff workspace") && link.ariaLabel === "Open staff workspace"), `A staff-authored admin message may retain role-gated internal navigation at ${device.name}: ${JSON.stringify(staffLinks)}`);
      assert(!staffLinks.some((link) => link.path.startsWith("/api")), `Even role-gated staff messages never expose API endpoints as CTAs at ${device.name}`);
      const screenshot = await client.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(`/tmp/dbc-chat-message-presentation-${device.name}.png`, Buffer.from(screenshot.data, "base64"));
      for (const surfaceId of ["gaffer-message", "gaffer-user-message", "renter-message", "admin-message"]) {
        await client.evaluate(`(()=>{for(const box of document.querySelectorAll('[data-testid$="-message"]'))box.style.display=box.dataset.testid==="${surfaceId}"?"block":"none";document.querySelector('[data-testid="${surfaceId}"]')?.scrollIntoView({block:'start',behavior:'instant'})})()`);
        await wait(100);
        const surfaceScreenshot = await client.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(`/tmp/dbc-chat-message-presentation-${device.name}-${surfaceId}.png`, Buffer.from(surfaceScreenshot.data, "base64"));
      }
      await client.evaluate(`for(const box of document.querySelectorAll('[data-testid$="-message"]'))box.style.display=""`);
      await client.evaluate(`document.querySelector('[data-testid="gaffer-message"] a[aria-label="Open contact form"]').focus()`);
      await client.cmd('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await client.cmd('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      assert(await client.evaluate(`(()=>{const action=document.querySelector('[data-testid="gaffer-message"] a[href="https://verify.didit.me/session/abc"]');return document.activeElement===action && action.matches(':focus-visible') && getComputedStyle(action).outlineStyle!=='none'})()`), 'keyboard navigation exposes a visible focus indicator on verification');
      await client.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      assert(await client.evaluate(`parseFloat(getComputedStyle(document.querySelector('[data-testid="gaffer-message"] a[href="https://verify.didit.me/session/abc"]')).transitionDuration) <= 0.001`),'actions respect reduced motion');
      await client.cmd('Emulation.setEmulatedMedia',{features:[]});
      const previousNavigations = contactNavigations;
      await client.evaluate(`document.querySelector('[data-testid="gaffer-message"] a[aria-label="Open contact form"]')?.click()`);
      for (let attempt = 0; attempt < 100 && contactNavigations === previousNavigations; attempt++) await wait(20);
      const contactRoute = await client.evaluate("({path:location.pathname,host:location.hostname})");
      assert.equal(contactRoute.path, "/contact", `The Gaffer contact action opens the contact route in the same tab at ${device.name}`);
      assert.equal(contactRoute.host, "127.0.0.1", `The Gaffer contact action stays on the current first-party site at ${device.name}`);
      assert.equal(contactNavigations, previousNavigations + 1, `The contact route receives the expected same-tab navigation at ${device.name}`);
      console.log(`PASS ${device.name}: ${JSON.stringify({ documentWidth: layout.documentWidth, surfaces: layout.surfaces.map((surface) => ({ id: surface.surface, width: surface.copyWidth, anchors: surface.anchors.length }))})}`);
    }
    console.log("PASS unified Gaffer, renter and admin chat-message rendering on mobile and desktop.");
  } finally {
    if (client) await client.close();
    server.close();
    if (browser) {
      const stopped = new Promise((resolve) => browser.once("exit", resolve));
      browser.kill("SIGTERM");
      await Promise.race([stopped, wait(2000)]);
    }
    if (!browser) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
