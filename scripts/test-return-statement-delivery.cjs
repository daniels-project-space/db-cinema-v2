const assert = require('node:assert/strict');
const h = require('./lib/rentalTestHarness.cjs');
process.env.INVOICE_SECRET = 'isolated-return-delivery';
const mails = [];
let accepted = true;
h.setMock('./lib/mailer', {sendMail: async message => {mails.push(message); return accepted;}});
const bookings = h.load('convex/bookings.ts'), invoice = h.load('convex/invoice.ts');
const ctx = {db:h.db, runQuery:async(ref,args) => {
  assert.equal(ref, 'bookings.returnStatementContext');
  return bookings.returnStatementContext.handler(ctx,args);
}, runMutation:async(ref,args) => {
  assert(ref.startsWith('bookings.'));
  return bookings[ref.split('.')[1]].handler(ctx,args);
}};
const oldEmail = 'historical@example.invalid';
const owner = h.put('accounts',{email:'current-owner@example.invalid'});
h.put('accounts',{email:oldEmail}); // This address now belongs to someone else.
const statement = {number:'RETURN-ACCOUNT-BOUND',issuedAt:Date.now(),actualReturnedAt:Date.now(),supplierName:'DB Cinema Rentals',customerEmail:oldEmail,lineItems:[],subtotal:100,discount:0,deliveryFee:0,creditApplied:0,checkoutPaid:140.5,securityPaid:40.5,securityRefunded:40.5,damageTotal:0,damageFromHold:0,lateAssessed:0,lateWaived:0,lateBreakdown:[]};
const make = extra => h.put('bookings',{accountId:owner._id,guestEmail:oldEmail,status:'returned',returnStatement:structuredClone(statement),returnStatementEmailStatus:'pending',...extra});
let duringPdf = async()=>{};
global.fetch = async()=>{await duringPdf();return new Response('%PDF-isolated-return',{headers:{'content-type':'application/pdf'}});};
const send = b => invoice.returnSettlementEmail.handler(ctx,{bookingId:b._id});
(async()=>{
 const b=make(); await send(b);
 assert.equal(mails.length,1); assert.equal(mails[0].to,owner.email,'return statement goes to permanently associated account');
 assert.equal(b.returnStatement.customerEmail,oldEmail,'historical billing evidence stays unchanged');
 assert.equal(b.returnStatementEmailStatus,'sent');
 await send(b);assert.equal(mails.length,1,'sent statement is not resent');
 const missing=make({accountId:'accounts-missing'});await send(missing);
 assert.equal(mails.length,1,'missing permanent account never falls back to reused historical email');
 assert.equal(missing.returnStatementEmailStatus,'failed');
 const changed=make();duringPdf=async()=>h.db.patch(owner._id,{email:'updated-during-pdf@example.invalid'});
 await send(changed);assert.equal(mails.at(-1).to,owner.email,'recipient is refreshed after PDF generation');
 const vanished=make();duringPdf=async()=>h.db.patch(vanished._id,{accountId:'accounts-deleted-during-pdf'});
 const count=mails.length;await send(vanished);assert.equal(mails.length,count,'lost binding during PDF generation sends nothing');assert.equal(vanished.returnStatementEmailStatus,'failed');
 duringPdf=async()=>{};
 const blocked=make();await h.db.patch(owner._id,{blockedAt:Date.now()});await send(blocked);assert.equal(mails.length,count,'blocked account receives no private statement');assert.equal(blocked.returnStatementEmailStatus,'failed');
 await h.db.patch(owner._id,{blockedAt:undefined});
 const legacy=make({accountId:undefined,guestEmail:'legacy@example.invalid'});await send(legacy);assert.equal(mails.at(-1).to,legacy.guestEmail,'unlinked legacy booking retains its own contact');
 const retry=make();accepted=false;await send(retry);const firstKey=mails.at(-1).deliveryKey;assert.match(firstKey,/^rental-return-[a-f0-9]{64}$/);assert.equal(retry.returnStatementEmailStatus,'failed');
 accepted=true;await send(retry);assert.equal(mails.at(-1).deliveryKey,firstKey,'same statement and recipient keep their delivery identity on retry');assert.equal(retry.returnStatementEmailStatus,'sent');
 console.log('PASS actual return-statement worker/account queries: permanent ownership, changed and missing accounts, pre-send PDF race, blocked account, legacy contact and immutable historical billing. No live email or payment.');
})().catch(error=>{console.error(error);process.exitCode=1;});
