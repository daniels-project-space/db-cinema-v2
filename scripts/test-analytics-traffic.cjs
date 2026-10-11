const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ts = require('typescript');
const { load, db, put, tables } = require('./lib/rentalTestHarness.cjs');
const traffic = load('shared/analyticsTraffic.ts');
process.env.ADMIN_TOKEN = 'fixture-owner';
const analytics = load('convex/analytics.ts');
const now = Date.now();
const types = ['view', 'search', 'search_tag', 'search_no_results', 'add_to_cart', 'register_interest', 'gaffer_connected', 'checkout_start', 'unavailable_request', 'replacement_selected', 'checkout_opened', 'checkout_form_ready', 'checkout_failure', 'payment_redirect'];

function browser({ua='Mozilla/5.0 Chrome/140.0 Safari/537.36', webdriver=false, storage=true}={}) {
  const values = new Map();
  const context = { exports: {}, require: () => traffic, crypto: require('node:crypto').webcrypto, URLSearchParams,
    navigator: { userAgent: ua, webdriver }, window: { location: { pathname: '/gear', search: '' } },
    localStorage: { getItem(k) { if (!storage) throw Error('disabled'); return values.get(k) ?? null; }, setItem(k,v) { if (!storage) throw Error('disabled'); values.set(k,v); } } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/session.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, context);
  return {...context, get: context.exports.getSessionId, values};
}

(async()=>{
  const human = browser(); assert.match(human.get(), /^[a-f0-9-]{36}$/); assert.equal(human.get(),human.get());
  const disabled = browser({storage:false}); assert.equal(disabled.get(),disabled.get());
  for (const ua of ['Googlebot/2.1','bingbot/2.0','HeadlessChrome/140.0','facebookexternalhit/1.1','curl/8.0','Python-requests/2.0','Lighthouse','UptimeRobot']) {
    assert.equal(browser({ua}).get(),'excluded:bot',ua);
  }
  assert.equal(browser({webdriver:true}).get(),'excluded:bot');
  const admin=browser(); admin.values.set('dbc_admin','fixture'); assert.equal(admin.get(),'excluded:internal');
  admin.values.delete('dbc_admin'); assert.equal(admin.get(),'excluded:internal','Admin browser stays excluded after logout');
  assert.equal(browser({ua:'Mozilla/5.0 Firefox/144.0'}).get().startsWith('excluded:'),false);
  const optout=browser(); optout.window.location.search='?analytics=off'; assert.equal(optout.get(),'excluded:internal');
  optout.window.location.search=''; assert.equal(optout.values.get('dbc_analytics_exclude'),'1'); assert.equal(optout.get(),'excluded:internal');
  const visit=browser({storage:false}); visit.window.location.pathname='/admin'; assert.equal(visit.get(),'excluded:internal');
  visit.window.location.pathname='/gear'; assert.equal(visit.get(),'excluded:internal');

  for (const type of types) await analytics.track.handler({db},{type,path:type==='view'?'/gear':'test lens',sessionId:human.get(),qty:2});
  // Server-originated payment receipts have no browser ID and remain authoritative.
  await analytics.track.handler({db},{type:'purchase'});
  const args={token:'fixture-owner',now:now+60000,days:30};
  const ctx={db:{...db,normalizeId:()=>null}};
  const snapshot=async()=>({summary:await analytics.adminSummary.handler(ctx,args),insights:await analytics.insights.handler(ctx,args),demand:await analytics.cartDemand.handler(ctx,args)});
  const before=await snapshot(); const count=tables.get('events').length;
  for(const sessionId of ['excluded:bot','excluded:internal']) for(const type of types)
    await analytics.track.handler({db},{type,path:'/gear',sessionId,qty:99});
  for(const type of types) await analytics.track.handler({db},{type,path:'/admin/customers',sessionId:'legacy-admin'});
  assert.equal(tables.get('events').length,count,'Excluded events never enter storage');
  assert.deepEqual(await snapshot(),before,'All aggregates retain customer activity only');
  // Filters also protect reports containing previously imported excluded rows.
  for(const type of types) {
    put('events',{type,path:'/gear',sessionId:'excluded:internal',at:now,qty:99});
    put('events',{type,path:'/gear',sessionId:'excluded:bot',at:now,qty:99});
    put('events',{type,path:'/admin',sessionId:'legacy-admin',at:now,qty:99});
  }
  assert.deepEqual(await snapshot(),before,'Summary, insights, rankings, live viewers, funnel and cart demand consistently exclude marked history');
  assert.equal(before.insights.pageViews,1); assert.equal(before.insights.searchCount,1);
  assert.equal(before.insights.gaffer,1); assert.equal(before.insights.purchases,1);
  console.log('PASS analytics traffic: real browsers, storage failures, bots, WebDriver, persistent admin/QA opt-out, ingestion and every aggregate; payment receipts preserved.');
})().catch(e=>{console.error(e);process.exitCode=1});
