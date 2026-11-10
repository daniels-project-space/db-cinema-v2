const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
const browserHarness = fs.readFileSync(path.join(__dirname, "test-membership-browser.cjs"), "utf8");
const connect = new Function("require", `${browserHarness.slice(0, browserHarness.indexOf("const { ConvexHttpClient }"))}\nreturn connect;`)(require);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const adminToken = "synthetic-account-documents-admin";
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGPQqLj0HwAEsAJyoy0JSQAAAABJRU5ErkJggg==", "base64");

function makePdf() {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += object;
  }
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const pdfBytes = makePdf();
const routes = [];
setMock("convex/server", { httpRouter: () => ({ route: route => routes.push(route) }) });
const archive = load("convex/verificationArchive.ts");
load("convex/http.ts");
const documentRead = routes.find(route => route.path === "/admin-verification-document" && route.method === "POST")?.handler;
const documentOptions = routes.find(route => route.path === "/admin-verification-document" && route.method === "OPTIONS")?.handler;
assert.equal(typeof documentRead, "function", "The fixture loads the registered production document route");
assert.equal(typeof documentOptions, "function", "The fixture loads the registered preflight route");

const originalEnv = {
  adminToken: process.env.ADMIN_TOKEN,
  verificationV2: process.env.ADMIN_SESSION_VERIFICATION_V2,
  appUrl: process.env.APP_URL,
};
process.env.ADMIN_TOKEN = adminToken;
delete process.env.ADMIN_SESSION_VERIFICATION_V2;

const accountId = "accounts-synthetic-documents";
const bookingId = "bookings-synthetic-documents";
const archiveId = "verification_archives-synthetic-documents";
const account = put("accounts", { _id: accountId, email: "fixture@example.invalid", name: "Synthetic renter" });
const booking = put("bookings", { _id: bookingId, accountId, status: "confirmed", diditSessionId: "synthetic-session" });
const imageMetadata = { storageId: "_storage-synthetic-image", bytes: pngBytes, contentType: "image/png", kind: "identity-front" };
const pdfMetadata = { storageId: "_storage-synthetic-pdf", bytes: pdfBytes, contentType: "application/pdf", kind: "address-0" };
const archiveRow = put("verification_archives", {
  _id: archiveId,
  accountId,
  bookingId,
  sessionId: booking.diditSessionId,
  source: "didit",
  status: "complete",
  generation: 2,
  attempts: 1,
  supplementalStatus: "complete",
  supplementalCheckVersion: 2,
  readProofVersion: 2,
  readVerifiedAt: Date.now() - 1000,
});
const savedDocuments = [imageMetadata, pdfMetadata].map((file, index) => {
  const row = put("verification_documents", {
    _id: `verification_documents-synthetic-${index}`,
    accountId,
    bookingId,
    archiveId,
    sessionId: archiveRow.sessionId,
    kind: file.kind,
    storageId: file.storageId,
    sha256: hash(file.bytes),
    size: file.bytes.length,
    contentType: file.contentType,
    savedAt: Date.now() + index * 1000,
  });
  put("_storage", { _id: file.storageId, sha256: row.sha256, size: row.size, contentType: row.contentType });
  return row;
});
const fileBytes = new Map([[imageMetadata.storageId, pngBytes], [pdfMetadata.storageId, pdfBytes]]);
const requestLog = [];
let downloadAccessCalls = 0;
const ctx = {
  db,
  storage: { get: async id => fileBytes.has(id) ? new Blob([fileBytes.get(id)], { type: id === imageMetadata.storageId ? "image/png" : "application/pdf" }) : null },
  runMutation: async (reference, args) => {
    assert.equal(String(reference), "verificationArchive.downloadAccess", "The HTTP route reaches the real archive access mutation");
    downloadAccessCalls++;
    return archive.downloadAccess.handler(ctx, args);
  },
};
assert.equal(booking.status, "confirmed");
assert.equal(account.email, "fixture@example.invalid");

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function fromNodeRequest(request, body) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return new Request(`http://127.0.0.1${request.url}`, {
    method: request.method,
    headers,
    ...(request.method === "GET" || request.method === "HEAD" ? {} : { body }),
  });
}

