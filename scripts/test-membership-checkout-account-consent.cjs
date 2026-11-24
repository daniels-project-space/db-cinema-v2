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
  assert.doesNotMatch(guestHtml,/guest-account-terms-consent|guest-account-terms-checkbox/,'membership tile does not ask guest renters to repeat the rental Terms and Privacy acceptance');
  assert(guestHtml.includes('Membership creates an account after payment.'),'guest membership explains account creation without a second legal checkbox');
  assert(!renderMembership({member:{email:'member@example.invalid'},selected:selection}).includes('guest-account-terms-consent'),'signed-in member checkout does not add account-creation consent');
  assert(!renderMembership({selected:selection,variant:'basket'}).includes('guest-account-terms-consent'),'basket membership preview does not request account consent');
  const acceptedDocuments=[
    {kind:'terms',version:base.accountTermsVersion},
    {kind:'privacy',version:legal.CURRENT_PRIVACY_NOTICE_VERSION},
  ];
  const accountConsent={accountTermsPrivacyAcknowledged:true,accountTermsVersion:base.accountTermsVersion,privacyNoticeVersion:legal.CURRENT_PRIVACY_NOTICE_VERSION};
  assert.equal(legal.guestMembershipAccountConsentMatchesRentalAgreement(accountConsent,acceptedDocuments,policy),true,'one checked rental agreement can satisfy guest membership account Terms and Privacy');
  assert.equal(legal.guestMembershipAccountConsentMatchesRentalAgreement({...accountConsent,accountTermsPrivacyAcknowledged:false},acceptedDocuments,policy),false,'unchecked rental consent cannot create a guest account');
  assert.equal(legal.guestMembershipAccountConsentMatchesRentalAgreement({...accountConsent,accountTermsVersion:'old-terms'},acceptedDocuments,policy),false,'stale account terms are rejected');
  assert.equal(legal.guestMembershipAccountConsentMatchesRentalAgreement(accountConsent,acceptedDocuments.filter(document=>document.kind!=='terms'),policy),false,'rental signature without account Terms does not satisfy account creation');
  assert.equal(legal.guestMembershipAccountConsentMatchesRentalAgreement(accountConsent,[...acceptedDocuments,{kind:'privacy',version:'old-notice'}],policy),false,'stale Privacy Notice acceptance is rejected');

  const checkoutSource=fs.readFileSync(path.resolve(__dirname,'../convex/checkout.ts'),'utf8');
  const checkoutPage=fs.readFileSync(path.resolve(__dirname,'../src/app/checkout/page.tsx'),'utf8');
  assert.match(checkoutPage,/const accepted=e\.target\.checked;setAgreed\(accepted\);agreementRequest\.current=null;if\(membership&&!account\.me\)setMembership\(\{\.\.\.membership,accountTermsAcceptedVersion:accepted\?currentAccountTermsVersion:undefined,privacyNoticeAcceptedVersion:accepted\?CURRENT_PRIVACY_NOTICE_VERSION:undefined\}\);/,'the rental consent records guest account Terms and Privacy versions with one checkbox');
  assert.match(checkoutPage,/including the current account Terms and Privacy Notice for membership setup/,'shared consent explains its account-creation purpose');
  assert.match(checkoutPage,/transition-transform duration-300 ease-out group-open:rotate-180/,'expanded agreement details animate their custom disclosure glyph');
  const agreementComponent=fs.readFileSync(path.resolve(__dirname,'../src/components/cart/CartItemTimes.tsx'),'utf8');
  assert.match(agreementComponent,/data-testid="checkout-times-chevron"[^>]*transition-transform duration-300 ease-out/,'expanded fulfilment time tiles animate their chevron');
  assert.match(checkoutSource,/if \(!acct\) \{\s*const accountTermsVersion = legalVersionForPolicy\(cfg\);/,'server checkout derives the active Terms version');
  assert.match(checkoutSource,/guestMembershipAccountConsentMatchesRentalAgreement\(a\.selectedMembership,a\.agreement\?\.documents,cfg\)/,'server binds the guest account to signed Terms and Privacy documents');
  assert.match(checkoutSource,/termsAndPrivacyAcknowledged:true,accountTermsVersion,privacyNoticeVersion:CURRENT_PRIVACY_NOTICE_VERSION/,'validated versions and explicit acknowledgement reach the internal account creator');
  const selectedMembershipBlock=checkoutSource.slice(checkoutSource.indexOf('if (a.selectedMembership) {'),checkoutSource.indexOf('a.customer.email = price.customerEmail;'));
  assert(selectedMembershipBlock.indexOf('if (!acct) {') < selectedMembershipBlock.indexOf('guestMembershipAccountConsentMatchesRentalAgreement'),'only guest account creation is gated by the combined consent');
  assert.match(selectedMembershipBlock,/membershipCheckout = await ctx\.runMutation\(internal\.membershipBenefits\.reserveCheckout/,'existing authenticated accounts still proceed through the normal membership reservation');

  console.log('PASS guest membership checkout account consent: one linked rental/account Terms and Privacy acceptance, exact server-validated versions, server timestamps and idempotent account reuse.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{Date.now=realNow});
