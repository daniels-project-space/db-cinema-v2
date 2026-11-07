const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { spawn } = require("node:child_process");
const { ConvexHttpClient } = require("convex/browser"), { makeFunctionReference } = require("convex/server");
const root = path.resolve(__dirname, ".."), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dbc-gaffer-catalogue-")), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
async function cleanup() { if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; } for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await sleep(100); if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } } fs.rmSync(workspace, { recursive: true, force: true }); }
(async () => {
  for (const name of ["convex", "shared", "src/lib"]) fs.cpSync(path.join(root, name), path.join(workspace, name), { recursive: true });
  for (const name of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(root, name), path.join(workspace, name));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(workspace, "node_modules"), "dir");
  fs.rmSync(path.join(workspace, "convex/crons.ts"), { force: true });
  fs.copyFileSync(path.join(__dirname, "fixtures/gaffer-catalogue-runtime.ts.fixture"), path.join(workspace, "convex/gaffer_catalogue_qualify.ts"));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CONVEX_AGENT_MODE: "anonymous", XDG_CONFIG_HOME: path.join(workspace, "config") };
  child = spawn(path.join(root, "node_modules/.bin/convex"), ["dev", "--typecheck", "disable", "--codegen", "disable", "--tail-logs", "disable"], { cwd: workspace, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", data => output += data); child.stderr.on("data", data => output += data);
  for (let i = 0; i < 180 && !output.includes("Convex functions ready!") && child.exitCode === null && child.signalCode === null; i++) await sleep(1000);
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
  if (!match || !output.includes("[Local]") || !output.includes("Convex functions ready!")) throw Error(`Isolated backend did not start: ${output.slice(-1200)}`);
  const client = new ConvexHttpClient(match[0]);
  await client.mutation(makeFunctionReference("gaffer_catalogue_qualify:seed"), {});
  const result = await client.action(makeFunctionReference("gaffer_catalogue_qualify:find"), { category: "Cameras", search: "fx3" });
  assert.deepEqual(result, { listings: [{ title: "Sony FX3 camera", slug: "gaffer-fx3-ok", category: "Cameras", daily: 48 }], availability: "unchecked" });
  const category = await client.action(makeFunctionReference("gaffer_catalogue_qualify:find"), { category: "Cameras" });
  assert.equal(category.listings.length, 1);
  const absent = await client.action(makeFunctionReference("gaffer_catalogue_qualify:find"), { search: "xyz123none" });
  assert.deepEqual(absent, { listings: [], availability: "unchecked" });
  console.log("PASS isolated Convex catalogue indexes and rentable filtering; synthetic data only.");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(cleanup);
