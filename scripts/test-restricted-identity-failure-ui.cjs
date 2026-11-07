const assert = require("node:assert/strict");
const esbuild = require("esbuild");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

(async () => {
 const bundle = await esbuild.build({ entryPoints: ["src/components/admin/RestrictedIdentityAlertFailures.tsx"], bundle: true, write: false, platform: "node", format: "cjs", external: ["react"], plugins: [{ name: "fixture", setup(build) {
  build.onResolve({ filter: /^(convex\/react|@cvx\/_generated\/api)$/ }, args => ({ path: args.path, namespace: "fixture" }));
  build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path === "convex/react" ? "export const useQuery=(ref)=>ref==='recheckAttention'?globalThis.__rechecks:globalThis.__identityJobs;export const useMutation=()=>async()=>{};" : "export const api={restrictedIdentityAlerts:{attention:'attention',retry:'retry',recheckAttention:'recheckAttention',retryRecheck:'retryRecheck'}};" }));
 } }] });
 const module = { exports: {} };
 new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
 const Component = module.exports.RestrictedIdentityAlertFailures;
 globalThis.__identityJobs = [];
 assert.equal(renderToStaticMarkup(React.createElement(Component, { token: "admin", onOpen() {} })), "");
 globalThis.__identityJobs = [{ id: "job-1", bookingId: "booking-12345678", attempts: 5 }];
 const markup = renderToStaticMarkup(React.createElement(Component, { token: "admin", onOpen() {} }));
 assert.match(markup, /Identity checks need attention/);
 assert.match(markup, /Verification was not stopped/);
 assert.match(markup, /Open rental/);
 assert.match(markup, /Retry check/);
 assert.match(markup, /12345678/);
 globalThis.__identityJobs=[];globalThis.__rechecks=[{id:'recheck-1',accountId:'account-87654321',attempts:5}];const recheckMarkup=renderToStaticMarkup(React.createElement(Component,{token:'admin',onOpen(){}}));assert.match(recheckMarkup,/Restricted account 87654321/);assert.match(recheckMarkup,/Retry account check/);
 delete globalThis.__identityJobs;
 delete globalThis.__rechecks;
 console.log("PASS identity failure UI: empty state and visible rental/retry controls");
})().catch(error => { console.error(error); process.exitCode = 1; });