async function sendWebResponse(webResponse, response) {
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-account-documents-browser-"));
const appServer = http.createServer(async (request, response) => {
  try {
    if (request.url === "/fixture.js") {
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      response.end(fs.readFileSync(path.join(downloadDir, "fixture.js")));
      return;
    }
    if (request.url === "/fixture.css") {
      response.writeHead(200, { "Content-Type": "text/css", "Cache-Control": "no-store" });
      response.end(fs.readFileSync(path.join(downloadDir, "fixture.css")));
      return;
    }
    if (request.url === "/query") {
      const body = await readBody(request);
      const { name, args } = JSON.parse(body.toString("utf8"));
      assert.equal(name, "verificationArchive.accountDocuments");
      const value = await archive.accountDocuments.handler(ctx, args);
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(value));
      return;
    }
    if (request.url === "/mutation") {
      await readBody(request);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end(error instanceof Error ? error.stack : String(error));
  }
});

let client;
let chrome;
const oldCdpUrl = process.env.DBC_CDP_URL;
let siteServer;

(async () => {
  siteServer = http.createServer(async (request, response) => {
    const body = request.method === "POST" ? await readBody(request) : Buffer.alloc(0);
    const logRow = { method: request.method, url: request.url, origin: request.headers.origin, headers: request.headers, body: body.toString("utf8") };
    requestLog.push(logRow);
    try {
      const webRequest = fromNodeRequest(request, body);
      const handler = request.method === "OPTIONS" ? documentOptions : documentRead;
      if (!handler) throw Error("Unexpected local route request");
      const webResponse = await handler(ctx, webRequest);
      logRow.status = webResponse.status;
      await sendWebResponse(webResponse, response);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise(resolve => siteServer.listen(0, "127.0.0.1", resolve));
  await new Promise(resolve => appServer.listen(0, "127.0.0.1", resolve));
  const appOrigin = `http://127.0.0.1:${appServer.address().port}`;
  const siteOrigin = `http://127.0.0.1:${siteServer.address().port}`;
  process.env.APP_URL = appOrigin;

  const source = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { AccountDocuments } from './src/components/admin/AccountDocuments';
    createRoot(document.getElementById('root')).render(
      <AccountDocuments token=${JSON.stringify(adminToken)} accountId=${JSON.stringify(accountId)} customer={{name:'Synthetic renter',email:'fixture@example.invalid',verified:true}} verificationExpiresAt={null} />
    );
  `;
  const fixtureMocks = {
    name: "account-documents-synthetic-browser",
    setup(build) {
      build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api|@\/components\/SmartImage)$/ }, args => ({ path: args.path, namespace: "account-documents-fixture" }));
      build.onLoad({ filter: /.*/, namespace: "account-documents-fixture" }, args => {
        if (args.path === "convex/react") return { loader: "tsx", resolveDir: root, contents: `import {useEffect,useState} from 'react';export function useQuery(name,args){const [value,setValue]=useState(undefined);useEffect(()=>{let active=true;fetch('/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args}),cache:'no-store'}).then(response=>{if(!response.ok)throw Error('fixture query failed');return response.json()}).then(result=>{if(active)setValue(result)});return()=>{active=false}},[name,JSON.stringify(args)]);return value}export function useMutation(name){return async args=>{const response=await fetch('/mutation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});if(!response.ok)throw Error('fixture mutation failed');return response.json()}}` };
        if (args.path === "@cvx/_generated/api") return { loader: "js", resolveDir: root, contents: `export const api=new Proxy({},{get:(_,group)=>new Proxy({},{get:(_,method)=>group+'.'+method})});` };
        return { loader: "tsx", resolveDir: root, contents: `import React from 'react';export function SmartImage({src,alt='',className=''}){return <img src={src} alt={alt} className={className}/>} ` };
      });
    },
  };
  const bundle = await esbuild.build({
    stdin: { contents: source, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    outdir: path.join(downloadDir, "bundle"),
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    target: ["chrome120"],
    loader: { ".css": "local-css" },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "process.env.NEXT_PUBLIC_CONVEX_SITE_URL": JSON.stringify(siteOrigin),
    },
    plugins: [fixtureMocks],
  });
  const jsOutput = bundle.outputFiles.find(file => file.path.endsWith(".js"));
  const cssOutput = bundle.outputFiles.find(file => file.path.endsWith(".css"));
  assert(jsOutput && cssOutput, "The component and its real local CSS both bundle for the browser fixture");
  fs.writeFileSync(path.join(downloadDir, "fixture.js"), jsOutput.text);
  fs.writeFileSync(path.join(downloadDir, "fixture.css"), cssOutput.text);

  const optionsResponse = await documentOptions(ctx, new Request(`${siteOrigin}/admin-verification-document`, { method: "OPTIONS", headers: { Origin: appOrigin } }));
  assert.equal(optionsResponse.status, 204, "The fixture browser origin passes actual route preflight");
  assert.equal(optionsResponse.headers.get("access-control-allow-origin"), appOrigin);
  assert.match(optionsResponse.headers.get("access-control-allow-headers") ?? "", /X-DBC-Admin-Session/i);
  const deniedOptions = await documentOptions(ctx, new Request(`${siteOrigin}/admin-verification-document`, { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:9" } }));
  assert.equal(deniedOptions.status, 403, "An unlisted origin is rejected before document access");

  const { adminSessionMigrationReady } = load("convex/adminAccountSessionV2.ts");
  assert.equal(adminSessionMigrationReady(), false, "This checkout keeps the V2 migration readiness gate closed");

  const profile = path.join(downloadDir, "chrome-profile");
  const debuggingPort = "0";
  chrome = spawn(process.env.CHROME_BIN || "/opt/google/chrome/chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--disable-component-update",
    `--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  let port;
  for (let attempt = 0; !port && attempt < 100; attempt++) {
    try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; }
    catch { await wait(100); }
  }
  assert(port, "A dedicated local headless Chrome instance starts");
  process.env.DBC_CDP_URL = `http://127.0.0.1:${port}`;
  client = await connect("about:blank");
  await client.cmd("Page.enable");
  await client.cmd("Runtime.enable");
  await client.cmd("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: downloadDir, eventsEnabled: true });
  const downloadEvents = [];
  client.on(event => {
    if (event.method === "Browser.downloadWillBegin") downloadEvents.push({ guid: event.params.guid, state: "started", suggestedFilename: event.params.suggestedFilename });
    if (event.method === "Browser.downloadProgress") downloadEvents.push({ guid: event.params.guid, state: event.params.state });
  });
  await client.cmd("Page.navigate", { url: `${appOrigin}/` });
  async function until(expression, message) {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await client.evaluate(expression)) return;
      await wait(50);
    }
    const body = await client.evaluate("document.body.innerText").catch(() => "<unavailable>");
    throw Error(`Timed out waiting for ${message}: ${expression}; page=${JSON.stringify(body)}; route=${JSON.stringify(requestLog.map(row => ({ method: row.method, status: row.status, origin: row.origin, body: row.body })))}`);
  }

  await until(`!!document.querySelector('[data-testid="retained-documents-page"]')`, "real AccountDocuments mount");
  await until(`(()=>{const img=document.querySelector('[aria-label="Document preview"] img[alt="Proof of identity · front"]');return !!img&&img.complete&&img.naturalWidth===1})()`, "synthetic identity preview image");
  assert.equal(await client.evaluate(`document.querySelector('[aria-label="Document preview"] img[alt="Proof of identity · front"]')?.src.startsWith('blob:')`), true, "The real component previews the route response as a private object URL");
  assert(requestLog.some(row => row.method === "OPTIONS"), "Cross-origin browser fetch performs a real preflight");
  assert(requestLog.some(row => row.method === "POST" && JSON.parse(row.body).documentId === savedDocuments[0]._id), "The image preview requested the selected synthetic document ID");
  const browserPosts = requestLog.filter(row => row.method === "POST");
  assert(browserPosts.length > 0 && browserPosts.every(row => row.headers.authorization === `Bearer ${adminToken}`), "Legacy preview/download requests use the fixture admin bearer token");
  assert(browserPosts.every(row => !row.headers["x-dbc-admin-session"]), "The current AccountDocuments client does not claim V2 support with a missing session header");

  async function downloadAndVerify(label, expectedBytes, expectedHash) {
    const previousGuids = new Set(downloadEvents.filter(event => event.state === "started").map(event => event.guid));
    await client.evaluate(`(()=>{const button=[...document.querySelectorAll('button[aria-label]')].find(item=>item.getAttribute('aria-label')===${JSON.stringify(`Download ${label}`)});if(!button)throw Error('Missing download button: '+${JSON.stringify(label)});button.click()})()`);
    let started;
    for (let attempt = 0; attempt < 120; attempt++) {
      started = downloadEvents.find(event => event.state === "started" && !previousGuids.has(event.guid));
      if (started && downloadEvents.some(event => event.guid === started.guid && event.state === "completed")) break;
      await wait(50);
    }
    assert(started && downloadEvents.some(event => event.guid === started.guid && event.state === "completed"), `The browser completes the ${label} download`);
    const actual = fs.readFileSync(path.join(downloadDir, started.guid));
    assert.equal(actual.length, expectedBytes.length, `${label} download byte length matches the in-memory fixture`);
    assert.equal(hash(actual), expectedHash, `${label} download SHA-256 matches the in-memory fixture`);
  }

  await downloadAndVerify("Proof of identity · front", pngBytes, hash(pngBytes));
  await client.evaluate(`(()=>{const button=[...document.querySelectorAll('button[aria-label]')].find(item=>item.getAttribute('aria-label')==='View Proof of address');if(!button)throw Error('Missing proof of address view control');button.click()})()`);
  await until(`(()=>{const frame=document.querySelector('[aria-label="Document preview"] iframe[title="Proof of address"]');return !!frame&&frame.src.startsWith('blob:')})()`, "synthetic PDF preview");
  assert(requestLog.some(row => row.method === "POST" && JSON.parse(row.body).documentId === savedDocuments[1]._id), "Selecting proof of address requests the PDF through the same route");
  await downloadAndVerify("Proof of address", pdfBytes, hash(pdfBytes));

  const contentResponse = await documentRead(ctx, new Request(`${siteOrigin}/admin-verification-document`, {
    method: "POST", headers: { Origin: appOrigin, Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ documentId: savedDocuments[0]._id }),
  }));
  assert.equal(contentResponse.status, 200);
  assert.equal(contentResponse.headers.get("cache-control"), "no-store");
  assert.equal(contentResponse.headers.get("content-type"), "image/png");
  assert.equal(contentResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(hash(Buffer.from(await contentResponse.arrayBuffer())), hash(pngBytes), "The route returns only the matching in-memory fixture bytes");

  const mutationCount = downloadAccessCalls;
  const badAuth = await documentRead(ctx, new Request(`${siteOrigin}/admin-verification-document`, {
    method: "POST", headers: { Origin: appOrigin, Authorization: "Bearer not-admin", "Content-Type": "application/json" },
    body: JSON.stringify({ documentId: savedDocuments[0]._id }),
  }));
  assert.equal(badAuth.status, 403, "The actual archive access mutation denies an invalid admin token");
  assert.equal(downloadAccessCalls, mutationCount + 1, "Authentication is checked by the real access mutation");

  const savedPng = fileBytes.get(imageMetadata.storageId);
  fileBytes.set(imageMetadata.storageId, Buffer.from("corrupt synthetic bytes"));
  const corrupt = await documentRead(ctx, new Request(`${siteOrigin}/admin-verification-document`, {
    method: "POST", headers: { Origin: appOrigin, Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ documentId: savedDocuments[0]._id }),
  }));
  assert.equal(corrupt.status, 409, "Byte tampering is rejected by the actual HTTP route integrity check");
  assert.equal(corrupt.headers.get("cache-control"), "no-store");
  fileBytes.set(imageMetadata.storageId, savedPng);

  const v2Before = process.env.ADMIN_SESSION_VERIFICATION_V2;
  process.env.ADMIN_SESSION_VERIFICATION_V2 = "enabled";
  const v2NoSession = await documentRead(ctx, new Request(`${siteOrigin}/admin-verification-document`, {
    method: "POST", headers: { Origin: appOrigin, Authorization: "Bearer synthetic-identity-jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ documentId: savedDocuments[0]._id }),
  }));
  assert.equal(v2NoSession.status, 403, "V2 requires both identity bearer and X-DBC-Admin-Session");
  assert.equal(adminSessionMigrationReady(), false, "The V2 migration gate remains closed in the application source");
  const v2ReadyButClosed = await documentRead(ctx, new Request(`${siteOrigin}/admin-verification-document`, {
    method: "POST", headers: { Origin: appOrigin, Authorization: "Bearer synthetic-identity-jwt", "X-DBC-Admin-Session": "a".repeat(64), "Content-Type": "application/json" },
    body: JSON.stringify({ documentId: savedDocuments[0]._id }),
  }));
  assert.equal(v2ReadyButClosed.status, 503, "Dual V2 headers reach the deliberately closed readiness gate, never return bytes");
  if (v2Before === undefined) delete process.env.ADMIN_SESSION_VERIFICATION_V2;
  else process.env.ADMIN_SESSION_VERIFICATION_V2 = v2Before;

  const oldStatus = booking.status;
  const oldReturnedAt = booking.returnedAt;
  booking.status = "returned";
  booking.returnedAt = Date.now() - 91 * 86400000;
  const expired = await documentRead(ctx, new Request(`${siteOrigin}/admin-verification-document`, {
    method: "POST", headers: { Origin: appOrigin, Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ documentId: savedDocuments[0]._id }),
  }));
  assert.equal(expired.status, 410, "The real archive retention rule denies expired synthetic bytes");
  booking.status = oldStatus;
  booking.returnedAt = oldReturnedAt;

  console.log("PASS AccountDocuments synthetic browser: actual local Convex HTTP route + actual downloadAccess, image/PDF preview and hash-verified downloads, CORS/auth/integrity/retention negatives, V2 header/readiness guard; no customer data or provider calls.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (client) {
    try { await fetch(`${process.env.DBC_CDP_URL}/json/close/${client.tabId}`); } catch {}
    client.close();
  }
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once("exit", resolve));
    chrome.kill();
    await exited;
  }
  for (const server of [siteServer, appServer]) {
    if (!server) continue;
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  if (oldCdpUrl === undefined) delete process.env.DBC_CDP_URL;
  else process.env.DBC_CDP_URL = oldCdpUrl;
  if (originalEnv.adminToken === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = originalEnv.adminToken;
  if (originalEnv.verificationV2 === undefined) delete process.env.ADMIN_SESSION_VERIFICATION_V2;
  else process.env.ADMIN_SESSION_VERIFICATION_V2 = originalEnv.verificationV2;
  if (originalEnv.appUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalEnv.appUrl;
  fs.rmSync(downloadDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
