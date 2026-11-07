const assert=require('node:assert/strict');
const {load,db,put}=require('./lib/rentalTestHarness.cjs');
process.env.ADMIN_TOKEN='isolated-invoice-admin';
const owner=put('accounts',{email:'new-owner@example.invalid',name:'Linked customer'});
const foreign=put('accounts',{email:'old-owner@example.invalid',name:'Other customer'});
for(const [token,accountId,expiresAt] of [['owner',owner._id,Date.now()+60000],['foreign',foreign._id,Date.now()+60000],['expired',owner._id,Date.now()-1],['missing-expiry',owner._id,undefined]])put('sessions',{token,accountId,expiresAt});
const listing=put('listings',{title:'Camera',r2Images:['/gear-camera.webp'],sourceImages:['https://source.example.invalid/camera.jpg']});
const booking=put('bookings',{accountId:owner._id,guestEmail:foreign.email,guestName:'Booking name',status:'returned',depositAmount:40.5,depositHoldAmount:81,depositHoldStatus:'released',depositRefunded:true,depositRefundAmount:40.5,subtotal:100,total:140.5,lineItems:[{listingId:listing._id,title:'Camera',qty:1,start:0,end:86400000,lineTotal:100}]});
const legacy=put('bookings',{...booking,_id:'legacy-invoice',accountId:undefined,guestEmail:' NEW-OWNER@example.invalid '});
put('rental_security_charges',{bookingId:booking._id,accountId:owner._id,state:'paid',kind:'damage',reason:'Documented damage',paidPence:2000,refundedPence:500,customerId:'private-provider-customer'});
put('rental_security_charges',{bookingId:booking._id,accountId:foreign._id,state:'paid',kind:'damage',reason:'FOREIGN ASSESSMENT',paidPence:9000});
put('rental_security_charges',{bookingId:booking._id,accountId:owner._id,state:'notice_sent',kind:'late',reason:'UNPAID ASSESSMENT',amountPence:1000});
const fn=load('convex/bookings.ts').invoiceData.handler;
(async()=>{
const owned=await fn({db},{bookingId:booking._id,token:'owner'});assert.ok(owned);assert.equal(owned.customerName,'Booking name');assert.equal(owned.depositHoldAmount,81);assert.equal(owned.depositRefundAmount,40.5);assert.deepEqual(owned.equipmentImages,[['/gear-camera.webp','https://source.example.invalid/camera.jpg']]);
assert.equal(owned.assessmentPayments.length,1);assert.equal(owned.assessmentPayments[0].paid,20);assert.equal(owned.assessmentPayments[0].refunded,5);assert(!JSON.stringify(owned).includes('private-provider-customer'));assert(!JSON.stringify(owned).includes('FOREIGN ASSESSMENT'));assert(!JSON.stringify(owned).includes('UNPAID ASSESSMENT'));
owner.blockedAt=Date.now();assert.equal(await fn({db},{bookingId:booking._id,token:'owner'}),null);owner.blockedAt=undefined;
owner.emailVerificationRequired=true;assert.equal(await fn({db},{bookingId:booking._id,token:'owner'}),null);owner.emailVerifiedAt=Date.now();assert.ok(await fn({db},{bookingId:booking._id,token:'owner'}));
assert.equal(await fn({db},{bookingId:booking._id,token:'foreign'}),null);
assert.equal(await fn({db},{bookingId:booking._id,token:'expired'}),null);assert.equal(await fn({db},{bookingId:booking._id,token:'missing-expiry'}),null);
assert.equal(await fn({db},{bookingId:booking._id,token:'wrong'}),null);
assert.ok(await fn({db},{bookingId:legacy._id,token:'owner'}));
legacy.depositRefundAmount=undefined;assert.equal((await fn({db},{bookingId:legacy._id,token:'owner'})).depositRefundAmount,null);
assert.ok(await fn({db},{bookingId:booking._id,token:process.env.ADMIN_TOKEN}));
for(const key of ['stripePaymentIntentId','stripeDepositIntentId','idDocumentUrl','diditSessionId'])assert.equal(Object.hasOwn(owned,key),false);
const {GET:calendar}=load('src/app/api/booking-ics/[id]/route.ts');
process.env.NEXT_PUBLIC_CONVEX_URL='https://synthetic.invalid';
const realFetch=global.fetch;
global.fetch=async(_url,options)=>{const args=JSON.parse(options.body).args;return new Response(JSON.stringify({status:'success',value:await fn({db},args)}),{headers:{'content-type':'application/json'}})};
try {
 const request=(url,headers={})=>({nextUrl:new URL(url),headers:new Headers(headers)});
 const context={params:Promise.resolve({id:booking._id})};
 assert.equal((await calendar(request('https://site.invalid/api/booking-ics/x',{authorization:'Bearer owner'}),context)).status,200,'Calendar header authentication reaches the actual ownership check');
 assert.equal((await calendar(request('https://site.invalid/api/booking-ics/x',{authorization:'Bearer foreign'}),context)).status,403,'Another account cannot fetch the calendar');
 assert.equal((await calendar(request('https://site.invalid/api/booking-ics/x?token=owner'),context)).status,200,'Legacy token calendar links remain compatible');
 assert.equal((await calendar(request('https://site.invalid/api/booking-ics/x?token=owner',{authorization:'Bearer foreign'}),context)).status,403,'An explicit header takes precedence over the legacy token');
} finally {global.fetch=realFetch;}
console.log('PASS actual invoice query: permanent account ownership after email change; linked foreign same-email denial; expired/invalid sessions; legacy normalised email; admin access; blocked/unverified accounts, authorised catalogue image projection, safe security/name projection without private payment/identity identifiers.');
})().catch(e=>{console.error(e);process.exitCode=1});
