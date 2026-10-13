/** Actual completion worker and claims; delivery is captured, never sent. */
const assert = require('node:assert/strict');
const { load, db, put, setMock } = require('./lib/rentalTestHarness.cjs');
const deliveries = [];
let deliver = false, rejectPdf = false, fetches = 0;
setMock('./lib/mailer', { sendMail: async mail => { deliveries.push(mail); return deliver; } });
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
const ctx = { db, runMutation:async(ref,args)=>bookings[ref.split('.')[1]].handler(ctx,args),
  runQuery:async(ref,args)=>bookings[ref.split('.')[1]].handler(ctx,args) };
(async()=>{
  const React=require('react'), {Document,Page,Text,renderToBuffer}=await import('@react-pdf/renderer');
  pdf=await renderToBuffer(React.createElement(Document,null,React.createElement(Page,null,
    React.createElement(Text,null,'Fixture completion: £100 paid; £25 retained; £75 refunded. '+statement.damageNote))));
  await invoice.returnSettlementEmail.handler(ctx,{bookingId:row._id});
  assert.equal(row.returnStatementEmailStatus,'failed');
  assert.equal(deliveries.length,1);
  const mail=deliveries[0]; assert.equal(mail.to,statement.customerEmail);
  assert(mail.html.includes('Deposit retained £25.00')); assert(mail.html.includes(statement.damageNote));
  assert.equal(Buffer.from(mail.attachments[0].content,'base64').compare(pdf),0);
  row.returnStatementEmailStatus='sending'; row.returnStatementEmailAttemptAt=Date.now();
  await invoice.returnSettlementEmail.handler(ctx,{bookingId:row._id});
  assert.equal(deliveries.length,1,'Active delivery claim excludes another worker');
  row.returnStatementEmailAttemptAt=Date.now()-16*60000; deliver=true;
  await invoice.returnSettlementEmail.handler(ctx,{bookingId:row._id});
  assert.equal(row.returnStatementEmailStatus,'sent'); assert(row.returnStatementEmailedAt);
  const before=fetches; await invoice.returnSettlementEmail.handler(ctx,{bookingId:row._id});
  assert.equal(fetches,before,'Sent statements neither regenerate nor resend');
  row.returnStatementEmailStatus='failed'; rejectPdf=true;
  const count=deliveries.length;
  const originalError=console.error; console.error=()=>{};
  try { await invoice.returnSettlementEmail.handler(ctx,{bookingId:row._id}); } finally { console.error=originalError; }
  assert.equal(row.returnStatementEmailStatus,'failed'); assert.equal(deliveries.length,count,'Invalid attachment cannot be delivered');
  console.log('PASS completion email worker: captured delivery with genuine rendered PDF, retention reason, failed delivery retry, exclusive claim, stale-claim recovery, sent dedupe and invalid PDF rejection. No real recipient contacted.');
})().catch(error=>{console.error(error);process.exitCode=1});
