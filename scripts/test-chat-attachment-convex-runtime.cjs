const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { ConvexHttpClient } = require("convex/browser");
const { makeFunctionReference } = require("convex/server");
const root = path.resolve(__dirname, ".."), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-attachment-runtime-"));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, scannerServer, scannerTmp, cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (child?.pid) {
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) await sleep(100);
    if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  if (scannerServer) { scannerServer.closeAllConnections(); await new Promise(resolve => scannerServer.close(resolve)); }
  if (scannerTmp) fs.rmSync(scannerTmp, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) process.once(signal, () => cleanup().finally(() => process.exit(code)));
async function main() {
  for (const name of ["convex", "shared", "src/lib"]) fs.cpSync(path.join(root, name), path.join(workspace, name), { recursive: true });
  for (const name of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(root, name), path.join(workspace, name));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(workspace, "node_modules"), "dir");
  fs.rmSync(path.join(workspace, "convex/crons.ts"), { force: true });
  fs.copyFileSync(path.join(__dirname, "fixtures/chat-attachment-runtime.ts.fixture"), path.join(workspace, "convex/chat_attachment_qualify.ts"));
  const scanner = path.join(workspace, "convex/lib/chatAttachmentScanner.ts");
  const socket = process.env.DBC_CLAMD_TEST_SOCKET;
  if (socket) {
    if (!socket.startsWith("/tmp/")) throw Error("A dedicated local scanner socket is required.");
    scannerTmp = fs.mkdtempSync("/dev/shm/dbc-scanner-runtime-");
    scannerServer = require("../services/chat-scanner/scanner.cjs").createScannerServer({ token: "synthetic-isolated-scanner-token-32-characters", socketPath: socket, tmpDir: scannerTmp });
    await new Promise(resolve => scannerServer.listen(0, "127.0.0.1", resolve));
    let source = fs.readFileSync(scanner, "utf8");
    const calls = [
      ["(options.fetcher ?? fetch)(endpoint, {", `(options.fetcher ?? fetch)("http://127.0.0.1:${scannerServer.address().port}/scan", {`],
      ["(config.fetcher ?? fetch)(endpoint, {", `(config.fetcher ?? fetch)("http://127.0.0.1:${scannerServer.address().port}/health", {`],
    ];
    if (calls.some(([call]) => !source.includes(call))) throw Error("The isolated scanner bridge no longer matches the application.");
    for (const [call, replacement] of calls) source = source.replace(call, replacement);
    fs.writeFileSync(scanner, source);
  } else fs.writeFileSync(scanner, `export const CHAT_ATTACHMENT_LIMIT=10*1024*1024;\nexport function chatAttachmentsReady(){return true;}\nexport async function chatAttachmentScannerHealthy(){return true;}\nexport async function scanChatAttachment(){return {engine:'synthetic',signatureVersion:'fixture',signatureUpdatedAt:Date.now()};}\n`);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CONVEX_AGENT_MODE: "anonymous", XDG_CONFIG_HOME: path.join(workspace, "config") };
  child = spawn(path.join(root, "node_modules/.bin/convex"), ["dev", "--typecheck", "disable", "--codegen", "disable", "--tail-logs", "disable"], { cwd: workspace, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", data => output += data); child.stderr.on("data", data => output += data);
  for (let attempt = 0; attempt < 180 && !output.includes("Convex functions ready!") && child.exitCode === null && child.signalCode === null; attempt++) await sleep(1000);
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  if (!match || !output.includes("Convex functions ready!") || !(output.includes("[Local]") || output.includes("Configured a local deployment"))) throw Error(`Isolated backend did not start: ${output.slice(-1200)}`);
  if (socket) for (const [key, value] of [["CHAT_ATTACHMENT_SCANNER_URL", "https://scanner.example.invalid/scan"], ["CHAT_ATTACHMENT_SCANNER_TOKEN", "synthetic-isolated-scanner-token-32-characters"], ["CHAT_ATTACHMENTS_RELEASE_ENABLED", "enabled"]]) execFileSync(path.join(root, "node_modules/.bin/convex"), ["env", "set", key, value], { cwd: workspace, env, stdio: "ignore" });
  const client = new ConvexHttpClient(match[0]), seed = makeFunctionReference("chat_attachment_qualify:seed"), inspect = makeFunctionReference("chat_attachment_qualify:inspect");
  const fixture = await client.mutation(seed, {}), endpoint = `http://127.0.0.1:${Number(match[1]) + 1}/chat-attachment`;
  const png = await require("sharp")({ create: { width: 2, height: 2, channels: 3, background: "#abcdef" } }).png().toBuffer();
  const headers = { origin: "https://dbcinemarentals.com", authorization: "Bearer synthetic-owner", "content-type": "image/png", "x-chat-filename": "fixture.png" };
  const url = `${endpoint}?bookingId=${fixture.bookingId}&key=${"a".repeat(32)}`;
  const responses = await Promise.all([fetch(url, { method: "POST", headers, body: png }), fetch(url, { method: "POST", headers, body: png })]);
  assert(responses.some(response => response.status === 200));
  assert(responses.every(response => [200, 409].includes(response.status)));
  assert.equal((await fetch(url, { method: "POST", headers, body: png })).status, 200);
  const different = Buffer.from(png); different[30] ^= 1;
  assert.equal((await fetch(url, { method: "POST", headers, body: different })).status, 403, "A reused key cannot report a different file as sent");
  assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "x-chat-filename": "another.png" }, body: png })).status, 403, "A reused key cannot report a differently named attachment as sent");
  let state = await client.query(inspect, { accountId: fixture.accountId });
  assert.equal(state.attempts.length, 1); assert.equal(state.attempts[0].status, "published"); assert.equal(state.messages.length, 1);assert.equal(state.messages[0].meta.contentType,"image/png","Published message binds the validated image type");
  const download = `${endpoint}?bookingId=${fixture.bookingId}&download=${state.attempts[0]._id}`;
  const result = await fetch(download, { method: "POST", headers }); assert.equal(result.status, 200); assert.deepEqual(Buffer.from(await result.arrayBuffer()), png);
  const preview=`${endpoint}?bookingId=${fixture.bookingId}&preview=${state.attempts[0]._id}`;
  const previewResponse=await fetch(preview,{method:"POST",headers});assert.equal(previewResponse.status,200);assert.equal(previewResponse.headers.get("content-type"),"image/png");assert.match(previewResponse.headers.get("content-disposition"),/^inline;/);assert.match(previewResponse.headers.get("content-security-policy"),/sandbox/);assert.deepEqual(Buffer.from(await previewResponse.arrayBuffer()),png,"Authenticated preview returns the same integrity-checked bytes as download");
  assert.equal((await fetch(`${preview}&download=${state.attempts[0]._id}`,{method:"POST",headers})).status,400,"A request cannot mix preview and download modes");
  assert.equal((await fetch(download, { method: "POST", headers: { ...headers, authorization: "Bearer synthetic-other" } })).status, 403);
  assert.equal((await fetch(preview, { method: "POST", headers: { ...headers, authorization: "Bearer synthetic-other" } })).status, 403);
  assert.equal((await fetch(`${endpoint}?bookingId=${fixture.bookingId}&key=${"b".repeat(32)}`, { method: "POST", headers: { ...headers, authorization: "Bearer synthetic-other" }, body: png })).status, 403);
  const binding = makeFunctionReference("chat_attachment_qualify:setMessageBinding"), messageId = state.attempts[0].messageId;
  await client.mutation(binding, { messageId });
  assert.equal((await fetch(download, { method: "POST", headers })).status, 403, "An unbound conversation message cannot expose attachment bytes");
  assert.equal((await fetch(preview, { method: "POST", headers })).status, 403, "An unbound conversation message cannot preview attachment bytes");
  await client.mutation(binding, { messageId, attachmentId: state.attempts[0]._id });
  assert.equal((await fetch(download, { method: "POST", headers })).status, 200, "Restoring the original binding restores the original owner's access");
  assert.equal((await fetch(preview, { method: "POST", headers })).status, 200, "Restoring the original binding restores the original owner's preview");
  if (socket) {
    const eicar = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
    const data = Buffer.concat([Buffer.from('Comment\0'), eicar]), type = Buffer.from('tEXt'), chunk = Buffer.alloc(data.length + 12);
    chunk.writeUInt32BE(data.length, 0); type.copy(chunk, 4); data.copy(chunk, 8);
    let crc = 0xffffffff; for (const byte of Buffer.concat([type, data])) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
    const infected = Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
    assert.equal(await require('../services/chat-scanner/scanner.cjs').clamdCommand(socket, 'INSTREAM', infected), 'stream: OK', 'The engine alone misses this harmless signature inside PNG metadata');
    assert.equal((await fetch(`${endpoint}?bookingId=${fixture.bookingId}&key=${"e".repeat(32)}`, { method: "POST", headers, body: infected })).status, 403, "PNG metadata cannot bypass structural validation");
    for (const [format, contentType, key] of [['jpeg','image/jpeg','f'],['webp','image/webp','1']]) {
      const clean = await require('sharp')({ create: { width: 2, height: 2, channels: 3, background: '#abcdef' } }).toFormat(format).toBuffer();
      let hidden;
      if (format === 'jpeg') {
        const payload = Buffer.concat([Buffer.from('XMP\0'), eicar]), marker = Buffer.alloc(4);
        marker[0] = 255; marker[1] = 0xed; marker.writeUInt16BE(payload.length + 2, 2);
        hidden = Buffer.concat([clean.subarray(0, 2), marker, payload, clean.subarray(2)]);
      } else {
        const marker = Buffer.alloc(8); marker.write('XMP ', 0); marker.writeUInt32LE(eicar.length, 4);
        hidden = Buffer.concat([clean, marker, eicar, Buffer.alloc(eicar.length % 2)]); hidden.writeUInt32LE(hidden.length - 8, 4);
      }
      assert.equal(await require('../services/chat-scanner/scanner.cjs').clamdCommand(socket, 'INSTREAM', hidden), 'stream: OK', `The engine alone misses ${format} metadata`);
      const fileHeaders = { ...headers, 'content-type': contentType, 'x-chat-filename': `fixture.${format}` };
      assert.equal((await fetch(`${endpoint}?bookingId=${fixture.bookingId}&key=${key.repeat(32)}`, { method: 'POST', headers: fileHeaders, body: hidden })).status, 403, `${format} metadata cannot bypass structural validation`);
      const cleanKey = format === 'jpeg' ? '2' : '3';
      assert.equal((await fetch(`${endpoint}?bookingId=${fixture.bookingId}&key=${cleanKey.repeat(32)}`, { method: 'POST', headers: fileHeaders, body: clean })).status, 200, `A clean ${format} can be sent`);
    }
    const appended = Buffer.concat([png, Buffer.from("EICAR synthetic trailing payload")]);
    assert.equal((await fetch(`${endpoint}?bookingId=${fixture.bookingId}&key=${"c".repeat(32)}`, { method: "POST", headers, body: appended })).status, 403, "The real scanner rejects malformed trailing content");
    const encrypted = path.join(workspace, "encrypted.pdf");
    execFileSync("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-sOwnerPassword=fixture-owner", "-sUserPassword=fixture-user", `-sOutputFile=${encrypted}`, "-c", "/Helvetica findfont 12 scalefont setfont 50 700 moveto (Synthetic fixture) show showpage"]);
    assert.equal((await fetch(`${endpoint}?bookingId=${fixture.bookingId}&key=${"d".repeat(32)}`, { method: "POST", headers: { ...headers, "content-type": "application/pdf", "x-chat-filename": "encrypted.pdf" }, body: fs.readFileSync(encrypted) })).status, 403, "Encrypted documents cannot enter chat");
  }
  let replayLimited = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch(url, { method: "POST", headers, body: png });
    if (response.status === 403) { replayLimited = true; break; }
    assert.equal(response.status, 200);
  }
  assert(replayLimited, "Published-upload retries are rate-limited before reading another body");
  state = await client.query(inspect, { accountId: fixture.accountId }); assert.equal(state.messages.length, socket ? 3 : 1);
  await client.mutation(makeFunctionReference("chat_attachment_qualify:expireSession"), {});
  assert.equal((await fetch(download, { method: "POST", headers })).status, 403, "An expired renter session cannot download an existing file");
  console.log(`PASS isolated local Convex attachment upload, atomic publication, content-bound retry, byte-exact download and cross-account denial. Scanner: ${socket ? "real isolated ClamAV and adapter via test-only loopback" : "synthetic"}; readiness gate is test-only. No production data or providers.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(cleanup);
