/** Actual Convex registration and notification handlers, with no delivery transport. */
const assert=require('node:assert/strict'),h=require('./lib/rentalTestHarness.cjs'),sdk=require('convex/server');
const server=Object.fromEntries(['query','mutation','internalQuery','internalMutation','action','internalAction'].map(k=>[k,sdk[k+'Generic']]));h.setMock('./_generated/server',server);
function refs(prefix){return new Proxy({},{get:(_,m)=>new Proxy({},{get:(_,f)=>prefix+'.'+m+'.'+f})})}h.setMock('./_generated/api',{api:refs('api'),internal:refs('internal')});
const mails=[];h.setMock('./lib/mailer',{sendMail:async m=>{mails.push(m);return true},OWNER_EMAIL:()=> 'owner@example.invalid'});delete process.env.TELEGRAM_BOT_TOKEN;delete process.env.TELEGRAM_CHAT_ID;
const bookings=h.load('convex/bookings.ts'),notify=h.load('convex/notify.ts');
const b=h.put('bookings',{guestEmail:'renter@example.invalid',status:'confirmed',fulfilment:'pickup',total:70,depositAmount:50,depositHoldAmount:100,lineItems:[{title:'Cinema camera',start:Date.UTC(2030,0,1),end:Date.UTC(2030,0,2),lineTotal:20}],idVerifyStatus:'required'});
const ctx={db:h.db,runQuery:async(ref,a)=>{assert.equal(ref,'internal.bookings.get','Notification reads must stay private');return bookings.get._handler(ctx,a)}};
(async()=>{
 assert.equal(bookings.get.isInternal,true,'Booking ID alone does not authorise this query');assert.equal(bookings.get.isQuery,true);
 await notify.bookingAlert._handler(ctx,{bookingId:b._id});assert.equal(mails.length,1);assert.match(mails[0].subject,/Payment received/);assert.match(mails[0].html,/awaiting verification and approval/);assert(!/Booking confirmed|booking is confirmed/.test(mails[0].html));assert.equal(mails[0].attachments,undefined);assert.match(mails[0].html,/account\/verification\//);
 await h.db.patch(b._id,{idVerifyStatus:'verified'});await notify.verificationEmail._handler(ctx,{bookingId:b._id,status:'verified'});assert.match(mails[1].html,/remaining document checks and approval/);assert(!mails[1].html.includes("You're all set"));
 await notify.cancellationEmail._handler(ctx,{bookingId:b._id,mode:'credit',refundAmount:0,creditAmount:20});assert.match(mails[2].html,/Account credit added/);assert(!mails[2].html.includes('Refund to original payment method'));assert.match(mails[2].html,/no cash refund is issued for the amount converted to credit/);
 await notify.cancellationEmail._handler(ctx,{bookingId:b._id,mode:'refund',refundAmount:30,creditAmount:10});assert.match(mails[3].html,/Refund to original payment method/);assert.match(mails[3].html,/Account credit restored/);assert(!mails[3].html.includes('Account credit added'));

 const count=mails.length;await h.db.patch(b._id,{idVerifyStatus:'rejected'});await notify.verificationEmail._handler(ctx,{bookingId:b._id,status:'verified'});assert.equal(mails.length,count,'Delayed verification events cannot send an obsolete approval message');
 await h.db.patch(b._id,{status:'cancelled'});await notify.bookingAlert._handler(ctx,{bookingId:b._id});assert.equal(mails.length,count,'Delayed payment notice cannot ask a cancelled rental to complete checks');
 await h.db.patch(b._id,{status:'confirmed',guestName:'Booked name',guestPhone:'07700001234',billingAddress:'Booking address'});
 const claims=h.load('convex/accountClaims.ts'),access=h.load('convex/accountAccess.ts');
 ctx.runMutation=async(ref,args)=>{assert(ref.startsWith('internal.accountClaims.'));return claims[ref.split('.').at(-1)]._handler(ctx,args)};
 await access.sendForRental._handler(ctx,{bookingId:b._id});
 const paidMail=mails.at(-1),url=new URL(paidMail.html.match(/href="([^"]*account\/access[^"]*)"/)[1].replace(/&amp;/g,'&'));
 assert.equal(url.searchParams.get('next'),'verification');assert.equal(url.searchParams.has('secret'),false,'Secrets stay in the URL fragment');
 const secret=url.hash.slice(1);assert.match(secret,/^[A-Za-z0-9_-]{43}$/);
 const account=await h.db.get(b.accountId);assert.equal(account.name,'Booked name');assert.equal(account.phone,'07700001234');assert.equal(account.emailVerificationRequired,true);
 const claim=await h.db.get(b.accountAccessEmailClaimId);assert.notEqual(claim.secretHash,secret);assert.equal(claim.accountId,b.accountId);assert.equal(claim.bookingId,b._id);
 const session=await access.exchange._handler(ctx,{secret});assert.equal(session.bookingId,b._id);assert.ok(account.emailVerifiedAt);assert.equal(account.emailVerificationRequired,false);
 assert.equal(h.tables.get('sessions').find(s=>s.token===session.token).accountId,b.accountId);
 await assert.rejects(access.exchange._handler(ctx,{secret}),/already been used/);
 const sent=mails.length;await access.sendForRental._handler(ctx,{bookingId:b._id});assert.equal(mails.length,sent,'Duplicate paid callbacks cannot send another access email');
 await h.db.patch(b._id,{guestEmail:'reused@example.invalid'});h.put('accounts',{email:b.guestEmail});
 assert.equal((await bookings.get._handler(ctx,{bookingId:b._id})).guestEmail,account.email,'Notification recipient follows the permanent account, not a reused guest mailbox');
 assert.equal((await bookings.receiptContext._handler(ctx,{bookingId:b._id})).guestEmail,account.email);
 process.env.INVOICE_SECRET='fixture-invoice-secret';
 const savedStatement={supplierName:'PRIVATE OLD NAME',supplierAddress:'PRIVATE OLD ADDRESS',rentalRefunded:0};await h.db.patch(b._id,{returnStatement:savedStatement});
 const receipt=await bookings.invoiceData._handler(ctx,{bookingId:b._id,key:process.env.INVOICE_SECRET});
 assert.equal(receipt.supplierName,'DB Cinema Rentals');assert.equal(receipt.supplierAddress,undefined);assert.equal(receipt.returnStatement.supplierName,'DB Cinema Rentals');assert.equal(receipt.returnStatement.supplierAddress,undefined);
 assert.equal(savedStatement.supplierAddress,'PRIVATE OLD ADDRESS','Immutable settlement history stays intact; only its customer-facing projection is redacted');
 assert.equal(await bookings.invoiceData._handler(ctx,{bookingId:b._id}),null,'Booking ID does not grant invoice access');
 await h.db.patch(b._id,{status:'pending_payment'});
 assert.equal(await bookings.invoiceData._handler(ctx,{bookingId:b._id,key:process.env.INVOICE_SECRET}),null,'An authorised unfinished checkout cannot download a paid receipt');
 await h.db.patch(b._id,{stripePaymentIntentId:'pi_pending_fixture'});
 assert.equal(await bookings.invoiceData._handler(ctx,{bookingId:b._id,key:process.env.INVOICE_SECRET}),null,'An intent reference alone cannot turn a pending checkout into proof of payment');
 await h.db.patch(b._id,{status:'cancelled',stripePaymentIntentId:'pi_settled_fixture'});
 assert.ok(await bookings.invoiceData._handler(ctx,{bookingId:b._id,key:process.env.INVOICE_SECRET}),'A paid cancelled rental retains its original receipt');
 await h.db.patch(b._id,{stripePaymentIntentId:undefined});
 assert.equal(await bookings.invoiceData._handler(ctx,{bookingId:b._id,key:process.env.INVOICE_SECRET}),null,'An abandoned unpaid checkout has no paid receipt');
 await h.db.patch(b._id,{status:'confirmed'});
 delete process.env.INVOICE_SECRET;

 const {accountAccessDestination,accountAccessError}=h.load('shared/accountAccess.ts');
 assert.equal(accountAccessDestination(b._id,'verification'),'/account/verification/'+b._id);
 assert.equal(accountAccessDestination(b._id,'https://foreign.example.invalid'),'/account?rental='+b._id+'#chat','Untrusted next selectors never become navigation URLs');
 assert.equal(accountAccessDestination(undefined,'verification'),'/account');
 assert.match(accountAccessError({data:{code:'ACCESS_LINK_EXPIRED'}}),/expired/);
 assert(!accountAccessError(Error('[CONVEX A(private:function)] Secret internal provider details')).includes('CONVEX'));
 assert(!accountAccessError(Error('Secret internal provider details')).includes('Secret'));

 if(process.env.DBC_EMAIL_RENDER_DIR){const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(process.env.DBC_EMAIL_RENDER_DIR,{recursive:true});for(const [i,name]of ['payment','verification','cancellation-credit','cancellation-refund'].entries())fs.writeFileSync(path.join(process.env.DBC_EMAIL_RENDER_DIR,name+'.html'),mails[i].html)}
 console.log('PASS actual registered private booking summary and payment/verification notification copy. Mock delivery only; no customer emails or financial calls.');
})().catch(e=>{console.error(e);process.exitCode=1});
