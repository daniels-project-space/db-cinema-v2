/** Actual completion worker and claims; delivery is captured, never sent. */
const assert = require('node:assert/strict');
const { load, db, put, setMock, tables } = require('./lib/rentalTestHarness.cjs');
const deliveries = [];
let deliver = false, ambiguous = true, rejectPdf = false, fetches = 0;
setMock('./lib/mailer', {
  sendMail: async mail => { deliveries.push(mail); return deliver; },
  sendBusinessMailTracked: async mail => {
    deliveries.push(mail);
    return { sent: deliver, ambiguous: deliver ? false : ambiguous, ...(deliver ? { resendEmailId: `resend-${deliveries.length}` } : {}) };
  },
});
const bookings = load('convex/bookings.ts'), invoice = load('convex/invoice.ts');
process.env.INVOICE_SECRET = 'fixture-private-invoice-key';
process.env.APP_URL = 'https://completion.example.invalid';
const statement = { number:'DBC-R-FIXTURE', issuedAt:Date.now(), actualReturnedAt:Date.now(),
  supplierName:'DB Cinema Rentals', customerName:'Synthetic renter', customerEmail:'fixture@example.invalid',
  lineItems:[], subtotal:100, discount:0, deliveryFee:0, creditApplied:0, checkoutPaid:200,
  securityPaid:100, securityRefunded:75, securityRefundedConfirmed:75, depositRefundState:'succeeded', savedCardLimit:400,
  securityPolicyVersion:'2026-10-refundable-deposit-v1', depositKept:25,
  damageTotal:25, damageAssessed:150, damageFromHold:25,
  damageNote:'Inspected casing damage; repair estimate recorded.', lateAssessed:0, lateWaived:0, lateBreakdown:[] };
const row = put('bookings', { returnStatement:statement });
let pdf;
global.fetch = async (url, options) => {
  fetches++;
  assert.equal(url, `${process.env.APP_URL}/api/invoice/${row._id}?phase=return`);
  assert.equal(options.headers['x-invoice-key'],process.env.INVOICE_SECRET);
  return new Response(rejectPdf ? 'not a PDF' : pdf, { headers:{'content-type':rejectPdf?'text/html':'application/pdf'} });
};
const ctx = { db, scheduler:{runAfter:async()=>{}}, runMutation:async(ref,args)=>bookings[ref.split('.')[1]].handler(ctx,args),
  runQuery:async(ref,args)=>bookings[ref.split('.')[1]].handler(ctx,args) };
(async()=>{
  const React=require('react'), {Document,Page,Text,renderToBuffer}=await import('@react-pdf/renderer');
  pdf=await renderToBuffer(React.createElement(Document,null,React.createElement(Page,null,
    React.createElement(Text,null,'Fixture completion: £100 paid; £25 retained; £75 refunded. '+statement.damageNote))));
  await invoice.returnSettlementEmail.handler(ctx,{bookingId:row._id});
  assert.equal(row.returnStatementEmailStatus,'failed');
  assert.equal(row.returnStatementEmailAmbiguous,true,'A lost/uncertain provider response remains retryable while the idempotency window is valid');
  assert.equal(deliveries.length,1);
  const mail=deliveries[0]; assert.equal(mail.to,statement.customerEmail);
  assert.equal(mail.deliveryKey,`return-statement-${row._id}-${statement.number}`,'Return statement retries use a deterministic Resend idempotency key');
  assert(mail.html.includes('Deposit retained £25.00')); assert(mail.html.includes(statement.damageNote));
  assert(mail.html.includes('original payment method')); assert(mail.html.includes('5–10 business days')); assert(mail.html.includes('Refunds confirmed by Stripe')); assert(!mail.html.includes('Confirmed bank refunds'));
  assert.equal(Buffer.from(mail.attachments[0].content,'base64').compare(pdf),0);
  row.returnStatementEmailStatus='sending'; row.returnStatementEmailAttemptAt=Date.now();
  await invoice.returnSettlementEmail.handler(ctx,{bookingId:row._id});
  assert.equal(deliveries.length,1,'Active delivery claim excludes another worker');
  row.returnStatementEmailAttemptAt=Date.now()-16*60000; deliver=true; ambiguous=false;
  await invoice.returnSettlementEmail.handler(ctx,{bookingId:row._id});
  assert.equal(row.returnStatementEmailStatus,'sent'); assert(row.returnStatementEmailedAt);
  assert.equal(deliveries.at(-1).deliveryKey,mail.deliveryKey,'Failed retries reuse the original Resend idempotency key');
  const before=fetches; await invoice.returnSettlementEmail.handler(ctx,{bookingId:row._id});
  assert.equal(fetches,before,'Sent statements neither regenerate nor resend');
  row.returnStatementEmailStatus='failed'; rejectPdf=true;
  const count=deliveries.length;
  const originalError=console.error; console.error=()=>{};
  try { await invoice.returnSettlementEmail.handler(ctx,{bookingId:row._id}); } finally { console.error=originalError; }
  assert.equal(row.returnStatementEmailStatus,'failed'); assert.equal(deliveries.length,count,'Invalid attachment cannot be delivered');

  const now=Date.now(), unknown=put('bookings',{status:'returned',returnStatement:{...statement,number:'DBC-R-UNKNOWN',issuedAt:now-26*60*60_000},returnStatementEmailStatus:'failed',returnStatementEmailAttemptAt:now-25*60*60_000,returnStatementEmailIdempotencyStartedAt:now-25*60*60_000,returnStatementEmailAmbiguous:true});
  const beforeUnknown=deliveries.length;
  assert.equal(await bookings.claimReturnStatementEmail.handler(ctx,{bookingId:unknown._id}),false);
  assert.equal(unknown.returnStatementEmailStatus,'delivery_unknown','An unresolved ambiguous send past 24h stops automatic resending');
  assert(tables.get('admin_notifications').some(n=>n.eventKey===`return-statement-delivery-unknown:${unknown._id}`),'Unknown delivery alerts the owner even for guest rentals');
  assert.equal(deliveries.length,beforeUnknown,'Unknown delivery is never retried automatically');

  const rejected=put('bookings',{status:'returned',returnStatement:{...statement,number:'DBC-R-REJECTED'},returnStatementEmailStatus:'failed',returnStatementEmailAttemptAt:now-30*60*60_000,returnStatementEmailIdempotencyStartedAt:now-30*60*60_000,returnStatementEmailAmbiguous:false});
  assert.equal(await bookings.claimReturnStatementEmail.handler(ctx,{bookingId:rejected._id}),true,'A definite provider rejection remains retryable after 24h');
  assert.equal(rejected.returnStatementEmailStatus,'sending');
  assert.equal(rejected.returnStatementEmailIdempotencyStartedAt,rejected.returnStatementEmailAttemptAt,'A definite rejection gets a fresh idempotency window before retry');

  const crashed=put('bookings',{status:'returned',returnStatement:{...statement,number:'DBC-R-CRASHED',issuedAt:now-26*60*60_000},returnStatementEmailStatus:'sending',returnStatementEmailAttemptAt:now-30*60_000});
  assert.equal(await bookings.claimReturnStatementEmail.handler(ctx,{bookingId:crashed._id}),false,'A crashed send beyond the provider window is never repeated');
  assert.equal(crashed.returnStatementEmailStatus,'delivery_unknown');
  console.log('PASS completion email worker: captured delivery with genuine rendered PDF, retention reason, failed delivery retry, exclusive claim, stale-claim recovery, sent dedupe and invalid PDF rejection. No real recipient contacted.');
})().catch(error=>{console.error(error);process.exitCode=1});
