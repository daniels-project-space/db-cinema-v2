const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const ts = require('typescript');
const {load,db,put} = require('./lib/rentalTestHarness.cjs');

const realNow = Date.now;
const acceptedAt = 1_800_000_000_000;
Date.now = () => acceptedAt;

const legal = load('shared/legalVersioning.ts');
const {bootstrapCheckoutAccount} = load('convex/membershipBenefits.ts');
const policy = {setupIntentSecurityEnabled:true};
const ctx = {
  db,
  runQuery: async ref => {
    assert.equal(ref,'settings.get','bootstrap reads current legal policy from server settings');
    return policy;
  },
};
const base = {
  email:'guest-membership@example.invalid',
  name:'Guest Membership',
  seedHash:'checkout-seed-1',
  termsAndPrivacyAcknowledged:true,
  accountTermsVersion:legal.legalVersionForPolicy(policy),
  privacyNoticeVersion:legal.CURRENT_PRIVACY_NOTICE_VERSION,
};

function renderMembership({member=null,selected,variant='checkout'}={}) {
  let renderingAccount = member;
  const componentPath = path.resolve(__dirname,'../src/components/CheckoutMembership.tsx');
  const source = fs.readFileSync(componentPath,'utf8');
  const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',code)(name=>{
    if(name==='@/lib/membership') return load('shared/membership.ts');
    if(name==='../../shared/legalVersioning') return legal;
    if(name==='./account/AccountProvider') return {useAccount:()=>({me:renderingAccount})};
    if(name==='./SubscriptionBenefitSymbol') return {SubscriptionBenefitSymbol:()=>null};
    if(name==='next/link') return {__esModule:true,default:({children,...props})=>React.createElement('a',props,children)};
    return require(name);
  },mod,mod.exports);
  return renderToStaticMarkup(React.createElement(mod.exports.CheckoutMembership,{
    variant,
    accountTermsVersion:'2026-11-v22',
    accountPrivacyNoticeVersion:legal.CURRENT_PRIVACY_NOTICE_VERSION,
    selected,
    onChange:()=>{},
    appliedSavings:{weekendSaving:0,rentalSaving:5,deliveryReduction:0,membershipFee:19,membershipCreditApplied:0,membershipNetSaving:5,membershipOffer:{tier:'plus',netSaving:5,state:'selected'}},
  }));
}

(async()=>{
  const before=(await db.query('accounts').collect()).length;
  await assert.rejects(bootstrapCheckoutAccount.handler(ctx,{...base,termsAndPrivacyAcknowledged:false}),/Accept the current account Terms and Privacy Notice/);
  await assert.rejects(bootstrapCheckoutAccount.handler(ctx,{...base,accountTermsVersion:'old-terms'}),/Accept the current account Terms and Privacy Notice/);
  await assert.rejects(bootstrapCheckoutAccount.handler(ctx,{...base,privacyNoticeVersion:'old-notice'}),/Accept the current account Terms and Privacy Notice/);
  assert.equal((await db.query('accounts').collect()).length,before,'invalid or stale consent creates no guest account');

  const account=await bootstrapCheckoutAccount.handler(ctx,base);
  assert.equal(account.accountTermsVersion,base.accountTermsVersion);
  assert.equal(account.accountTermsAcceptedAt,acceptedAt,'acceptance time is generated on the server');
  assert.equal(account.privacyNoticeVersion,base.privacyNoticeVersion);
  assert.equal(account.privacyNoticeAcknowledgedAt,acceptedAt,'privacy acknowledgement time is generated on the server');
  const retried=await bootstrapCheckoutAccount.handler(ctx,base);
  assert.equal(retried._id,account._id,'same checkout seed remains idempotent');

  const selection={tier:'plus',intro:'none',termsAccepted:true,accountTermsAcceptedVersion:'2026-11-v22',privacyNoticeAcceptedVersion:legal.CURRENT_PRIVACY_NOTICE_VERSION};
  const guestHtml=renderMembership({selected:selection});
  assert(guestHtml.includes('data-testid="guest-account-terms-consent"'),'guest membership checkout shows separate account consent');
  assert(guestHtml.includes('data-testid="guest-account-terms-checkbox"'),'account consent is an explicit checkbox');
  assert(guestHtml.includes('text-[11px]'),'account consent text stays readable on phones');
  assert.match(guestHtml,/data-testid="guest-account-terms-checkbox"[^>]*checked/,'checkbox is checked only for the exact versions the guest accepted');
  assert(guestHtml.includes('/legal/terms?version=2026-11-v22'));
  assert(guestHtml.includes('href="/legal/privacy"'),'the current Privacy Notice link resolves to the published notice route');
  const staleHtml=renderMembership({selected:{...selection,accountTermsAcceptedVersion:'old-terms'}});
  assert.doesNotMatch(staleHtml,/data-testid="guest-account-terms-checkbox"[^>]*checked/,'a restored acceptance for older Terms is unchecked');
  const stalePrivacyHtml=renderMembership({selected:{...selection,privacyNoticeAcceptedVersion:'old-notice'}});
  assert.doesNotMatch(stalePrivacyHtml,/data-testid="guest-account-terms-checkbox"[^>]*checked/,'a restored acceptance for an older Privacy Notice is unchecked');
  assert(!renderMembership({member:{email:'member@example.invalid'},selected:selection}).includes('guest-account-terms-consent'),'signed-in member checkout does not add account-creation consent');
  assert(!renderMembership({selected:selection,variant:'basket'}).includes('guest-account-terms-consent'),'basket membership preview does not request account consent');

  const checkoutSource=fs.readFileSync(path.resolve(__dirname,'../convex/checkout.ts'),'utf8');
  assert.match(checkoutSource,/if \(!acct\) \{\s*const accountTermsVersion = legalVersionForPolicy\(cfg\);/,'server checkout derives the active Terms version');
  assert.match(checkoutSource,/accountTermsPrivacyAcknowledged !== true \|\| a\.selectedMembership\.accountTermsVersion !== accountTermsVersion \|\| a\.selectedMembership\.privacyNoticeVersion !== CURRENT_PRIVACY_NOTICE_VERSION/,'server checkout rejects missing or stale client consent');
  assert.match(checkoutSource,/termsAndPrivacyAcknowledged:true,accountTermsVersion,privacyNoticeVersion:CURRENT_PRIVACY_NOTICE_VERSION/,'validated versions and explicit acknowledgement reach the internal account creator');
  const selectedMembershipBlock=checkoutSource.slice(checkoutSource.indexOf('if (a.selectedMembership) {'),checkoutSource.indexOf('a.customer.email = price.customerEmail;'));
  assert(selectedMembershipBlock.indexOf('if (!acct) {') < selectedMembershipBlock.indexOf('accountTermsPrivacyAcknowledged !== true'),'only guest account creation is gated by the account checkbox');
  assert.match(selectedMembershipBlock,/membershipCheckout = await ctx\.runMutation\(internal\.membershipBenefits\.reserveCheckout/,'existing authenticated accounts still proceed through the normal membership reservation');

  console.log('PASS guest membership checkout account consent: explicit guest-only UI, current server-validated legal versions, server timestamps, stale-version rejection and idempotent checkout account reuse.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{Date.now=realNow});
