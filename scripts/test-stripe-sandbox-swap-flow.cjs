const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const Stripe = require("stripe");
const { load, db, put, setMock } = require("./lib/rentalTestHarness.cjs");
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const browserSource=fs.readFileSync(path.join(__dirname,'test-membership-browser.cjs'),'utf8');
const connect=new Function('require',browserSource.slice(0,browserSource.indexOf('const { ConvexHttpClient }'))+';return connect;')(require);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function payTestCheckout(url,stripe,sessionId){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dbc-stripe-test-checkout-'));
 const browser=spawn('/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`],{stdio:'ignore',detached:true});let client;
 try{
  let port;for(let i=0;i<150;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break}catch{await wait(100)}}if(!port)throw Error('Test browser did not start');
  process.env.DBC_CDP_URL=`http://127.0.0.1:${port}`;client=await connect();await client.cmd('Page.enable');await client.cmd('Page.navigate',{url});
  let card;for(let i=0;i<90;i++){card=await client.evaluate(`(()=>{const e=document.getElementById('payment-method-label-card');if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()`);if(card)break;await wait(1000)}
  if(card){await client.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:card.x,y:card.y,button:'left',clickCount:1});await client.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:card.x,y:card.y,button:'left',clickCount:1});}
  for(let i=0;i<90;i++){if(await client.evaluate(`!!document.querySelector('input[name="cardNumber"]')`))break;await wait(1000)}
  const inputs=await client.evaluate(`Array.from(document.querySelectorAll('input,select')).map(e=>({tag:e.tagName,name:e.name,id:e.id,placeholder:e.placeholder}))`);
  if(!inputs.some(input=>input.name==='cardNumber'))throw Error(`Stripe test checkout card form not found: ${JSON.stringify(inputs)}`);
  async function type(selector,value){const found=await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();return true})()`);if(found)await client.cmd('Input.insertText',{text:value});return found;}
  await type('input[name="cardNumber"]','4242424242424242');await type('input[name="cardExpiry"]','1234');await type('input[name="cardCvc"]','123');await type('input[name="billingName"]','Synthetic Renter');await type('input[name="billingPostalCode"]','WC2N 5EJ');
  await client.evaluate(`(()=>{const b=document.querySelector('button[type="submit"]');if(!b)throw Error('Missing Stripe test submit');b.click()})()`);
  for(let i=0;i<90;i++){const session=await stripe.checkout.sessions.retrieve(sessionId);if(session.status==='complete'&&session.payment_status==='paid')return session;await wait(1000)}
  throw Error('Stripe test checkout did not complete; no live money involved');
 }finally{if(client)client.close();if(browser.pid)try{process.kill(-browser.pid,'SIGTERM')}catch(error){if(error.code!=='ESRCH')throw error}await new Promise(resolve=>browser.exitCode!==null||browser.signalCode!==null?resolve():browser.once('exit',resolve));await wait(500);fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}

(async () => {
  const key = process.env.STRIPE_TEST_SECRET_KEY;
  if (!/^(sk|rk)_test_/.test(key ?? "")) throw Error("A Stripe test-mode key is required; no live key is accepted.");
  process.env.STRIPE_SECRET_KEY = key;
  process.env.ADMIN_TOKEN = "fixture-admin";
  process.env.RENTAL_ITEM_SWAP_ENABLED = "true";
  const run=randomUUID(),originalInsert=db.insert;
  db.insert=async(table,data)=>table==='rental_item_swaps'?put(table,{...data,_id:`rental_item_swaps-${run}-${randomUUID()}`})._id:originalInsert(table,data);
  setMock("stripe", { default: Stripe });
  setMock("./lib/rentalChat", { ...load("convex/lib/rentalChat.ts"), postRentalMessage: async () => {} });
  setMock("./lib/rentalSwapAuthority", { assertSwapAuthorityAvailable: () => {}, swapAuthorityAvailable: () => false });
  const state = load("convex/rentalSwapState.ts");
  const operations = load("convex/rentalOperations.ts");
  const stock = load("convex/swapStockOperations.ts");
  const payments = load("convex/rentalSwapPayments.ts");
  const ctx = { db, scheduler: { runAfter: async () => {} } };
  const modules = { rentalSwapState: state, rentalOperations: operations, swapStockOperations: stock };
  ctx.runMutation = async (ref, args) => { const [name, method] = ref.split("."); return modules[name][method].handler(ctx, args); };
  ctx.runQuery = async (ref, args) => { const [name, method] = ref.split("."); return modules[name][method].handler(ctx, args); };
  ctx.runAction = async (ref, args) => {
    if (ref === "swapStockOperations.recover") return stock.recover.handler(ctx, args);
    if (ref === "sharedStockBridge.send") {
      const request = args.request;
      return { status: "confirmed", result: request.operation === "acquire" ? { requestId: request.args.requestId, fingerprint: JSON.stringify(request.args.items), state: "prepared", replayed: false } : { state: request.operation === "beginExecution" ? "execution_started" : "released", replayed: false } };
    }
    throw Error(`Unexpected action ${ref}`);
  };
  put("rmv2_sync_state", { key: "shared-stock-v1", status: "ok", lastSyncedAt: Date.now(), cursor: JSON.stringify({ checkedAt: Date.now() }) });
  const account = put("accounts", { email: "sandbox-renter@example.invalid" });
  put("sessions", { accountId: account._id, token: "sandbox-renter-token", expiresAt: Date.now() + 3600000 });
  const oldUnit = put("inventory_units", { name: "Original fixture", quantityOwned: 1, rmv2ItemId: "manager_original_fixture" });
  const newUnit = put("inventory_units", { name: "Replacement fixture", quantityOwned: 1, rmv2ItemId: "manager_replacement_fixture" });
  const original = put("listings", { title: "Original fixture", active: true, depositAmount: 100, pricing: { daily: 10 }, components: [{ inventoryUnitId: oldUnit._id, qty: 1 }] });
  const replacement = put("listings", { title: "Replacement fixture", active: true, depositAmount: 100, pricing: { daily: 6 }, components: [{ inventoryUnitId: newUnit._id, qty: 1 }] });
  const date = Date.UTC(2031, 1, 1);
  const line = { listingId: original._id, title: original.title, start: date, end: date, qty: 1, lineTotal: 10 };
  const booking = put("bookings", { accountId: account._id, guestEmail: account.email, status: "confirmed", subtotal: 10, total: 10, depositAmount: 0, pricingVersion: "single-benefit-v1", benefitKind: "none", creditAllocations: [], checkoutLineCreditSources: [], checkoutLineFunding: [{ listingId: original._id, start: date, end: date, qty: 1, gross: 10, discount: 0, membershipCredit: 0, accountCredit: 0, card: 10 }], lineItems: [line], replacementValues: [{ listingId: original._id, unitPence: 10000 }] });
  put("reservations", { bookingId: booking._id, listingId: original._id, inventoryUnitId: oldUnit._id, start: date, end: date, qty: 1, source: "site", status: "confirmed" });
  const stripe = new Stripe(key);
  const intent = await stripe.paymentIntents.create({ amount: 1000, currency: "gbp", payment_method: "pm_card_visa", confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: "never" }, metadata: { bookingId: String(booking._id), fixture: "dbc_swap_flow_test", run } }, { idempotencyKey: `dbc-swap-flow-payment-${run}` });
  assert.equal(intent.livemode, false);
  assert.equal(intent.status, "succeeded");
  booking.stripePaymentIntentId = intent.id;
  const args = { token: process.env.ADMIN_TOKEN, bookingId: booking._id, lineIndex: 0, newListingId: replacement._id };
  const preview = await state.preview.handler(ctx, args);
  assert.equal(preview.quote.deltaPence, -400);
  const id = await state.propose.handler(ctx, { ...args, requestId: `fixture-${run}`, quoteSnapshot: preview.quoteSnapshot, confirmed: true });
  const acceptance = { token: "sandbox-renter-token", id, confirmed:true,expectedDeltaPence: -400 };
  const result = await payments.accept.handler(ctx, acceptance);
  assert.equal(result.applied, true);
  assert.equal(booking.lineItems[0].listingId, replacement._id);
  assert.equal(booking.activeItemSwapId, undefined);
  assert.equal((await state.context.handler(ctx, { id })).swap.status, "applied");
  const receipts = await stripe.refunds.list({ payment_intent: intent.id });
  assert.equal(receipts.data.length, 1);
  assert.equal(receipts.data[0].amount, 400);
  assert.equal(receipts.data[0].status, "succeeded");
  await payments.accept.handler(ctx, acceptance);
  assert.equal((await stripe.refunds.list({ payment_intent: intent.id })).data.length, 1);
  const upgradeOldUnit = put("inventory_units", { name: "Upgrade original", quantityOwned: 1, rmv2ItemId: "manager_upgrade_original" });
  const upgradeNewUnit = put("inventory_units", { name: "Upgrade replacement", quantityOwned: 1, rmv2ItemId: "manager_upgrade_replacement" });
  const upgradeOriginal = put("listings", { title: "Upgrade original", active: true, depositAmount: 100, pricing: { daily: 10 }, components: [{ inventoryUnitId: upgradeOldUnit._id, qty: 1 }] });
  const upgradeReplacement = put("listings", { title: "Upgrade replacement", active: true, depositAmount: 100, pricing: { daily: 15 }, components: [{ inventoryUnitId: upgradeNewUnit._id, qty: 1 }] });
  const upgradeLine = { listingId: upgradeOriginal._id, title: upgradeOriginal.title, start: date, end: date, qty: 1, lineTotal: 10 };
  const upgradeBooking = put("bookings", { accountId: account._id, guestEmail: account.email, status: "confirmed", subtotal: 10, total: 10, depositAmount: 0, pricingVersion: "single-benefit-v1", benefitKind: "none", creditAllocations: [], checkoutLineCreditSources: [], checkoutLineFunding: [{ listingId: upgradeOriginal._id, start: date, end: date, qty: 1, gross: 10, discount: 0, membershipCredit: 0, accountCredit: 0, card: 10 }], lineItems: [upgradeLine], replacementValues: [{ listingId: upgradeOriginal._id, unitPence: 10000 }] });
  put("reservations", { bookingId: upgradeBooking._id, listingId: upgradeOriginal._id, inventoryUnitId: upgradeOldUnit._id, start: date, end: date, qty: 1, source: "site", status: "confirmed" });
  const upgradeArgs = { token: process.env.ADMIN_TOKEN, bookingId: upgradeBooking._id, lineIndex: 0, newListingId: upgradeReplacement._id };
  const upgradePreview = await state.preview.handler(ctx, upgradeArgs);
  assert.equal(upgradePreview.quote.deltaPence, 500);
  const upgradeId = await state.propose.handler(ctx, { ...upgradeArgs, requestId: `upgrade-${run}`, quoteSnapshot: upgradePreview.quoteSnapshot, confirmed: true });
  const upgradeAcceptance = { token: "sandbox-renter-token", id: upgradeId, confirmed:true,expectedDeltaPence: 500 };
  const firstCheckout = await payments.accept.handler(ctx, upgradeAcceptance);
  const retryCheckout = await payments.accept.handler(ctx, upgradeAcceptance);
  assert.equal(retryCheckout.url, firstCheckout.url, "An upgrade retry must reuse its original checkout");
  const upgradeSwap = (await state.context.handler(ctx, { id: upgradeId })).swap;
  const checkout = await stripe.checkout.sessions.retrieve(upgradeSwap.sessionId);
  assert.equal(checkout.livemode, false);
  assert.equal(checkout.amount_total, 500);
  assert.equal(checkout.payment_status, "unpaid");
  assert.equal(upgradeBooking.lineItems[0].listingId, upgradeOriginal._id, "Unpaid upgrades must not change the booking");
  const paidCheckout=await payTestCheckout(checkout.url,stripe,checkout.id);
  assert.equal(paidCheckout.livemode,false);assert.equal(paidCheckout.amount_total,500);
  const final=await payments.finalize.handler(ctx,{sessionId:checkout.id});assert.equal(final.paid,true);assert.equal(final.swapStatus,'applied');
  assert.equal(upgradeBooking.lineItems[0].listingId,upgradeReplacement._id);assert.equal(upgradeBooking.activeItemSwapId,undefined);
  const repeat=await payments.finalize.handler(ctx,{sessionId:checkout.id});assert.equal(repeat.swapStatus,'applied');
  console.log("PASS Stripe test mode: actual downgrade refund and paid hosted upgrade checkout, application and retry; rental data and manager stock responses are synthetic.");
})().catch(error => { console.error(error.message); process.exitCode = 1; });
