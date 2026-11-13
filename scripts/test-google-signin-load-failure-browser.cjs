const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");

const browserSource = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", browserSource.slice(0, browserSource.indexOf("const { ConvexHttpClient")) + ";return connect;")(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = path.resolve(__dirname, "..");
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{GoogleSignIn}from'./src/components/account/GoogleSignIn';createRoot(document.getElementById('root')).render(<main><form><label>Email<input id="email" type="email"/></label><label>Password<input id="password" type="password"/></label><button type="submit">Sign in</button><GoogleSignIn/></form></main>);`;
  const bundle = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID": '"fixture-client-id"' },
    plugins: [{
      name: "account-context",
      setup(build) {
        build.onResolve({ filter: /^\.\/AccountProvider$/ }, () => ({ path: "account-context", namespace: "fixture" }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: "export const useAccount=()=>({signInWithGoogle:async()=>{}});" }));
      },
    }],
  });
  const server = http.createServer((request, response) => {
    if (request.url === "/bundle.js") {
      response.setHeader("content-type", "text/javascript");
      return response.end(bundle.outputFiles[0].text);
    }
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#151515;color:#eee;font:14px sans-serif}main{width:calc(100vw - 32px);max-width:400px;margin:24px auto}form{display:grid;gap:12px}label{display:grid;gap:4px}input,button{min-height:42px;width:100%;border-radius:10px;padding:8px 12px}</style><script id="gsi-script"></script><div id="root"></div><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-google-load-error-"));
  const chrome = spawn("/opt/google/chrome/chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { stdio: "ignore" });
  let browser;
  try {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0]; break; }
      catch { await wait(100); }
    }
    assert(port, "Chrome DevTools port is available");
    process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
    browser = await connect();
    await browser.cmd("Page.enable");
    await browser.cmd("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
    for (let attempt = 0; attempt < 100 && !await browser.evaluate('!!document.querySelector("#password")'); attempt++) await wait(50);
    const initial = await browser.evaluate(`(()=>({email:!!document.querySelector('#email'),password:!!document.querySelector('#password'),submit:!!document.querySelector('button[type="submit"]'),status:!!document.querySelector('[role="status"]')}))()`);
    assert.deepEqual(initial, { email: true, password: true, submit: true, status: false });

    await browser.evaluate(`document.querySelector('#gsi-script').dispatchEvent(new Event('error'))`);
    for (let attempt = 0; attempt < 100 && !await browser.evaluate('!!document.querySelector("[role=status]")'); attempt++) await wait(20);
    const failed = await browser.evaluate(`(()=>{const status=document.querySelector('[role="status"]');return{text:status?.textContent,email:document.querySelector('#email')?.getBoundingClientRect().height,password:document.querySelector('#password')?.getBoundingClientRect().height,submit:document.querySelector('button[type="submit"]')?.disabled,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert.match(failed.text, /Google sign-in is unavailable/i);
    assert.match(failed.text, /email and password/i);
    assert(failed.email > 0 && failed.password > 0 && failed.submit === false && !failed.overflow, "Email/password sign-in remains usable without overflow");
    fs.writeFileSync("/tmp/dbc-google-signin-load-failure.png", Buffer.from((await browser.cmd("Page.captureScreenshot", { format: "png" })).data, "base64"));

    await browser.evaluate(`(()=>{window.google={accounts:{id:{initialize(){},renderButton(host){host.innerHTML='<button type="button" data-testid="gsi-ready">Continue with Google</button>'}}}};document.querySelector('#gsi-script').dispatchEvent(new Event('load'))})()`);
    for (let attempt = 0; attempt < 100 && !await browser.evaluate('!!document.querySelector("[data-testid=gsi-ready]")'); attempt++) await wait(20);
    assert(await browser.evaluate('!!document.querySelector("[data-testid=gsi-ready]")'), "Google button renders after a later successful GIS load");
    assert.equal(await browser.evaluate('!!document.querySelector("[role=status]")'), false, "The stale load-failure message clears after recovery");
    console.log("PASS Google GIS script failure: accessible status appears, email/password stays usable, and a later GIS load recovers. No live Google auth.");
  } finally {
    if (browser) browser.close();
    await new Promise(resolve => server.close(resolve));
    if (chrome.exitCode === null) {
      const done = new Promise(resolve => chrome.once("exit", resolve));
      chrome.kill();
      await done;
    }
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
