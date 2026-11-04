const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

(async () => {
  const bundle = await esbuild.build({
    entryPoints: ['src/components/rentals/VerificationProgress.tsx'],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
    plugins: [{ name: 'synthetic-ui-dependencies', setup(build) {
      build.onResolve({ filter: /^(next\/link|next\/navigation|convex\/react|@cvx\/|@\/components\/|\.\/DroneLicence|\.\/VerificationReuseClaim|\.\/useVerificationRefresh|\.\/VerificationProgress\.module\.css)/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', resolveDir: process.cwd(), contents: args.path === 'next/link' ? 'const React=require("react");module.exports=({href,children,...props})=>React.createElement("a",{href,...props},children);' : args.path.endsWith('.css') ? 'module.exports={};' : 'module.exports={api:{},useRouter:()=>({}),useQuery:()=>null,useAction:()=>()=>{},useAccount:()=>({}),IdVerify:()=>null,SmartImage:()=>null,IconCheck:()=>null,IconLock:()=>null,ManagementShell:()=>null,DroneLicenceUpload:()=>null,VerificationReuseClaim:()=>null,useVerificationRefresh:()=>null};' }));
    } }],
  });
  const compiled = new Module(path.join(process.cwd(), 'scripts', '.verification-link-fixture.cjs'), module);
  compiled.filename = path.join(process.cwd(), 'scripts', '.verification-link-fixture.cjs');
  compiled.paths = module.paths;
  compiled._compile(bundle.outputFiles[0].text, compiled.filename);
  const { VerificationLink } = compiled.exports;
  const fixture = { _id: 'synthetic-booking', status: 'confirmed' };
  for (const [state, label] of [['required', 'Open verification and uploads'], ['processing', 'View verification progress'], ['manual_review', 'Verification under review · view progress'], ['requires_input', 'Replace documents · view progress'], ['rejected', 'Verification needs attention · view progress']]) {
    const html = renderToStaticMarkup(React.createElement(VerificationLink, { booking: {...fixture, idVerifyStatus: state}, compact: true }));
    assert(html.includes(label), state);
    assert(html.includes('href="/account/verification/synthetic-booking"'), 'Link stays on the exact rental');
  }
  console.log('PASS actual verification-link component: actionable status-specific labels and exact rental destination; synthetic rendering only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
